'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const wheel = fs.readFileSync(path.join(root, 'public/foodwheel/index.html'), 'utf8');

assert.match(server, /if\s*\(!g\s*\|\|\s*g\.settling\)\s*return/, 'round settlement must lock against duplicate async timer calls');
assert.match(server, /g\.settling\s*=\s*true/, 'settlement lock must be set before wallet awaits');
assert.match(server, /if\s*\(g\.settling\)\s*return/, 'tick must not start another settlement while wallet operations are pending');
assert.match(server, /settlement locked for reconciliation/, 'partial settlement errors must not auto-retry and double-credit');
assert.match(app, /Number\(data\.roundId\)\s*!==\s*Number\(fruitWheelLiveState\.roundId\)/, 'late per-user results from an old round must be discarded');
assert.match(app, /const sameRound = data && fruitWheelLiveState && Number\(data\.roundId\) === Number\(fruitWheelLiveState\.roundId\)/, 'late winner broadcasts from old rounds must be discarded');
assert.match(wheel, /var currentRoundId=null/, 'iframe bridge tracks its current round');
assert.match(wheel, /incomingRound<currentRoundId/, 'iframe bridge ignores out-of-order older round-state packets');
assert.match(wheel, /Number\(d\.roundId\)===currentRoundId/, 'iframe bridge only accepts result/winner packets for its current round');
console.log('Fruit Wheel round isolation, duplicate-settlement lock and stale-result regression checks: PASS');
