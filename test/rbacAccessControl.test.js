const path=require('path');const fs=require('fs');const os=require('os');const rbac=require(path.join(__dirname,'..','rbac'));
let pass=0,fail=0;function assert(c,m){if(c){pass++;console.log('  ✓',m)}else{fail++;console.error('  ✗ FAIL:',m)}}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rbac-party-'));const store=rbac.makeStore(dir);const owner=store.ensureOwnerAccount('owner','ownerpw123456');
console.log('=== Party RBAC roles ===');
assert(store.ROLES.OWNER==='owner','Owner role remains the root role');
assert(store.createAccount({creator:owner,username:'adm',password:'pw123456',role:store.ROLES.ADMIN}).success,'Owner can create standard Admin');
for(const role of [store.ROLES.GLOBAL_SUPER_ADMIN,store.ROLES.COUNTRY_SUPER_ADMIN,store.ROLES.COUNTRY_MANAGER]){const r=store.createAccount({creator:owner,username:'legacy-'+role,password:'pw123456',role,countryId:'IN'});assert(!r.success,'Retired manager role cannot be created: '+role)}
const adm=store.createAccount({creator:owner,username:'adm2',password:'pw123456',role:store.ROLES.ADMIN,permissions:['users:view']});assert(adm.success,'Admin custom permissions still work');assert(store.effectivePermissions(adm.account).length===1,'Explicit Admin permissions remain exact');
fs.rmSync(dir,{recursive:true,force:true});console.log(`\n${pass} passed, ${fail} failed`);process.exit(fail?1:0);
