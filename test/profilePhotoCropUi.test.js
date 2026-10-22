const fs=require('fs');const path=require('path');const assert=require('assert');
const app=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../public/style.css'),'utf8');
assert(app.includes('function handlePsPhoto(file)'));
assert(app.includes('pp-crop-overlay'));
assert(app.includes('canvas.toBlob'));
assert(app.includes('12 * 1024 * 1024'));
assert(css.includes('.pp-crop-overlay'));
console.log('profilePhotoCropUi: PASS');
