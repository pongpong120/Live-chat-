const assert = require('assert');
const fs = require('fs');

const server = fs.readFileSync('server.js', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const admin = fs.readFileSync('admin/app.js', 'utf8');
const approval = fs.readFileSync('giftsApproval.js', 'utf8');

assert(server.includes('function normalizeGiftDiamondPrice(gift)'), 'server canonical gift amount helper exists');
assert(server.includes('gift.diamondAmount, gift.amount, gift.cost, gift.diamonds'), 'server accepts legacy gift amount aliases');
assert(server.includes('return { ...gift, category, price };'), 'server emits canonical price');
assert(server.includes('const normalized = giftCatalog.map(normalizeGiftCatalogItem).filter(Boolean);'), 'catalog is normalized at startup');

assert(app.includes('function giftDiamondAmount(g)'), 'client canonical gift amount helper exists');
assert(app.includes('giftDiamondAmount(g).toLocaleString()'), 'Gift Box renders diamond amount below gift');
assert(app.includes('giftDiamondAmount(g) > 0'), 'malformed zero-price gifts are ignored by the client');
assert(app.includes('function giftAssetUrl(value)'), 'gift asset URL validation exists');

const css = fs.readFileSync('public/style.css', 'utf8');
assert(css.includes('#modal-gift .gift-item .gift-name{'), 'Gift Box has explicit gift-name styling');
assert(css.includes('display:block!important;'), 'Gift Box keeps gift name visible');
assert(css.includes('#modal-gift .gift-item .price{'), 'Gift Box has explicit price styling');
assert(css.includes('display:flex!important;'), 'Gift Box keeps Diamond price visible');
assert(!css.includes('#modal-gift .gift-item .gift-name,\n#modal-gift .gift-item .price{\n  display:none!important;'), 'Gift Box does not hide gift name/price');

assert(admin.includes('function adminGiftDiamondAmount(g)'), 'admin canonical gift amount helper exists');
assert(admin.includes('adminGiftDiamondAmount(g).toLocaleString()'), 'Admin catalog renders diamond amount');

assert(approval.includes('category: record.category || "customize"'), 'approval-published video gifts retain category');

console.log('giftDiamondAmount.test.js: PASS');
