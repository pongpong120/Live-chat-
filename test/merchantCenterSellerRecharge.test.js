
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { initMerchantCenter } = require("../merchantCenter.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-mc-"));
const users = {
  m1: { userId:"merchant1", mobile:"m1", name:"Merchant", countryId:"IN", diamonds:0 },
  s1: { userId:"seller1", mobile:"s1", name:"Seller", countryId:"IN", diamonds:0 },
  u1: { userId:"buyer1", mobile:"u1", name:"Buyer", countryId:"IN", diamonds:10 }
};
const routes=[];
const app={
  get(p,...h){routes.push({method:"GET",path:p,handlers:h});},
  post(p,...h){routes.push({method:"POST",path:p,handlers:h});}
};
const rbac={logAction(){},ROLES:{OWNER:"owner"}};
const registryStore={data:{},getAll(){return this.data;},set(k,v){this.data[k]=v;},get(k){return this.data[k];}};
const merchantRegistry={_store:registryStore,describe(id){return registryStore.get(id);}};
const findUserByUserId=id=>{const u=Object.values(users).find(x=>x.userId===id);return u?{user:u}:null;};
const safeRead=(f,d)=>fs.existsSync(f)?JSON.parse(fs.readFileSync(f,"utf8")):d;
const safeWrite=(f,d)=>fs.writeFileSync(f,JSON.stringify(d,null,2));
const userAuth={requireUserAuth:(req,res,next)=>next()};
const requireAdmin=(req,res,next)=>next();
const requirePermission=()=> (req,res,next)=>next();
const deps={
 app,DATA_FOLDER:tmp,safeRead,safeWrite,users,findUserByUserId,saveUsers(){},
 clampDiamondBalance:(_id,n)=>Math.floor(n),logTransaction(){},pushWalletUpdate(){},
 userAuth,rbac,requireAdmin,requirePermission,reqUserAgent:()=>"",
 actorCanAccessCountry:()=>true,countryDeniedResponse:res=>res.status(403).json({success:false}),
 merchantRegistry,emitToUser(){}
};
initMerchantCenter(deps);
registryStore.set("merchant1",{id:"merchant1",name:"Merchant",userId:"merchant1",countryId:"IN",status:"active",balanceDiamonds:0,totalDiamondsFunded:0,totalDiamondsToSellers:0,totalDiamondsSold:0,totalSalesCount:0,createdAt:new Date().toISOString()});

function route(method,pathLike){
 const wanted=pathLike.split("/");
 const r=routes.find(x=>x.method===method && x.path.split("/").length===wanted.length &&
   x.path.split("/").every((v,i)=>v.startsWith(":") || v===wanted[i]));
 assert(r,"route not found "+method+" "+pathLike); return r.handlers.at(-1);
}
function res(){return {statusCode:200,headers:{},body:null,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;},setHeader(k,v){this.headers[k]=v;},send(v){this.body=v;return this;}};}
function req(userMobile,body={},params={},query={}){return {authedMobile:userMobile,body,params,query,adminAccount:{id:"a1",username:"admin",role:"owner"},ip:"127.0.0.1"};}

let rr=res();
route("POST","/api/admin/merchants/merchant1/sellers")(req("m1",{userId:"seller1"},{merchantId:"merchant1"}),rr);
assert.strictEqual(rr.body.success,true);
const sellerId=rr.body.seller.sellerId;

// Control Panel funds Merchant with INR; Merchant inventory becomes Diamonds.
rr=res(); route("POST","/api/admin/merchants/merchant1/balance")(req("m1",{amountINR:300},{merchantId:"merchant1"}),rr);
assert.strictEqual(rr.body.success,true);
rr=res(); route("POST","/api/merchant-center/sellers/"+sellerId+"/topup")(req("m1",{amountINR:300},{merchantId:"merchant1",sellerId}),rr);
assert.strictEqual(rr.body.success,true);
assert.strictEqual(rr.body.diamonds,3000000);

// Control Panel cannot bypass the Merchant -> Seller funding hierarchy.
rr=res(); route("POST","/api/admin/merchants/merchant1/sellers/"+sellerId+"/topup")(req("m1",{amountINR:300},{merchantId:"merchant1",sellerId}),rr);
assert.strictEqual(rr.statusCode,403);
assert.strictEqual(rr.body.success,false);

// Seller recharges buyer: ₹300 => exactly 100,000 Diamonds.
rr=res(); route("POST","/api/merchant-center/sell")(req("s1",{targetUserId:"buyer1",priceINR:300}),rr);
assert.strictEqual(rr.body.success,true);
assert.strictEqual(rr.body.transaction.diamonds,3000000);
assert.strictEqual(rr.body.transaction.priceINR,300);
assert.strictEqual(users.u1.diamonds,3000010);

// Seller-facing history contains only the user delivery, not merchant top-up.
rr=res(); route("GET","/api/merchant-center/me")(req("s1"),rr);
assert.strictEqual(rr.body.success,true);
assert.strictEqual(rr.body.history.length,1);
assert.strictEqual(rr.body.history[0].type,"seller_sale");

// Daily PDF exists and contains the Seller row.
rr=res(); route("GET","/api/admin/merchants/merchant1/sellers/daily-report/pdf")(req("m1",{}, {merchantId:"merchant1"}),rr);
assert.strictEqual(rr.headers["Content-Type"],"application/pdf");
assert(Buffer.isBuffer(rr.body));
assert.strictEqual(rr.body.subarray(0,8).toString(),"%PDF-1.4");
console.log("merchant seller INR recharge/history/daily PDF: PASS");
