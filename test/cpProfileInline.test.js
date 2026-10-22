const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'friendshipCp.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
  console.log('  ✓ ' + msg);
}

console.log('CP profile inline presentation — verification');
assert(html.includes('id="sheet-cp-profile-composite"'), 'seat profile sheet has inline CP composite');
assert(!html.includes('id="profile-cp-profile-composite"'), 'own Me/Profile page has no CP pair overlay');
assert(html.includes('id="other-cp-profile-composite"'), 'other user profile has inline CP composite');
assert(html.includes('/images/relationships/cp-profile-heart.png'), 'supplied CP heart asset is used');
assert(html.includes('cp-profile-primary-avatar'), 'CP composite contains a full-size primary profile photo');
assert(css.includes('cp-profile-primary-avatar'), 'CP pair layout keeps both profile photos visible');
assert(css.includes('sheet-profile-header.has-cp-profile #sheet-vip-badge'), 'CP sheet VIP badge moves to the pair corner');
assert(css.includes('.cp-profile-composite'), 'inline CP composite CSS exists');
assert(css.includes('cp-inline-heart-pulse'), 'inline CP heart glow/pulse animation exists');
assert(js.includes('renderCpProfileCompositeFromRelationship'), 'accepted CP renders partner photo into room/member profile composites');
assert(js.includes('main Me/Profile page is intentionally CP-neutral'), 'main Me/Profile page is explicitly CP-neutral');
assert(js.includes('event.stopPropagation()'), 'Me/Profile CP row is display-only and does not navigate');
assert(!js.includes('renderCpProfileComposite("profile-avatar-frame", me, other)'), 'CP Center cannot inject the partner into the main Me/Profile avatar');
assert(!js.includes('modal-cp-showcase'), 'old full-screen CP showcase is removed from client');
assert(!js.includes('showCpShowcase'), 'old CP showcase renderer is removed from client');
assert(!server.includes('emitCpShowcaseToRooms'), 'old CP showcase server emitter is removed');
console.log('CP profile inline verification: PASS');
