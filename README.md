# GasShop

Offline-first gas shop manager as a static PWA (no build step).
HTML5 · ES modules · jQuery · Bootstrap 5 · Bootstrap Icons · IndexedDB · Service Worker · eposwala login API.

## What it does

- **Counter sale**: three kinds of line, added from big tiles:
  - **Refill** a customer's own cylinder. Billed per kg (cylinder kg × price per kg) and taken from the bulk gas tank.
  - **Swap** a cylinder: full cylinder out from the shop, empty taken back in. Each line has its own full-out / empty-in counts and price.
  - **Accessories** (regulators, hoses, burners…) found by name or barcode.
  - Discount, part payment, cash or bank, customer balance (credit), walk-in customers, receipt printing, draft kept after refresh.
- **Sales & bills**: list by date, bill detail, receipt reprint, voiding (managers). A void puts the cylinders, gas and accessories back in stock.
- **Stock**
  - *Cylinders*: full and empty counts per type, with a "Count" correction.
  - *Gas tank*: kilograms in the bulk tank, with a "Tank reading" correction.
  - *Accessories*: stock, minimum-level alerts, prices, adjustments.
  - *Movements*: every stock change, with the bill or purchase it came from.
- **Purchases** from suppliers, four kinds of line:
  - filled cylinders bought,
  - empties sent to the plant for refill (empty → full),
  - bulk gas by the kilogram,
  - accessories.
  Purchases can be voided too (managers).
- **Customers & suppliers**: balances, statements (running balance), payments received or made, printable statements.
- **Expenses & cash**: cash in / cash out / net for any date range, expenses by category.
- **Reports**: daily sales, cylinders (refilled, swapped, bought, sent to plant), accessory sales, profit estimate, dues, stock value. Each one prints and exports CSV.
- **Dashboard**: animated tank gauge, cylinder stock tiles, today's sales, gas kg refilled, cylinders swapped, money to collect and pay, low-stock list.
- **Backup & restore**: one JSON file with everything. Restore can merge or replace (both need confirmation).
- **Settings**: shop profile, currency, price per kg, tank capacity, cylinder types (name, kg, swap price), expense categories, bill prefixes, auto-print, light/dark theme.

## Roles

| Role | Can do |
|---|---|
| Owner (admin) | Everything |
| Manager | Counter, purchases, stock counts, accessories, suppliers, expenses, voids, finance reports, settings, backup |
| Counter staff | Counter sales, customer details, customer payments, basic reports |

Roles are set in `js/services/auth.js` (`CASHIER`, `MANAGER`).

## Architecture

```
index.html              App shell (splash, login hero, sidebar, bottom bar)
manifest.json           PWA manifest
service-worker.js       Precache of shell + CDN libs; cache-first; /api/ requests never cached
css/app.css             Theme tokens (flame & steel), components, animations, print styles
js/app.js               Boot, auth gate + session expiry, router (lazy-loaded modules), connection badge
js/config.js            Login API base URL, support phone, app/schema/backup versions
js/core/settings.js     Shop profile, gas pricing, cylinder types (LocalStorage)
js/core/visuals.js      Animated SVG cylinder, tank and ring graphics
js/core/print.js        Receipt and shop header markup, print helper
js/core/ui.js           Toasts, modals, forms, pickers, count-up numbers
js/core/views.js        Date filter, paged lists
js/db/schema.js         IndexedDB stores and migrations
js/db/idb.js            Promise wrapper with atomic multi-store transactions
js/services/gas.js      Business rules: stock deltas, sales, purchases, payments, balances, ledgers
js/services/auth.js     Login against the eposwala API, session, permissions
js/modules/*.js         One module per screen
```

### How stock stays correct

Every change to stock goes through one function in `js/services/gas.js` (`applyDelta`). It runs in the same IndexedDB transaction as the bill or purchase, writes a movement row, and aborts the whole save if any count would go negative. Voids apply the reverse of the original change.

## Data

- IndexedDB database `disterp_gas` (separate from the earlier POS and lab builds, which are not read or changed).
- Bills and purchases store their own line amounts. Prices are recalculated when saved, never trusted from the form.
- Customer and supplier balances are computed from bills, purchases and payments. There is no stored balance that could drift.

## Run locally

```bash
python -m http.server 8765 --bind 127.0.0.1
```

Then open http://127.0.0.1:8765. Signing in needs internet access to the login API. After that the app works offline.

## Deploy

Static hosting (GitHub Pages, as configured by `CNAME` and `.nojekyll`). Bump `VERSION` in `service-worker.js` whenever a cached file changes, so phones refresh their cache.
