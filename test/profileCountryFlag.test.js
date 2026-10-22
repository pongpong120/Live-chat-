const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

assert.ok(index.includes('id="pp-country-badge"'), 'Own profile must have a country badge element');
assert.ok(app.includes('function applyCountryFlag(el, user)'), 'Country flag renderer must exist');
assert.ok(
  /function openOwnProfile\(\)[\s\S]*?applyCountryFlag\(\$\("pp-country-badge"\), me\)/.test(app),
  'Opening the own profile must render the flag from the freshly loaded account country'
);
assert.ok(
  /me = r\.user; saveSession\(\); applyLanguage\(me\.language\); applyCountryFlag\(\$\("pp-country-badge"\), me\)/.test(app),
  'Saving Name/Bio must preserve language and refresh the visible profile flag immediately'
);

console.log('PASS profileCountryFlag.test.js');
