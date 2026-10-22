const assert = require('assert');
const { initHostSalary, LEVELS } = require('../hostSalary.js');

function makeHarness() {
  const routes = { get: {}, post: {}, put: {} };
  const app = { get(path,...handlers){routes.get[path]=handlers}, post(path,...handlers){routes.post[path]=handlers}, put(path,...handlers){routes.put[path]=handlers} };
  const users = {
    a:{userId:'H1',name:'Host One',isHost:true,countryId:'BD',country:'BD',beans:0},
    b:{userId:'H2',name:'Host Two',isHost:true,countryId:'IN',country:'IN',beans:10},
    c:{userId:'H3',name:'No Agency Host',isHost:true,countryId:'BD',country:'BD',beans:0}
  };
  const giftHistory=[
    {hostId:'H1',agencyId:null,diamondAmount:100000,timestamp:'2026-08-10T00:00:00.000Z'},
    {hostId:'H2',agencyId:'legacy',diamondAmount:500000,timestamp:'2026-08-12T00:00:00.000Z'},
    {hostId:'H3',agencyId:null,diamondAmount:150000,timestamp:'2026-08-12T00:00:00.000Z'}
  ];
  const saved={},notifications=[];
  const rbac={logAction:()=>{},ROLES:{OWNER:'owner'},COUNTRIES:[{id:'IN'},{id:'BD'},{id:'OTHERS'}],COUNTRY_IDS:['IN','BD','OTHERS']};
  const owner={id:'owner1',username:'owner',role:'owner',countryId:null};
  const deps={app,DATA_FOLDER:'/tmp/host-salary-test-v2',safeRead:(f,fb)=>fb,safeWrite:(f,d)=>{saved[f]=JSON.parse(JSON.stringify(d))},users,findUserByUserId:id=>{for(const [mobile,user] of Object.entries(users))if(user.userId===id)return{mobile,user};return null},saveUsers:()=>{},agencies:{},giftHistory,registerGiftRecordedHook:fn=>{},emitToUser:()=>{},logTransaction:()=>{},pushWalletUpdate:()=>{},sendSystemMessage:(toUserId,message)=>{notifications.push({toUserId,message});return{success:true}},clampBeansBalance:(id,v)=>Math.floor(v),rbac,requireAdmin:(req,res,next)=>next(),requirePermission:()=> (req,res,next)=>next(),actorCanAccessCountry:()=>true,countryDeniedResponse:res=>res.status(403).json({success:false}),reqUserAgent:()=> 'test'};
  const service=initHostSalary(deps); return {routes,users,owner,saved,notifications,service};
}
function runRoute(route,req){const res={statusCode:200,body:null,status(c){this.statusCode=c;return this},json(b){this.body=b;return this},send(b){this.body=b;return this},set(){}};let i=0;const next=()=>{const h=route[i++];if(!h)return;const out=h(req,res,next);if(typeof out==='function') out(req,res,next)};next();return res}
const h=makeHarness();
const preview=runRoute(h.routes.get['/api/admin/host-salary/preview'],{adminAccount:h.owner,query:{from:'2026-08-01',to:'2026-08-31'}});
assert.strictEqual(preview.body.success,true); assert.strictEqual(preview.body.eligibleCount,3); assert.strictEqual(preview.body.totalBeans,2250000);
const h1=preview.body.rows.find(r=>r.userId==='H1'); const h2=preview.body.rows.find(r=>r.userId==='H2'); const h3=preview.body.rows.find(r=>r.userId==='H3');
assert.deepStrictEqual([h1.diamonds,h1.rewardBeans],[100000,300000]);
assert.deepStrictEqual([h2.diamonds,h2.rewardBeans],[500000,1500000]);
assert.deepStrictEqual([h3.diamonds,h3.rewardBeans],[150000,450000]);
const send=runRoute(h.routes.post['/api/admin/host-salary/send-all'],{adminAccount:h.owner,body:{from:'2026-08-01',to:'2026-08-31'}});
assert.strictEqual(send.body.success,true); assert.strictEqual(send.body.sent,3); assert.strictEqual(h.users.a.beans,300000); assert.strictEqual(h.users.b.beans,1500010); assert.strictEqual(h.users.c.beans,450000);
const again=runRoute(h.routes.post['/api/admin/host-salary/send-all'],{adminAccount:h.owner,body:{from:'2026-08-01',to:'2026-08-31'}}); assert.strictEqual(again.body.sent,0); assert.strictEqual(again.body.skipped,0); assert.strictEqual(again.body.eligible,0);
const manual=runRoute(h.routes.post['/api/admin/host-salary/manual-host'],{adminAccount:h.owner,body:{userId:'H3',beans:1000,reason:'Adjustment'}}); assert.strictEqual(manual.body.success,true); assert.strictEqual(h.users.c.beans,451000);
assert.strictEqual(typeof h.routes.post['/api/admin/host-salary/manual-agency'],'undefined');
assert.strictEqual(LEVELS[0].targetDiamonds,100000); assert.strictEqual(LEVELS[0].rewardBeans,300000); assert.ok(LEVELS.every(x=>x.rewardBeans===x.targetDiamonds*3));
console.log('hostSalary.test.js: PASS');
