const express = require('express');
const request = require('request');
const bodyParser = require('body-parser');
const _ = require('lodash');

/** ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- **/
var app = express();
app.use(bodyParser.text({limit: '10mb'}));
app.use(bodyParser.json({limit: '10mb'}));
app.use(bodyParser.urlencoded({limit: '100mb', extended: false}));

// 接收文本并抽取知识元
app.post("/", function (req, response) {
    console.log('----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------');
    var text = JSON.parse(JSON.stringify(req.body));  // 中文原始文本
    if ((typeof text) !== 'string') {
        text = Object.keys(text)[0];  // python调用时
    }
    console.log('text=' + text);  /////////////////////
    request.post({
        url: "http://triple.ruoben.com:8008",  // "http://triple-svc:50000"
        headers: {
            "Content-Type": "text/plain"
        },
        body: text,
        timeout: 600000
    }, function (err, res, json) {
        if (err) {
            console.error(err);
            response.header('Content-Type', 'text/plain; charset=utf-8').status(500).end(err);
        } else {
            if (res.statusCode === 200) {
                var array = JSON.parse(json);
                var result = {events: [], facts: []};
                for(var i=0; i<array.length; i++) {
                    extract_event(array[i], result.events);
                    _.remove(result.events, function(event) {
                        return event.time === "" && event.place === "" && event.subject === "";
                    });
                    extract_fact(array[i], result.facts);
                }
                var r = JSON.stringify(result);
                console.log(r);
                response.header('Content-Type', 'application/json; charset=utf-8').status(200).end(r);
            } else {
                console.error("调用triple接口报错");
                response.header('Content-Type', 'text/plain; charset=utf-8').status(500).end("调用triple接口报错");
            }
        }
    });
});
/*
主语 宾语
[]： 地点    <>： 地点的方向    ()： 修饰语     {}： 数（量）词    《》： 机构    ``： 人名     【】：主语中心语     ~~： 其他

谓语
()： 时间（状语或补语）     «»： 时间的方向     []： 地点（状语或补语）    <>： 地点的方向     【】： 谓语中心语     ~~： 其他
*/
function extract_event(spo, events) {
    var event = {time: "", place: "", subject: "", predicate: "", object: ""};
    if ((typeof spo) !== 'string') {  // spo三元组
        // 时间和方向（只在谓语中有）
        var match = spo.p.match(/\(.+?\)|«.+?»/g);
        if (match !== null) {
            for (var i=0; i<match.length; i++) {
                event.time += match[i];
            }
        }
        // 谓语的地点和方向
        match = spo.p.match(/\[.+?\]|<.+?>/g);
        if (match !== null) {
            for (i=0; i<match.length; i++) {
                event.place += match[i];
            }
        }
        // 主语的地点和方向
        if (event.place === "") {
            match = spo.s.match(/\[.+?\]|<.+?>/g);
            if (match !== null) {
                for (i=0; i<match.length; i++) {
                    event.place += match[i];
                }
            }
        }
        // 主语
        match = spo.s.match(/\[.+?\]|<.+?>|~.+?~|{.+?}|《.+?》|`.+?`|【.+?】/g);
        if (match !== null) {
            for (i=0; i<match.length; i++) {
                event.subject += match[i];
            }
        } else {
            event.subject += spo.s;
        }
        // 谓语（要带否定词）
        match = spo.p.match(/~.+?~|【.+?】/g);
        if (match !== null) {
            for (i=0; i<match.length; i++) {
                event.predicate += match[i];
            }
        } else {
            event.predicate += spo.p;
        }
        if ((typeof spo.o) === 'string') {
            // 宾语的地点和方向
            if (event.place === "") {
                match = spo.o.match(/\[.+?\]|<.+?>/g);
                if (match !== null) {
                    for (i=0; i<match.length; i++) {
                        event.place += match[i];
                    }
                }
            }
            // 宾语
            match = spo.o.match(/\[.+?\]|<.+?>|~.+?~|{.+?}|\(.+?\)|《.+?》|`.+?`|【.+?】/g);
            if (match !== null) {
                for (i=0; i<match.length; i++) {
                    event.object += match[i];
                }
            } else {
                event.object += spo.o;
            }
            events.push(event);
        } else {
            // 宾语（扁平化）
            event.object += flatten(spo.o);
            events.push(event);
            for(var index=0; index<spo.o.length; index++) {
                extract_event(spo.o[index], events);
            }
        }
    }
}

function flatten(obj) {
    var result = "";
    function recurse(src) {
        var toString = Object.prototype.toString;
        if (toString.call(src) === '[object Object]') {
            recurse(src["s"]);
            recurse(src["p"]);
            recurse(src["o"]);
        } else if (toString.call(src) === '[object Array]') {
            for(var i=0; i<src.length; i++) {
                recurse(src[i]);
            }
        } else {
            result = merge_concat(result, src.replace(/~/g, ''));
        }
    }
    if (obj) {
        recurse(obj);
    }
    return result;
}

function merge_concat(s1, s2) {
    var m = Math.min(s1.length, s2.length);
    for(var i=m; i>0; i--) {
        if (s1.substring(s1.length-i) === s2.substring(0, i)) {
            return s1 + s2.substring(i);
        } else if (s2.substring(s2.length-i) === s1.substring(0, i)) {
            return s2 + s1.substring(i);
        }
    }
    return s1 + s2;
}

function extract_fact(spo, facts) {
    if ((typeof spo) !== 'string') {  // spo三元组
        // 主语
        var match = spo.s.match(/\[.+?\]|<.+?>|{.+?}|【.+?】/g);
        if (match !== null) {
            var fact = {place1: "", place2: "", direction: "", distance: ""};
            for (var i=0; i<match.length; i++) {
                if (match[i].indexOf('【') === 0) {
                    fact.place1 = match[i];
                } else if (match[i].indexOf('[') === 0) {
                    fact.place2 = match[i];
                } else if (match[i].indexOf('<') === 0) {
                    fact.direction = match[i];
                } else if (match[i].indexOf('{') === 0) {
                    fact.distance = match[i];
                }
            }
            if (fact.place1 && fact.place2 && fact.direction) {
                facts.push(fact);
            }
        }
        if ((typeof spo.o) === 'string') {
            // 宾语
            fact = {place1: "", place2: "", direction: "", distance: ""};
            match = spo.s.match(/【.+?】/g);
            if (match !== null) {
                fact.place1 = match[0];
            }
            match = spo.o.match(/\[.+?\]|<.+?>|{.+?}/g);
            if (match !== null) {
                for (i=0; i<match.length; i++) {
                    if (match[i].indexOf('[') === 0) {
                        fact.place2 = match[i];
                    } else if (match[i].indexOf('<') === 0) {
                        fact.direction = match[i];
                    } else if (match[i].indexOf('{') === 0) {
                        fact.distance = match[i];
                    }
                }
                if (fact.place1 && fact.place2 && fact.direction) {
                    facts.push(fact);
                }
            }
        } else {
            for(var index=0; index<spo.o.length; index++) {
                extract_fact(spo.o[index], facts);
            }
        }
    }
}

app.listen(44444, '0.0.0.0');