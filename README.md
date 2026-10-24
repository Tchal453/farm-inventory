# Farm Inventory (v1.1)
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
