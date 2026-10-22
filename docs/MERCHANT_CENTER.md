# Merchant Center — Merchant → Seller hierarchy

This update adds a dedicated Merchant Center on top of the existing merchant directory.

## Flow

1. Control Panel creates a Merchant against an existing PingPong User ID.
2. The user's `activeBadges` receives `merchant_tag` automatically.
3. The user's profile menu receives a premium **Merchant Center** entry using the supplied diamond artwork.
4. A Merchant can have **maximum 10 active Sellers**.
5. Sellers are created from the Merchant's Control Panel card and receive the existing `seller_tag` automatically.
6. Control Panel funds the Merchant Diamond balance directly.
7. Control Panel can transfer Diamond inventory from Merchant → Seller.
8. Merchant or Seller can sell Diamonds to a normal PingPong User ID; the target user's normal Diamond wallet is credited and the Merchant/Seller inventory is deducted atomically.
9. Merchant statistics track funded Diamonds, Diamonds transferred to Sellers, Diamonds sold to users, and sale counts.
10. The Control Panel can export a full Merchant PDF report containing Merchant totals, Seller balances/totals, and the transaction ledger.

## New endpoints

### User

- `GET /api/merchant-center/status`
- `GET /api/merchant-center/me`
- `POST /api/merchant-center/sell`

### Control Panel

- `GET /api/admin/merchants/:merchantId/dashboard`
- `POST /api/admin/merchants/:merchantId/balance`
- `POST /api/admin/merchants/:merchantId/sellers`
- `POST /api/admin/merchants/:merchantId/sellers/:sellerId/topup`
- `POST /api/admin/merchants/:merchantId/sellers/:sellerId/remove`
- `GET /api/admin/merchants/:merchantId/report/pdf`

All Control Panel endpoints are RBAC/country scoped through the existing `merchant:view` / `merchant:manage` permissions.

## Data files

- `data/merchant_sellers.json`
- `data/merchant_transactions.json`

The existing `data/merchants.json` remains the Merchant Directory source of truth.

## Assets

- `public/images/icons/merchant-center.png` — cropped/transparent version of the supplied Diamond artwork.
- `public/images/badges/merchant_tag.png` — compact Merchant profile tag derived from the supplied Merchant artwork.

## Merchant owner controls

An active Merchant owner can manage the Merchant Center from the user app:

- Create up to 10 active Sellers against existing User IDs.
- Transfer Diamonds from the Merchant inventory to a Seller inventory. This is an inventory transfer only; it never mints Diamonds.
- Sell Diamonds to normal User IDs from Merchant/Seller inventory.
- Unban up to 10 User IDs per calendar month. The monthly counter is persisted in `data/merchant_actions.json` and resets automatically when the UTC month changes.

Control Panel remains the source for Merchant funding. If Merchant balance is insufficient, Seller top-up is rejected until the Control Panel funds the Merchant again.

## Merchant owner endpoints

- `POST /api/merchant-center/sellers`
- `POST /api/merchant-center/sellers/:sellerId/topup`
- `GET /api/merchant-center/unban-status`
- `POST /api/merchant-center/unban`


## Seller top-up rule

Seller Diamond inventory is topped up only by the Seller's parent Merchant from Merchant Center. Control Panel direct Merchant→Seller top-up is intentionally blocked; Control Panel funds the Merchant inventory first. The Merchant Center UI exposes an INR top-up field beside each active Seller and the server converts INR at the authoritative ₹1 = 10,000 Coins (₹100 = 1,000,000 Coins) rate, debiting Merchant inventory and crediting Seller inventory without minting extra Diamonds.
