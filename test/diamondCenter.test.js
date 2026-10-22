
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { initDiamondCenter } = require("../diamondCenter.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-dc-"));
const users = {
  m1: { userId: "seller1", name: "Seller", diamonds: 0 },
  m2: { userId: "buyer1", name: "Buyer", diamonds: 10 },
  m3: { userId: "selftarget", name: "Self Target", diamonds: 0 },
};
const routes = [];
const app = {
  get(p, ...h) { routes.push({ method:"GET", path:p, handlers:h }); },
  post(p, ...h) { routes.push({ method:"POST", path:p, handlers:h }); },
  put(p, ...h) { routes.push({ method:"PUT", path:p, handlers:h }); },
};
const userAuth = { requireUserAuth: (req,res,next) => next() };
const rbac = {
  ROLES:{OWNER:"OWNER"},
  logAction(){},
};
const findUserByUserId = id => {
  const u = Object.values(users).find(x => x.userId === id);
  return u ? { user:u } : null;
};
const safeRead = (f,d) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f,"utf8")) : d;
const safeWrite = (f,d) => fs.writeFileSync(f, JSON.stringify(d,null,2));
const saveUsers = () => {};
const clampDiamondBalance = (_id,n) => Math.floor(n);
const logs = [];
const logTransaction = (...a) => logs.push(a);
const pushWalletUpdate = () => {};
const requireAdmin = (req,res,next) => next();
const requirePermission = () => (req,res,next) => next();
const deps = {
  app, DATA_FOLDER:tmp, safeRead, safeWrite, users, findUserByUserId, saveUsers,
  clampDiamondBalance, logTransaction, pushWalletUpdate, userAuth, rbac,
  requireAdmin, requirePermission, reqUserAgent:()=>"",
  actorCanAccessCountry:()=>true, countryDeniedResponse:()=>{}
};
initDiamondCenter(deps);

function route(method,p) {
  const r = routes.find(x => {
    if (x.method !== method) return false;
    const a=x.path.split("/"), b=p.split("/");
    if(a.length!==b.length) return false;
    return a.every((v,i)=>v.startsWith(":") || v===b[i]);
  });
  assert.ok(r, "route not found: "+method+" "+p);
  return r.handlers.at(-1);
}
function res() {
  return { statusCode:200, body:null, status(n){this.statusCode=n; return this;}, json(v){this.body=v; return this;} };
}

const adminReq = { body:{userId:"seller1",bonusPercent:6}, adminAccount:{id:"a1",username:"owner",role:"OWNER"}, ip:"127.0.0.1" };
let rr = res(); route("POST","/api/admin/diamond-centers/create")(adminReq,rr);
assert.strictEqual(rr.body.success,true);
assert.strictEqual(rr.body.center.packages[0].priceINR,100);
assert.strictEqual(rr.body.center.packages[0].diamonds,1000000);

rr=res(); route("POST","/api/admin/diamond-centers/seller1/topup")({...adminReq, params:{userId:"seller1"}, body:{diamonds:1100000}},rr);
assert.strictEqual(rr.body.success,true);
assert.strictEqual(rr.body.center.balanceDiamonds,1100000);

rr=res(); route("POST","/api/diamond-center/recharge")({
  authedMobile:"m1", body:{targetUserId:"buyer1",packageId:"pkg_default_100_1m"}
},rr);
assert.strictEqual(rr.body.success,true);
assert.strictEqual(rr.body.transaction.totalDiamonds,1060000);
assert.strictEqual(users.m2.diamonds,1060010);
assert.strictEqual(rr.body.center.balanceDiamonds,40000);
assert.strictEqual(logs.at(-1)[1],"diamonds");
assert.ok(!logs.at(-1).includes("coin"));

// Center owner can recharge their OWN User ID.
rr=res(); route("POST","/api/admin/diamond-centers/seller1/topup")({...adminReq, params:{userId:"seller1"}, body:{diamonds:3180000}},rr);
assert.strictEqual(rr.body.success,true);
rr=res(); route("POST","/api/diamond-center/recharge")({
  authedMobile:"m1", body:{targetUserId:"seller1",priceINR:300}
},rr);
assert.strictEqual(rr.body.success,true);
assert.strictEqual(users.m1.diamonds,3180000);
assert.strictEqual(rr.body.transaction.totalDiamonds,3180000);
assert.strictEqual(rr.body.center.balanceDiamonds,40000);

// Direct INR amount flow: packageId is optional; server resolves the amount
// to the approved Party ₹1 = 10,000 Coins rate and applies the configured bonus.
rr=res(); route("POST","/api/admin/diamond-centers/seller1/topup")({...adminReq, params:{userId:"seller1"}, body:{diamonds:1600000}},rr);
assert.strictEqual(rr.body.success,true);
rr=res(); route("POST","/api/diamond-center/recharge")({
  authedMobile:"m1", body:{targetUserId:"buyer1",priceINR:150}
},rr);
assert.strictEqual(rr.body.success,true);
assert.strictEqual(rr.body.transaction.baseDiamonds,1500000);
assert.strictEqual(rr.body.transaction.totalDiamonds,1590000);
assert.strictEqual(users.m2.diamonds,2650010);
assert.strictEqual(rr.body.transaction.customAmount,true);

console.log("diamondCenter direct/custom/self flow: PASS");

console.log("diamondCenter.test.js: PASS");
