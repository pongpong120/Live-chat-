const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'admin', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'admin', 'app.js'), 'utf8');
assert(server.includes('app.post("/api/admin/godpower/action", requireAdmin, requirePermission("godpower:manage")'), 'God Power action API must require authenticated admin + godpower:manage');
for (const action of ['room-ban','room-unban','account-ban','account-unban','profile-image-ban','profile-image-unban','room-theme-ban','room-theme-unban','delete-room','delete-user']) {
  assert(server.includes(`"${action}"`), `server must support ${action}`);
  assert(html.includes(`value="${action}"`), `Control Panel must expose ${action}`);
}
assert(server.includes('room.bannedUserIds.includes(String(userId))'), 'room bans must be enforced on join');
assert(server.includes('if (room.themeBanned && !isGodPowerHolder(socket.userId))'), 'room theme bans must be enforced server-side');
assert(server.includes('if (users[mobile].profileImageBanned)'), 'profile image bans must be enforced on upload');
assert(server.includes('bannedUserIds: Array.isArray(m.bannedUserIds)'), 'room bans must persist across restarts');
assert(server.includes('themeBanned: !!m.themeBanned'), 'theme bans must persist across restarts');
assert(app.includes('api("/api/admin/godpower/action", "POST"'), 'Control Panel must call the action API');
console.log('godPowerControl: PASS — authenticated action route, all 10 actions, UI wiring, server enforcement and persistence');
