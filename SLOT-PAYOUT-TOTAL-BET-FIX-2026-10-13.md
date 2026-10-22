# Classic Slot payout fix — 2026-10-13

## Bug (confirmed from screen recording)
Prizes were calculated as `symbol multiplier × bet PER LINE`, but the screen shows TOTAL BET (= per-line bet × 5).
With TOTAL BET 50,000 (10,000 per line) three WATERMELON on a payline paid 10 × 10,000 = 100,000 (2× total bet) instead of 10 × 50,000 = 500,000.
Recording samples: 3 mango = 30,000 (was 0.6× total), 3 cherry = 10,000 (0.2× total).

## Fix
- `games/classicSlotServer.js`: `payout(grid, totalBet)` now pays `multiplier × TOTAL BET` per winning line; the spin handler passes `bet` (total). Two-cherry multiplier moved to a named constant `TWO_CHERRY`.
- `public/games/classic-slot/index.html`: `evaluate()` (win-line highlight/animation), the Paytable modal and the How-to-play text use TOTAL BET, matching the server and the win-level tiers (win ÷ total bet).
- `test/classicSlotPayoutParity.test.js`: updated + new asserts (payout uses total bet, TWO_CHERRY parity).

## Economy note (IMPORTANT)
Paying on total bet with the old 2-cherry = 0.6× would give RTP ≈ 101% (house loses). `TWO_CHERRY` was lowered 0.6 → 0.4, giving theoretical RTP ≈ 94.85% (8,000-spin run of the real spin handler: 94.06%).
To tune RTP change `TWO_CHERRY` in BOTH server (`games/classicSlotServer.js`) and client (`public/games/classic-slot/index.html`): 0.5 → 98.0%, 0.3 → 91.7%, 0.2 → 88.6%.

## Not changed (needs owner decision) — Lucky Fruit RTP > 100%
`games/luckyFruitServer.js`: Lucky/Super tiles pay every fruit of their group at the fruit's multiplier, so per-fruit RTP is: orange/banana/grape/cherry 107.4%, apple 104.6%, melon 110.2%, mango 121.4%, straw 143.8%. A player betting straw only has positive expectation.
Other games reviewed: Rocket Crash (4% edge, OK), Teen Patti (1/3 chance × 2.9 = 96.7%, OK), Fruit Wheel (RTP ≤ 100%, OK).
