'use strict';
const redis=require('../redis/client');const local=new Map();
function localLimit(key,{windowMs,max}){const now=Date.now();let b=local.get(key);if(!b||b.resetAt<=now)b={count:0,resetAt:now+windowMs};b.count++;local.set(key,b);return b.count<=max;}
async function allow(key,{windowMs=60000,max=30}={}){if(!redis.isEnabled())return localLimit(key,{windowMs,max});const c=redis.getConnection?.();if(!c)return localLimit(key,{windowMs,max});const k=`rate:${key}`;try{const n=await c.incr(k);if(n===1)await c.pexpire(k,windowMs);return n<=max;}catch(_){return localLimit(key,{windowMs,max});}}
function middleware(opts={}){return async(req,res,next)=>{const key=opts.keyFn?opts.keyFn(req):`${req.ip||'unknown'}:${req.path}`;if(await allow(key,opts))return next();res.status(429).json({success:false,message:'Too many requests'});};}
module.exports={allow,middleware};
