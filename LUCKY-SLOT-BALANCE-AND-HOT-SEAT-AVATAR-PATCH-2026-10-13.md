# Lucky Slot / Lucky Seven balance and Teen Patti Hot Seat avatar patch
Date: 2026-10-13

Changes in this patch:
- Classic Slot server hot-seat entries now include the user's stored avatar/profile image fields.
- Teen Patti hot-seat avatar lookup recognizes additional common profile image field names.
- Teen Patti avatar rendering accepts safe relative image paths as well as HTTP(S) and data-image URLs.
- Classic Slot wallet debit/credit paths now validate returned balances; if the wallet credit response omits a usable balance field, the server re-reads the authoritative wallet balance rather than assigning NaN/zero to the displayed balance.
- Existing server-side payout multipliers and 5-line wager calculation are preserved; the displayed WIN is gross payout, while net change is payout minus wager. For example, a 25,000 wager and 50,000 gross payout should produce a +25,000 balance change, assuming no separate wallet/provider error.

Validation:
- All 66 test files passed when run from the project root.
- This is local test validation; it does not replace a live Railway wallet-ledger test.
