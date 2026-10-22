'use strict';
const os=require('os');
let counters={requests:0,errors:0,totalLatencyMs:0};
function requestMetrics(){return {...counters,avgLatencyMs:counters.requests?Math.round(counters.totalLatencyMs/counters.requests):0};}
function middleware(req,res,next){const started=process.hrtime.bigint();counters.requests++;res.on('finish',()=>{const ms=Number(process.hrtime.bigint()-started)/1e6;counters.totalLatencyMs+=ms;if(res.statusCode>=500)counters.errors++;if(process.env.STRUCTURED_LOGS==='true')console.log(JSON.stringify({ts:new Date().toISOString(),type:'http',requestId:req.httpRequestId||null,method:req.method,path:req.originalUrl,status:res.statusCode,latencyMs:Number(ms.toFixed(2)),pid:process.pid}));});next();}
function snapshot(){const m=process.memoryUsage();return {pid:process.pid,uptimeSec:Math.round(process.uptime()),cpuLoad1m:os.loadavg()[0],memory:{rssMB:Math.round(m.rss/1048576),heapUsedMB:Math.round(m.heapUsed/1048576)},requests:requestMetrics()};}
module.exports={middleware,snapshot,requestMetrics};
