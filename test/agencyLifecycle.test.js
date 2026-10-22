
const assert=require("assert");
const {initAgencyHost}=require("../agencyHost.js");
const routes=[];
const emitted=[];
const app={get(p,...h){routes.push({m:"GET",p,h});},post(p,...h){routes.push({m:"POST",p,h});}};
const users={m:{userId:"owner1",mobile:"m",name:"Owner",countryId:"IN",agencyId:"ag1"},h:{userId:"host1",mobile:"h",name:"Host",countryId:"IN",agencyId:"ag1",isHost:true}};
const agencies={ag1:{agencyId:"ag1",name:"Agency",ownerUserId:"owner1",hostIds:["host1"],countryId:"IN",status:"active"}};
const mid=(req,res,next)=>next();
const rbac={logAction(){},listLogs(){return {entries:[]}}};
const deps={app,io:{},DATA_FOLDER:"/tmp",safeRead:(_f,d)=>d,safeWrite(){},users,
findUserByUserId:id=>{const u=Object.values(users).find(x=>x.userId===id);return u?{user:u}:null;},
saveUsers(){},agencies,saveAgencies(){},rooms:{},socketsByUserId:{},emitToUser(...args){emitted.push(args);},giftHistory:[],registerGiftRecordedHook(){},
periodStart(){return 0},privateMessages:{},saveMessages(){},conversationKey(){return""},INSTANT_EXCHANGE_ESTIMATE_RATE:1,
userAuth:{requireUserAuth:mid},rbac,requireAdmin:mid,requirePermission:()=>mid,actorCanAccessCountry:()=>true,countryDeniedResponse:res=>res.status(403).json({success:false}),reqUserAgent:()=>""};
initAgencyHost(deps);
function get(p){const x=routes.find(r=>r.m==="POST"&&r.p===p);assert(x);return x.h.at(-1);}
function res(){return {statusCode:200,body:null,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;},set(){return this;},send(v){this.body=v;return this;}}}
const baseReq={params:{agencyId:"ag1"},adminAccount:{id:"a1",username:"admin",role:"owner"}};
let r=res(); get("/api/admin/agency/:agencyId/remove")(baseReq,r);
assert.strictEqual(r.body.success,true); assert.strictEqual(agencies.ag1.status,"removed"); assert.deepStrictEqual(agencies.ag1.hostIds,[]);
assert.strictEqual(users.h.agencyId,undefined); assert.strictEqual(users.m.agencyId,undefined);
assert(emitted.some(x=>x[0]==="host1" && x[1]==="host-status-update" && x[2].isHost===false));

agencies.ag1.status="active"; agencies.ag1.hostIds=["host1"]; users.m.agencyId="ag1"; users.h.agencyId="ag1"; users.h.isHost=true;
r=res(); get("/api/admin/agency/:agencyId/terminate")(baseReq,r);
assert.strictEqual(r.body.success,true); assert.strictEqual(agencies.ag1.status,"terminated"); assert.deepStrictEqual(agencies.ag1.hostIds,[]);
console.log("agency remove/terminate lifecycle: PASS");
