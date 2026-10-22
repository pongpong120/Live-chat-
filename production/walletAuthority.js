'use strict';
const db=require('../db/connection');
const module4=require('../integration_update/module4_wallet_ledger/wallet/index.js');
let active=false;
function enabled(){return active;}
async function init({redisPool=null,clampDiamondBalance,clampBeansBalance}={}){
  if(!db.enabled()){active=false;return {enabled:false};}
  await module4.init({pgPool:db.getPool(),redisPool,clampFn:(userId,balance,context,currency)=>currency==='diamonds'?clampDiamondBalance?.(userId,balance,context)??balance:clampBeansBalance?.(userId,balance,context)??balance});
  active=true;return {enabled:true};
}
async function bootstrapUsers(users){
  if(!active)return {migrated:0};let migrated=0;
  for(const u of Object.values(users||{})){if(!u?.userId)continue;for(const currency of ['diamonds','beans']){const value=Math.max(0,Math.floor(Number(u[currency]||0)));const existing=await module4.getBalance(u.userId,currency);const ledgerCheck=await db.getPool().query('SELECT 1 FROM module4_wallet_ledger WHERE user_id=$1 AND currency=$2 LIMIT 1',[u.userId,currency]);if(ledgerCheck.rowCount===0&&existing===0&&value>0){const txn=`opening:${u.userId}:${currency}:v1`;try{await module4.credit({userId:u.userId,currency,amount:value,txnId:txn,reason:'opening-balance-migration',context:'legacy-json'});migrated++;}catch(e){if(!/already|conflict|duplicate/i.test(e.message))throw e;}}}}
  return {migrated};
}
async function hydrateUsers(users){if(!active)return;for(const u of Object.values(users||{})){if(!u?.userId)continue;for(const currency of ['diamonds','beans']){const b=await module4.getBalance(u.userId,currency);if(Number.isFinite(b))u[currency]=Number(b);}}}
function txnId(prefix='wallet'){return `${prefix}:${Date.now()}:${require('crypto').randomUUID()}`;}
async function credit(userId,currency,amount,reason,context,operationId=txnId('credit')){if(!active)return null;return module4.credit({userId,currency,amount,txnId:operationId,reason,context});}
async function debit(userId,currency,amount,reason,context,operationId=txnId('debit')){if(!active)return null;return module4.debit({userId,currency,amount,txnId:operationId,reason,context});}
async function transfer(fromUserId,toUserId,currency,amount,reason,context,operationId=txnId('transfer')){if(!active)return null;return module4.transferBetweenUsers({fromUserId,toUserId,currency,amount,txnId:operationId,reason,context});}
async function crossTransfer(fromUserId,toUserId,fromCurrency,toCurrency,amount,reason,context,operationId=txnId('cross')){if(!active)return null;return module4.transferCrossCurrency({fromUserId,toUserId,fromCurrency,toCurrency,amount,txnId:operationId,reason,context});}
async function crossBatch(fromUserId,fromCurrency,toCurrency,recipients,totalAmount,reason,context,operationId=txnId('batch')){if(!active)return null;return module4.transferCrossCurrencyBatch({fromUserId,fromCurrency,toCurrency,recipients,totalAmount,reason,context,txnId:operationId});}
async function balance(userId,currency){return active?module4.getBalance(userId,currency):null;}
module.exports={init,enabled,bootstrapUsers,hydrateUsers,credit,debit,transfer,crossTransfer,crossBatch,balance,txnId};
