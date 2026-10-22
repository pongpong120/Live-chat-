# Daily Tasks + Room Gift Bonus update — 2026-10-17

- Kept the existing authenticated, server-authoritative 7-day daily diamond reward.
- Added a premium diamond-icon Room Bonus row to Daily Tasks.
- Real room gift handlers now accrue 2% of validated gift spend for the room owner only.
- Pending bonus is tracked server-side; the India-time day rollover settles whole diamonds to the owner's wallet and pushes a wallet update. Fractional basis-point remainder is retained.
- Daily reward state now reports the owner's pending room bonus for the UI.
- This change is a source update only: production deployment, Firebase credentials, multi-instance locking and live wallet verification still need to be performed in the target environment.
