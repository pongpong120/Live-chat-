const assert = require("assert");
const { initAgencyHost } = require("../agencyHost");

function makeRes() {
  return {
    statusCode: 200, headers: {}, body: null,
    status(n) { this.statusCode = n; return this; },
    json(v) { this.body = v; return this; },
    set(k,v) { this.headers[k] = v; return this; },
    send(v) { this.body = v; return this; }
  };
}
const routes = [];
const app = {
  get(path, ...handlers) { routes.push({ method:"GET", path, handlers }); },
  post(path, ...handlers) { routes.push({ method:"POST", path, handlers }); },
  put(path, ...handlers) { routes.push({ method:"PUT", path, handlers }); }
};
const users = {
  mobile1: { userId:"u1", mobile:"mobile1", name:"Test User", countryId:"IN" },
  mobile2: { userId:"u2", mobile:"mobile2", name:"Host User", countryId:"IN" }
};
const agencies = {
  ag1: { agencyId:"ag1", name:"Test Agency", ownerUserId:"u2", hostIds:["u2"], countryId:"IN", handlerAdminId:"admin1", handlerAdminUsername:"control1", handlerAdminName:"Control One", handlerAdminRole:"admin" }
};
const giftHistory = [
  { giftHistoryId:"gh1", transactionId:"tx1", senderId:"u1", receiverId:"u2", roomId:"room1", roomName:"Blue Room", hostId:"u2", giftName:"Rose", giftId:"g1", quantity:2, diamondAmount:200, timestamp:"2026-09-23T10:00:00.000Z" },
  { giftHistoryId:"gh2", transactionId:"tx2", senderId:"u1", receiverId:"u2", roomId:"room2", roomName:"Gold Room", hostId:"u2", giftName:"Crown", giftId:"g2", quantity:1, diamondAmount:1000, timestamp:"2026-09-23T11:00:00.000Z" }
];
const findUserByUserId = id => {
  const u = Object.values(users).find(x => x.userId === String(id));
  return u ? { user:u } : null;
};
const safeRead = (_f, fallback) => fallback;
const safeWrite = () => {};
const middleware = (_req,_res,next) => next();
const rbac = {
  listLogs: () => ({ entries: [{ timestamp:"2026-09-23T12:00:00.000Z", module:"agency", targetId:"ag1", adminUsername:"control1", action:"agency-create", result:"success" }] }),
  logAction() {}
};
initAgencyHost({
  app, io:{}, DATA_FOLDER:"/tmp", safeRead, safeWrite, users, findUserByUserId, saveUsers(){}, agencies, saveAgencies(){},
  rooms:{}, socketsByUserId:{}, emitToUser(){}, giftHistory, registerGiftRecordedHook(){}, periodStart(){return 0;},
  privateMessages:{}, saveMessages(){}, conversationKey(){return "";}, INSTANT_EXCHANGE_ESTIMATE_RATE:1,
  userAuth:{requireUserAuth:middleware}, rbac, requireAdmin:middleware, requirePermission:()=>middleware,
  actorCanAccessCountry:()=>true, countryDeniedResponse:(res)=>res.status(403).json({success:false}), reqUserAgent:()=> "test"
});

function find(path) { return routes.find(r => r.method === "GET" && r.path === path); }
assert(find("/api/admin/user-inquiry/:userId"));
assert(find("/api/admin/user-inquiry/:userId/pdf"));
assert(find("/api/admin/agency/:agencyId/control/pdf"));

const inquiryRoute = find("/api/admin/user-inquiry/:userId");
const req = { params:{userId:"u1"}, adminAccount:{id:"admin1",username:"control1"} };
const res = makeRes();
inquiryRoute.handlers.at(-1)(req,res);
assert.strictEqual(res.body.success, true);
assert.strictEqual(res.body.report.totalDiamonds, 1200);
assert.strictEqual(res.body.report.gifts.length, 2);
assert.strictEqual(res.body.report.rooms.length, 2);

const pdfRoute = find("/api/admin/user-inquiry/:userId/pdf");
const pdfRes = makeRes();
pdfRoute.handlers.at(-1)(req,pdfRes);
assert.strictEqual(pdfRes.headers["Content-Type"], "application/pdf");
assert(Buffer.isBuffer(pdfRes.body));
assert(pdfRes.body.subarray(0,8).toString() === "%PDF-1.4");

const agencyPdfRoute = find("/api/admin/agency/:agencyId/control/pdf");
const agencyRes = makeRes();
agencyPdfRoute.handlers.at(-1)({params:{agencyId:"ag1"}, adminAccount:{id:"admin1",username:"control1"}}, agencyRes);
assert.strictEqual(agencyRes.headers["Content-Type"], "application/pdf");
assert(Buffer.isBuffer(agencyRes.body));
assert(agencyRes.body.subarray(0,8).toString() === "%PDF-1.4");

console.log("agencyControlInquiry: PASS");
