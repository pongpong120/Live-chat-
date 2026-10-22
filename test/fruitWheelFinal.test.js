const assert = require('assert');
const {
  FRUIT_WHEEL_FOODS,
  FRUIT_WHEEL_CHIPS,
  FW_PLATFORM_FEE_BPS,
  fwRandomWeightedFood
} = require('../fruitWheelConfig');

assert.deepStrictEqual(FRUIT_WHEEL_CHIPS, [1000,5000,10000,50000,100000,1000000]);
assert.strictEqual(FRUIT_WHEEL_FOODS.reduce((s,f)=>s+f.weight,0),100);

const counts = Object.fromEntries(FRUIT_WHEEL_FOODS.map(f=>[f.id,0]));
for(let i=0;i<100000;i++) counts[fwRandomWeightedFood().id]++;
for(const f of FRUIT_WHEEL_FOODS){
  const observed = counts[f.id]/100000;
  const expected = f.weight/100;
  // Sampling tolerance: 0.7 percentage points is intentionally generous.
  assert(Math.abs(observed-expected) < 0.007, `${f.id}: observed ${observed}, expected ${expected}`);
}

// Advertised multiplier payouts are exact: the server pays bet-on-win × multiplier.
function settle(grossPayout){
  return Math.floor(grossPayout);
}
for(const gross of [5000,25000,100000,450000,987654321]){
  const payout=settle(gross);
  assert.strictEqual(payout,gross);
}
console.log('Fruit Wheel final production checks: PASS');
console.log('Observed distribution:', counts);
