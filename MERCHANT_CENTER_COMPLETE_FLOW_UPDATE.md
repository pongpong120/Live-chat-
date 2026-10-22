# Merchant Center Complete Flow Update

## Funding hierarchy
- Control Panel can top up **Merchant balance only**.
- Merchant funding is entered as INR and converted server-side at **₹1 = 10,000 Coins (₹100 = 1,000,000 Coins)**.
- Merchant can create up to 10 Sellers and fund Seller balances from Merchant Center.
- Control Panel direct Seller top-up is blocked to preserve the hierarchy.

## Seller recharge
- Seller enters a User ID and **INR amount only**.
- Server calculates Diamonds from the fixed rate and deducts the Seller inventory before crediting the target user's Diamond wallet.
- The recharge transaction records INR, rate, Diamonds, Seller, target User, and resulting Seller balance.

## History and reporting
- Merchant/Seller user-facing history contains **user delivery/recharge transactions only**.
- Merchant funding and Merchant-to-Seller funding are not exposed in that user history feed.
- Control Panel provides a full Merchant PDF and a daily Seller PDF with recharge counts, INR totals, and Diamonds delivered.

## Validation
- Full project test suite: **62/62 suites passed**.
- Merchant/Seller INR flow regression test: **PASS**.
