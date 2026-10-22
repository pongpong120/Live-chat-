const assert = require("assert");
const { initAgencyHost } = require("../agencyHost");

const routes = [];
const app = {
  get(path, ...handlers) { routes.push({ method:"GET", path, handlers }); },
  post(path, ...handlers) { routes.push({ method:"POST", path, handlers }); },
  put(path, ...handlers) { routes.push({ method:"PUT", path, handlers }); }
};
const users = {
  owner1: { userId:"owner1", mobile:"m1", countryId:"IN", agencyId:"ag1" },
  owner2: { userId:"owner2", mobile:"m2", countryId:"IN", agencyId:"ag2" },
  host1: { userId:"host1", mobile:"h1", countryId:"IN", agencyId:"ag1", isHost:true },
  host2: { userId:"host2", mobile:"h2", countryId:"IN", agencyId:"ag2", isHost:true }
};
const agencies = {
  ag1: { agencyId:"ag1", name:"Source", ownerUserId:"owner1", hostIds:["host1"], countryId:"IN", status:"active" },
  ag2: { agencyId:"ag2", name:"Target", ownerUserId:"owner2", hostIds:["host2"], countryId:"IN", status:"active" },
  ag3: { agencyId:"ag3", name:"Other Country", ownerUserId:"owner3", hostIds:[], countryId:"BD", status:"active" },
  ag4: { agencyId:"ag4", name:"Closed", ownerUserId:"owner4", hostIds:[], countryId:"IN", status:"removed" }
};
const logs = [];
const mid = (_req,_res,next) => next();
const rbac = { logAction(x){ logs.push(x); }, listLogs(){ return {entries:logs}; } };
const findUserByUserId = id => {
  const u = Object.values(users).find(x => x.userId === String(id));
  return u ? { user:u } : null;
};
initAgencyHost({
  app, io:{}, DATA_FOLDER:"/tmp", safeRead:(_f,d)=>d, safeWrite(){}, users, findUserByUserId,
  saveUsers(){}, agencies, saveAgencies(){}, rooms:{}, socketsByUserId:{}, emitToUser(){},
  giftHistory:[], registerGiftRecordedHook(){}, periodStart(){return 0}, privateMessages:{},
  saveMessages(){}, conversationKey(){return""}, INSTANT_EXCHANGE_ESTIMATE_RATE:1,
  userAuth:{requireUserAuth:mid}, rbac, requireAdmin:mid, requirePermission:()=>mid,
  actorCanAccessCountry:(_a,c)=>c === "IN", countryDeniedResponse:res=>res.status(403).json({success:false}),
  reqUserAgent:()=> "test"
});
const route = routes.find(x => x.method === "POST" && x.path === "/api/admin/agency/:agencyId/transfer-host");
assert(route, "transfer route missing");
function res(){return {statusCode:200,body:null,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}}}
function call(params,body={}) {
  const r=res();
  route.handlers.at(-1)({params,body,adminAccount:{id:"a1",username:"admin"},ip:"127.0.0.1"},r);
  return r;
}
let r = call({agencyId:"ag1"},{hostUserId:"host1",targetAgencyId:"ag2"});
assert.strictEqual(r.body.success,true);
assert.deepStrictEqual(agencies.ag1.hostIds,[]);
assert.deepStrictEqual(agencies.ag2.hostIds,["host2","host1"]);
assert.strictEqual(users.host1.agencyId,"ag2");
assert.strictEqual(users.host1.isHost,true);
assert(logs.some(x=>x.action==="agency-host-transfer"));

r = call({agencyId:"ag2"},{hostUserId:"host1",targetAgencyId:"ag2"});
assert.strictEqual(r.statusCode,400);

r = call({agencyId:"ag1"},{hostUserId:"host1",targetAgencyId:"ag2"});
assert.strictEqual(r.statusCode,404);

users.host2.agencyId="ag2";
r = call({agencyId:"ag2"},{hostUserId:"host2",targetAgencyId:"ag3"});
assert.strictEqual(r.statusCode,403);

r = call({agencyId:"ag2"},{hostUserId:"owner2",targetAgencyId:"ag1"});
assert.strictEqual(r.statusCode,404);

r = call({agencyId:"ag2"},{hostUserId:"host2",targetAgencyId:"ag4"});
assert.strictEqual(r.statusCode,409);

console.log("agency host transfer: PASS");
