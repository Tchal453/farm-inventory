# Farm Inventory (v1.2)
Open `index.html` in any modern browser (phone or desktop), or use the hosted copy at https://tchal453.github.io/farm-inventory/. No install, no account.
Data is saved in the browser's localStorage on that device — use **Data → Backup (JSON)** regularly and **Import backup** to move data between devices.

## Barcode scanning (new in v1.1)
- Tap **📷 Scan** (big green button at the bottom on phones, top bar on desktop) to read a barcode with the rear camera: UPC-A/E, EAN-13/8, Code 128, Code 39, ITF, QR and Data Matrix.
- **Known barcode** → the item opens with quick −/+ plus **Log usage** / **Log delivery**, History and Edit.
- **New barcode** → **Add new item** (barcode prefilled) or **Link to existing item**.
- Each item has an optional **Barcode** field (with its own small Scan button in the add/edit form). It shows on the item card, is searchable, and is included in CSV and JSON export/import. A UPC-A code and its 13-digit EAN form (leading 0) count as the same barcode. Two items can't share a barcode.
- If the camera is blocked or missing, the scanner says so and you can type the number instead.
- How it reads codes: the browser's built-in `BarcodeDetector` when available (Chrome/Edge on Android, Chrome on macOS). Elsewhere (iPhone/iPad Safari, Firefox, Chrome on Windows/Linux) it loads [html5-qrcode 2.3.8](https://github.com/mebjas/html5-qrcode) from jsDelivr (pinned, with an SRI hash) the first time you scan, so the first fallback scan needs internet.
- The camera only works over **https** (GitHub Pages is fine) or `localhost`; opening the file directly from disk may not allow it. Typing a code always works.

Older backups and saved data without barcodes load fine.

Files: index.html, styles.css, app.js. Test: `tests/e2e.playwright.js` (run from a folder with playwright installed; it covers barcode entry, lookup by manual entry, link/add flows, exports, and both camera code paths using Chromium's fake camera).

## Commodity prices & inventory value (new in v1.2)
- In **Add/Edit item → Market price link**, pick a commodity. The **Inventory value** card on the dashboard shows the total in CAD, split into *Market (futures + basis)*, *Your prices* and *At cost*, plus a **↻ Refresh prices** button, when prices were last checked, and the USD/CAD rate.
- **Value per item = quantity × price**, where price is, in order: **Your price** (if you typed one) → **futures price converted to CAD per your unit + your basis** → **Cost per unit** → nothing (not counted).
- **Live (futures reference):** KC HRW wheat (KE=F, closest proxy for CWRS), Chicago SRW wheat (ZW=F), oats (ZO=F), corn (ZC=F), soybeans (ZS=F), live cattle (LE=F), feeder cattle (GF=F), lean hogs (HE=F), diesel via NY Harbor ULSD (HO=F). Source: Yahoo Finance delayed front-month futures quotes, saved to `prices.json` by the GitHub Action `.github/workflows/update-prices.yml` (hourly on market days; Yahoo can't be called from a browser). USD→CAD uses the Bank of Canada daily rate, fetched live by the app (falls back to the rate in prices.json).
- **Manual price only** (no free live feed a browser can use): canola, CWRS, durum, barley, peas, lentils, flax, rye, mustard, canaryseed, hay, fertilizer, Canadian cash cattle, other.
- **Conversions:** grain futures are US cents per contract bushel → CAD/tonne → your unit (bushels use Canadian bushel weights: wheat/durum/soy/peas/lentils 60 lb, corn/flax/rye 56, canola/mustard/canaryseed 50, barley 48, oats 34; the CBOT oats contract bushel is 32 lb). Cattle/hogs: US cents/lb → CAD per lb, kg, cwt, tonne, or per head using *Avg weight per head* (hogs: carcass weight). Diesel: US$/US gallon → CAD per litre or per imperial gallon. Units that can't convert (bags, each…) fall back to your price or cost, and the card says why.
- These are **futures reference prices, not your local elevator / auction cash price**. Use **Basis** (+/− CAD per unit) to match your local bid, or just type **Your price**.
- Prices are cached on the device, so the value still shows offline (with the time they were saved). CSV export has commodity, basis, your price, futures price, price used, source and value columns; JSON backups keep the fields. Older backups still import.

Tests: `tests/prices.playwright.js` (mocked feeds, checks the maths, fallbacks, offline cache, exports) and `tests/e2e.playwright.js`; both use `tests/serve.js`. Run with `NODE_PATH=<dir with playwright>/node_modules node tests/<file>`.
