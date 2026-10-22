# Party Room Upgrade — 2026-10-06

## Room UI
- Owner/Honor seat is rendered above the 12-seat grid and uses the current room host.
- Header uses transparent glass styling with room ID, online count, More and Exit controls.
- Empty seats use the supplied transparent microphone artwork.
- Seat sizing is centralized at 60–64px depending on viewport; 4-column layout remains intact.
- Bottom controls use a blurred glass toolbar and safe-area padding.
- Private message thread has independent scrolling and does not move the room frame.
- Room entry remains compatible with the existing entrance/gift/voice effects.

## Party mode cleanup
- Agency ranking static page and Club redirect are no longer exposed.
- Merchant/Seller/Agency profile entry points are removed from the public profile UI.
- Party mode blocks retired Agency/Merchant/Seller/withdrawal HTTP APIs with HTTP 410 while preserving historical data for safe migration/audit.
- Owner/Admin panels remain; Host Salary, Party Rooms, Gifts, Games, Rankings, Themes and moderation remain active.

## Safety
Historical legacy data/modules are not destructively deleted in this patch because production data dependencies must be migrated before physical removal. The retired surfaces are inactive and blocked in Party mode.
