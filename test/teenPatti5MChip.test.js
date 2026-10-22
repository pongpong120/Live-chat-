'use strict';
const assert=require('assert');const fs=require('fs');
const server=fs.readFileSync(require.resolve('../games/teenPattiServer'),'utf8');
const html=fs.readFileSync(require.resolve('../public/games/teen-patti/index.html'),'utf8');
assert.match(server,/new Set\(\[1000, 100000, 500000, 1000000, 5000000\]\)/,'server must accept 5M chip');
assert.match(html,/selectChip\(5000000,this\)/,'Teen Patti UI must offer 5M chip');
assert.ok(fs.existsSync(require.resolve('../public/games/teen-patti/chip-5m.png')),'5M chip artwork must exist');
console.log('Teen Patti 5M chip server/UI integration: PASS');
