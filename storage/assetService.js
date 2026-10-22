'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');
const storage=require('./objectStorage');const validation=require('./uploadValidation');const db=require('../db/connection');
async function imageDimensions(buffer,mimeType){
  if(!/^image\//.test(mimeType)) return {width:null,height:null};
  try { const sharp=require('sharp'); const m=await sharp(buffer).metadata(); return {width:m.width||null,height:m.height||null}; } catch (_) {}
  try { const Jimp=require('jimp'); const img=await Jimp.read(buffer); return {width:img.bitmap.width,height:img.bitmap.height}; } catch (_) {}
  return {width:null,height:null};
}
async function saveAsset({buffer,mimeType,originalName,category,ownerUserId=null,localDir,maxBytes=8*1024*1024}){
  validation.validate({buffer,mimeType,originalName,maxBytes});
  const dims=await imageDimensions(buffer,mimeType);
  if(dims.width && dims.height && (dims.width>4096 || dims.height>4096)) throw new Error('Image dimensions exceed 4096x4096');
  if(/^image\//.test(mimeType) && (!dims.width || !dims.height) && process.env.NODE_ENV==='production') throw new Error('Unable to verify image dimensions');
  const key=storage.createObjectKey(category,originalName);
  let url;
  if(storage.provider()==='s3') ({url}=await storage.put({key,body:buffer,contentType:mimeType}));
  else { const ext=path.extname(originalName||'').toLowerCase()||'.bin'; const filename=`${crypto.randomUUID()}${ext}`;fs.mkdirSync(localDir,{recursive:true});fs.writeFileSync(path.join(localDir,filename),buffer);url=`/${category}/${filename}`; }
  if(db.enabled()) await db.getPool().query(`INSERT INTO upload_assets(owner_user_id,category,object_key,original_name,mime_type,byte_size,storage_provider,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[ownerUserId,category,key,originalName,mimeType,buffer.length,storage.provider(),dims.width,dims.height]);
  return {key,url,provider:storage.provider()};
}
module.exports={saveAsset};
