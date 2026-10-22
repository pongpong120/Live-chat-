# PingPong Reference UI Specification — 2026-10-04

Source: supplied 720x1600 reference video (`186544.mp4`, ~49.95s).

This pass is visual-only. Existing IDs, event handlers, APIs, room lifecycle,
wallet/gift/game logic and navigation are intentionally preserved.

## Reference measurements

| Area | Reference target | Implementation target |
|---|---:|---:|
| Home top chrome | ~58 CSS px | 58px |
| Home side padding | ~10–12px | 10–12px |
| Home top/search icon | ~22px artwork | 22px |
| Primary tabs | ~15px | 15px |
| Banner radius | ~10px | 10px |
| Room list gap | ~7px | 7px |
| Room card radius | ~11px | 11px |
| Room seat grid | 4 columns | 4 columns |
| Room seat diameter | ~52px | 52px |
| Seat name | ~8px | 8px |
| Room toolbar icon button | ~31px | 31px |
| Room toolbar artwork | ~20px | 20px |
| Room toolbar height | ~52px | 52px |
| Profile avatar | ~64px | 64px |
| Profile menu row | ~52px | 52px |
| Profile menu icon | ~30px transparent artwork | 30px |
| Bottom nav artwork | ~21px | 21px |
| Bottom nav label | ~8px | 8px |

## Visual rules

1. Room UI remains dark/glass so the room background/theme remains visible through controls.
2. Home/Profile use the cream/light reference surface.
3. Supplied transparent PNG/SVG artwork is not placed inside synthetic colored icon tiles.
4. Existing feature behavior is not replaced by visual CSS.
5. Room seats remain a fixed-size 4-column grid so gifts/chat animations cannot resize them.
6. Existing Lucky Fruit/Game, Gift, Wallet, SVIP, Profile Edit and Room More systems retain their IDs and JavaScript handlers.
7. Reduced-motion users retain the existing accessibility behavior.
