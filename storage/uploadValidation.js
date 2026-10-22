'use strict';
const path=require('path');
const MAGIC={
  'image/png': b=>b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')),
  'image/jpeg': b=>b.subarray(0,3).equals(Buffer.from('ffd8ff','hex')),
  'image/webp': b=>b.subarray(0,4).toString('ascii')==='RIFF' && b.subarray(8,12).toString('ascii')==='WEBP',
  'image/gif': b=>b.subarray(0,6).toString('ascii')==='GIF87a' || b.subarray(0,6).toString('ascii')==='GIF89a',
  'audio/mpeg': b=>b.subarray(0,3).toString('ascii')==='ID3' || (b[0]===0xff && (b[1]&0xe0)===0xe0),
  'video/mp4': b=>b.length>12 && b.subarray(4,8).toString('ascii')==='ftyp'
};
function validate({buffer,mimeType,originalName,maxBytes=30*1024*1024,allowed=['image/png','image/jpeg','image/webp','image/gif','audio/mpeg','video/mp4']}) {
  if(!Buffer.isBuffer(buffer)) throw new Error('Invalid upload body');
  if(!allowed.includes(mimeType)) throw new Error('Unsupported file type');
  if(buffer.length>maxBytes) throw new Error('File too large');
  const check=MAGIC[mimeType]; if(check && !check(buffer)) throw new Error('File content does not match declared type');
  const ext=path.extname(originalName||'').toLowerCase(); if(ext.length>10) throw new Error('Invalid filename');
  return true;
}
module.exports={validate};
