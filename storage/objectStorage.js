'use strict';
const crypto = require('crypto');
const path = require('path');
let S3Client, PutObjectCommand, DeleteObjectCommand;
try { ({ S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3')); } catch (_) {}

function provider() { return process.env.STORAGE_PROVIDER || (process.env.S3_BUCKET ? 's3' : 'local'); }
function assertProductionStorage() {
  if (process.env.NODE_ENV === 'production' && provider() !== 's3') {
    throw new Error('Production storage requires STORAGE_PROVIDER=s3 and an S3-compatible bucket');
  }
  if (provider() === 's3' && (!S3Client || !process.env.S3_BUCKET)) throw new Error('S3 storage selected but @aws-sdk/client-s3 or S3_BUCKET is missing');
}
function client() {
  return new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: process.env.S3_ACCESS_KEY_ID ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } : undefined
  });
}
function sanitizeExtension(name='') { const ext=path.extname(name).toLowerCase().replace(/[^a-z0-9.]/g,''); return ext.slice(0,10); }
function createObjectKey(category, originalName='') { return `${String(category||'misc').replace(/[^a-zA-Z0-9_-]/g,'_')}/${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}${sanitizeExtension(originalName)}`; }
async function put({key,body,contentType,metadata={}}) {
  assertProductionStorage();
  if (provider()==='local') return { provider:'local', key, url:`/uploads/${key}` };
  await client().send(new PutObjectCommand({ Bucket:process.env.S3_BUCKET, Key:key, Body:body, ContentType:contentType, Metadata:metadata }));
  const base=(process.env.S3_PUBLIC_BASE_URL||'').replace(/\/$/,'');
  return { provider:'s3', key, url:base?`${base}/${key}`:null };
}
async function remove(key) {
  if (!key) return;
  if (provider()==='s3') await client().send(new DeleteObjectCommand({Bucket:process.env.S3_BUCKET,Key:key}));
}
module.exports={provider,assertProductionStorage,createObjectKey,put,remove};
