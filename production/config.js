'use strict';
function validateProductionConfig(){
  if(process.env.NODE_ENV!=='production') return {ok:true,warnings:[]};
  const errors=[],warnings=[];
  if(!process.env.DATABASE_URL)errors.push('DATABASE_URL is required');
  if(String(process.env.CLUSTER_ENABLED||'false').toLowerCase()==='true'&&!process.env.REDIS_URL&&!process.env.REDIS_HOST)errors.push('Redis is required when CLUSTER_ENABLED=true');
  const voice=process.env.VOICE_MODE||'mesh';
  if(voice==='sfu' && !(process.env.LIVEKIT_URL&&process.env.LIVEKIT_API_KEY&&process.env.LIVEKIT_API_SECRET))errors.push('LiveKit credentials are required for VOICE_MODE=sfu');
  if(voice==='agora' && !(process.env.AGORA_APP_ID&&process.env.AGORA_APP_CERTIFICATE))errors.push('Agora credentials are required for VOICE_MODE=agora');
  if(!process.env.CLOUDFLARE_TURN_API_TOKEN && !process.env.TURN_URL && !process.env.TURN_SECRET)warnings.push('No TURN configuration detected; 1:1 WebRTC calls may fail on restrictive networks');
  if((process.env.STORAGE_PROVIDER||'').toLowerCase()!=='s3')errors.push('STORAGE_PROVIDER=s3 is required in production');
  return {ok:errors.length===0,errors,warnings};
}
module.exports={validateProductionConfig};
