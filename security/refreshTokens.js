'use strict';
const crypto=require('crypto');
const {getPool,transaction}=require('../db/connection');
const ACCESS_TTL_MS=Number(process.env.ACCESS_TOKEN_TTL_MS||15*60*1000);
const REFRESH_TTL_MS=Number(process.env.REFRESH_TOKEN_TTL_MS||30*24*60*60*1000);
const token=()=>crypto.randomBytes(48).toString('base64url');
const hash=t=>crypto.createHash('sha256').update(String(t)).digest('hex');
async function createSession({userId,deviceId=null,userAgent=null,ip=null}){const access=token(),refresh=token(),now=Date.now(),p=getPool();if(!p)throw new Error('Postgres is required for production sessions');const r=await p.query(`INSERT INTO auth_sessions(user_id,access_token_hash,refresh_token_hash,device_id,user_agent,ip_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING session_id`,[userId,hash(access),hash(refresh),deviceId,userAgent,ip?hash(ip):null,new Date(now+ACCESS_TTL_MS),new Date(now+REFRESH_TTL_MS)]);return {sessionId:r.rows[0].session_id,accessToken:access,refreshToken:refresh,accessExpiresAt:new Date(now+ACCESS_TTL_MS).toISOString(),refreshExpiresAt:new Date(now+REFRESH_TTL_MS).toISOString()};}
// ROOT-CAUSE FIX (2026-09-26, "Expired" session bug — remaining gap after
// the 2026-09-25 client-side pass, see public/app.js AUDIT FIX comments):
// refresh tokens are single-use — a successful rotate() revokes the
// presented token in the same transaction that issues its replacement.
// public/app.js's tryRefreshProductionSession() retries /api/auth/refresh
// (with backoff, up to 3x) whenever a call fails, to survive a flaky
// mobile connection. That retry can't tell "the server never got my
// request" apart from "the server rotated my token but I lost the
// response on the way back" — in the second case the client is left
// holding a refresh token the server has already revoked, and every
// retry was hitting the plain 0-rows branch below and failing, which
// force-logged out a user whose session was, one hop away, still
// perfectly valid. REUSE_GRACE_MS gives a short window where reusing the
// immediately-superseded refresh token is treated as that lost-response
// retry: rotate again from the live end of the replaced_by chain instead
// of failing. Outside the window, or once the chain's live end is no
// longer live, reuse is refused exactly as before. Tradeoff, stated
// plainly: within this short window a captured *and already-used* old
// refresh token can also ride this same path to a live session — the
// same tradeoff every "refresh token reuse grace period" makes (Auth0,
// Okta, etc. use the same pattern, typically 5-30s). Keeping the window
// short and configurable (set to 0 to disable) bounds that exposure
// without reintroducing the original bug.
const REUSE_GRACE_MS=Number(process.env.REFRESH_TOKEN_REUSE_GRACE_MS||10000);
async function rotate(refreshToken,{deviceId=null,userAgent=null,ip=null}={}){if(!refreshToken||!getPool())return null;return transaction(async c=>{
    const q=await c.query(`SELECT * FROM auth_sessions WHERE refresh_token_hash=$1 AND revoked_at IS NULL AND refresh_expires_at>now() FOR UPDATE`,[hash(refreshToken)]);
    let old;
    if(q.rowCount){
        old=q.rows[0];
    }else if(REUSE_GRACE_MS>0){
        const grace=await c.query(`SELECT * FROM auth_sessions WHERE refresh_token_hash=$1 AND revoked_at IS NOT NULL AND revoked_at > now() - ($2 || ' milliseconds')::interval FOR UPDATE`,[hash(refreshToken),String(REUSE_GRACE_MS)]);
        if(!grace.rowCount)return null;
        // Walk the replaced_by chain to whichever session is currently live.
        let cursor=grace.rows[0];
        const seen=new Set([cursor.session_id]);
        while(cursor&&cursor.replaced_by){
            if(seen.has(cursor.replaced_by)){cursor=null;break;} // corrupt-chain guard
            const nxt=await c.query(`SELECT * FROM auth_sessions WHERE session_id=$1 FOR UPDATE`,[cursor.replaced_by]);
            if(!nxt.rowCount){cursor=null;break;}
            cursor=nxt.rows[0];
            seen.add(cursor.session_id);
        }
        if(!cursor||cursor.revoked_at||new Date(cursor.refresh_expires_at).getTime()<=Date.now())return null;
        old=cursor;
    }else{
        return null;
    }
    const access=token(),refresh=token(),now=Date.now();
    const n=await c.query(`INSERT INTO auth_sessions(user_id,access_token_hash,refresh_token_hash,device_id,user_agent,ip_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING session_id`,[old.user_id,hash(access),hash(refresh),deviceId||old.device_id,userAgent||old.user_agent,ip?hash(ip):old.ip_hash,new Date(now+ACCESS_TTL_MS),new Date(now+REFRESH_TTL_MS)]);
    await c.query(`UPDATE auth_sessions SET revoked_at=now(),replaced_by=$2,last_seen_at=now() WHERE session_id=$1`,[old.session_id,n.rows[0].session_id]);
    return {sessionId:n.rows[0].session_id,userId:old.user_id,accessToken:access,refreshToken:refresh,accessExpiresAt:new Date(now+ACCESS_TTL_MS).toISOString(),refreshExpiresAt:new Date(now+REFRESH_TTL_MS).toISOString()};
});}
async function validate(accessToken){if(!accessToken||!getPool())return null;const r=await getPool().query(`SELECT session_id,user_id,device_id FROM auth_sessions WHERE access_token_hash=$1 AND revoked_at IS NULL AND access_expires_at>now()`,[hash(accessToken)]);if(!r.rowCount)return null;await getPool().query('UPDATE auth_sessions SET last_seen_at=now() WHERE session_id=$1',[r.rows[0].session_id]);return r.rows[0];}
async function revoke(accessToken){if(accessToken&&getPool())await getPool().query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE access_token_hash=$1',[hash(accessToken)]);}
async function revokeRefresh(refreshToken){if(refreshToken&&getPool())await getPool().query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE refresh_token_hash=$1',[hash(refreshToken)]);}
async function revokeUser(userId){if(getPool())await getPool().query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1 AND revoked_at IS NULL',[userId]);}
module.exports={createSession,rotate,validate,revoke,revokeUser,revokeRefresh,ACCESS_TTL_MS,REFRESH_TTL_MS,REUSE_GRACE_MS};
