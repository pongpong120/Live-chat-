'use strict';
const db=require('../db/connection');
const redis=require('../redis/client');
const wallet=require('./walletAuthority');
const storage=require('../storage/objectStorage');
const refresh=require('../security/refreshTokens');
const {run:runMigrations}=require('../db/migrate');
const {validateProductionConfig}=require('./config');
let state={started:false,ready:false,startedAt:null};
async function start({users=null,clampDiamondBalance,clampBeansBalance}={}){
  state.startedAt=new Date().toISOString();
  const config=validateProductionConfig();
  if(!config.ok) throw new Error(config.errors.join('; '));
  config.warnings.forEach(w=>console.warn('[production-config] '+w));
  if(process.env.NODE_ENV==='production'&&!db.enabled()) throw new Error('PostgreSQL driver/configuration is unavailable');
  if(db.enabled()){
    await runMigrations();
    await wallet.init({redisPool:redis.getConnection?.(),clampDiamondBalance,clampBeansBalance});
    if(users){await wallet.bootstrapUsers(users);await wallet.hydrateUsers(users);}
  }
  if(process.env.NODE_ENV==='production')storage.assertProductionStorage();
  state.started=true;state.ready=true;return state;
}
async function health(){const database=await db.health();const redisHealth=redis.isEnabled()?redis.getHealth():{enabled:false};return {server:'ok',ready:state.ready,database,redis:redisHealth,storage:storage.provider(),startedAt:state.startedAt};}
async function shutdown(){state.ready=false;try { const w=require('../integration_update/module4_wallet_ledger/wallet/index.js'); if (w.shutdown) await w.shutdown(); } catch (_) {}await db.close();try{await redis.shutdown();}catch(_){} }
module.exports={start,health,shutdown,state,wallet,refresh,storage};
