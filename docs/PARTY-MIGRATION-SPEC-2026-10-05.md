# Party Migration — 2026-10-05

- Agency/Agency Center/Agency salary UI retired from the active product flow.
- Global/Country manager roles retired from active RBAC UI; existing legacy accounts are normalized to Admin.
- Host Salary is agency-independent. Confirmed host target is the gift value credited during the salary period.
- Salary formula: `Salary Beans = Achieved Target × 3`. Example: 100,000 target => 300,000 Beans.
- Salary can be processed in one `PROCESS ALL HOST SALARY` batch and is idempotent per host/period.
- Recharge policy: ₹1 = 10,000 Coins; ₹100 = 1,000,000 Coins.
- Merchant/Seller recharge calculations use the same rate.
- Existing wallet storage continues to use the historical `diamonds` field internally for compatibility; Party-facing recharge copy uses Coins.
- Profile/Me and message thread scrolling were hardened so fixed navigation/toolbars do not scroll off-screen.
- Room header and icon sizing received a final premium glass pass without changing existing IDs/events.
