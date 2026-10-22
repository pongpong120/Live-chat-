'use strict';
require('dotenv').config();
const {run}=require('../db/migrate');
const {getPool,health,close}=require('../db/connection');
(async()=>{try{await run();console.log('[bootstrap] PostgreSQL schema ready');console.log('[bootstrap] health',await health());}catch(e){console.error('[bootstrap] failed:',e.message);process.exitCode=1;}finally{await close();}})();
