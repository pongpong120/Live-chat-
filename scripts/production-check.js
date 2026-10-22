'use strict';
require('dotenv').config();
const db=require('../db/connection');const redis=require('../redis/client');const storage=require('../storage/objectStorage');
(async()=>{const out={node:process.version,production:process.env.NODE_ENV==='production',database:await db.health(),redis:redis.isEnabled()?redis.getHealth():{enabled:false},storage:storage.provider(),voiceMode:process.env.VOICE_MODE||'mesh'};console.log(JSON.stringify(out,null,2));const ok=!out.production||(out.database.ok&&out.storage==='s3');if(!ok)process.exitCode=2;await db.close();try{await redis.shutdown();}catch(_){}})();
