const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'style.css'), 'utf8');
const reaction = fs.readFileSync(path.join(root, 'public', 'emojiReaction.js'), 'utf8');
const emoji = path.join(root, 'public', 'images', 'icons', 'icon-emoji-reaction.png');

function ok(condition, message) {
  if (!condition) throw new Error(message);
  console.log('PASS:', message);
}

ok(html.includes('id="btn-open-emoji"') && html.includes('/images/icons/icon-emoji-reaction.png'), 'reaction button uses supplied artwork');
ok(!/<button id="btn-open-emoji"[^>]*>\s*😊\s*<\/button>/.test(html), 'reaction button no longer renders the text emoji');
ok(reaction.includes('const openBtn = $("btn-open-emoji")') && reaction.includes('openBtn.addEventListener("click", openSheet)'), 'existing reaction button listener remains wired');
ok(css.includes('#view-room .chest-box::before') && css.includes('display:none !important'), 'treasure chest circular pseudo-background is disabled');
ok(css.includes('#view-room .chest-box .chest-img'), 'actual treasure chest artwork remains styled');
ok(fs.existsSync(emoji), 'new reaction icon file exists');
const sig = fs.readFileSync(emoji).subarray(0, 8).toString('hex');
ok(sig === '89504e470d0a1a0a', 'reaction icon is a valid PNG');
console.log('All UI emoji/chest regression assertions passed.');
