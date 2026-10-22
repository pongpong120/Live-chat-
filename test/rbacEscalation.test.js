const path=require('path');const fs=require('fs');const os=require('os');const rbac=require(path.join(__dirname,'..','rbac'));
let pass=0,fail=0;function assert(c,m){if(c){pass++;console.log('  ✓',m)}else{fail++;console.error('  ✗ FAIL:',m)}}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rbac-party-escalation-'));const store=rbac.makeStore(dir);const owner=store.ensureOwnerAccount('owner','ownerpw123456');
console.log('=== Retired role escalation guard ===');
for(const role of [store.ROLES.GLOBAL_SUPER_ADMIN,store.ROLES.COUNTRY_SUPER_ADMIN,store.ROLES.COUNTRY_MANAGER]){const r=store.createAccount({creator:owner,username:'legacy-'+role,password:'pw123456',role,countryId:'IN',permissions:['role:manage','country:manage','users:view']});assert(!r.success,'Retired role is rejected: '+role)}
const a=store.createAccount({creator:owner,username:'adm',password:'pw123456',role:store.ROLES.ADMIN,permissions:['users:view']});assert(a.success,'Standard Admin creation remains available');
const edit=store.updateAccount(owner,a.account.id,{permissions:['role:manage','users:view']});assert(edit.success,'Owner can update an Admin account');assert(!edit.account.permissions.includes('role:manage'),'Protected role management permission stays stripped');
fs.rmSync(dir,{recursive:true,force:true});console.log(`\n${pass} passed, ${fail} failed`);process.exit(fail?1:0);
