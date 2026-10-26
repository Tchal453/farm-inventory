/* Farm Inventory v1.2 — vanilla JS, data in localStorage. Barcode scanning, commodity prices & inventory value. */
(function () {
  'use strict';

  var STORAGE_KEY = 'farmInventory.v1';
  var CATEGORIES = ['Feed', 'Seed', 'Fertilizer', 'Chemicals/Spray', 'Fuel', 'Parts & Supplies', 'Equipment', 'Livestock', 'Harvested Grain', 'Other'];
  var UNITS = ['bags', 'lbs', 'kg', 'cwt', 'bushels', 'litres', 'gallons', 'tonnes', 'head', 'each'];

  var $ = function (sel) { return document.querySelector(sel); };
  var cad = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
  var numFmt = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 2 });

  // ---------- helpers ----------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function nowIso() { return new Date().toISOString(); }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function daysAgoIso(n) { return new Date(Date.now() - n * 86400000).toISOString(); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v, fallback) {
    if (v === '' || v == null) return fallback;
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }
  function round(n) { return Math.round(n * 1000) / 1000; }
  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function relTime(iso) {
    var diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
    if (diff < 86400) return Math.floor(diff / 3600) + ' h ago';
    if (diff < 86400 * 30) return Math.floor(diff / 86400) + ' d ago';
    return fmtDate(iso);
  }
  function isLow(it) { return it.threshold > 0 && it.quantity <= it.threshold; }
  function itemValue(it) { var v = valuation(it); return v.unitPrice != null ? it.quantity * v.unitPrice : 0; }

  // ---------- example data ----------
  function makeExamples() {
    var ex = [
      { name: 'Cattle mineral (2:1)', category: 'Feed', quantity: 6, unit: 'bags', location: 'Shop', threshold: 8, cost: 32.5, supplier: 'Co-op Agro', notes: '25 kg bags. Cows go through ~2/week on pasture.', days: 3 },
      { name: 'Barley seed — CDC Austenson', category: 'Seed', quantity: 420, unit: 'bushels', location: 'Bin 3', threshold: 100, cost: 9.75, supplier: 'Local seed cleaner', notes: 'Cleaned & treated.', days: 12 },
      { name: 'Urea 46-0-0', category: 'Fertilizer', quantity: 18, unit: 'tonnes', location: 'Fertilizer bin', threshold: 5, cost: 780, supplier: 'Nutrien Ag Solutions', notes: '', days: 20 },
      { name: 'Glyphosate 540', category: 'Chemicals/Spray', quantity: 40, unit: 'litres', location: 'Chem shed', threshold: 60, cost: 8.9, supplier: 'Richardson Pioneer', notes: 'Pre-seed burnoff. Keep locked.', days: 6 },
      { name: 'Diesel (dyed)', category: 'Fuel', quantity: 1850, unit: 'litres', location: 'Fuel tank', threshold: 500, cost: 1.38, supplier: 'Federated Co-op', notes: '3000 L tank.', days: 1 },
      { name: 'Hydraulic oil (UTF)', category: 'Parts & Supplies', quantity: 3, unit: 'each', location: 'Shop', threshold: 2, cost: 89.99, supplier: 'Peavey Mart', notes: '18.9 L pails.', days: 30 },
      { name: 'Bred heifers', category: 'Livestock', quantity: 24, unit: 'head', location: 'East pasture', threshold: 0, cost: 2900, supplier: '', notes: 'Calving starts mid-March.', days: 45 },
      { name: 'CWRS wheat 2026', category: 'Harvested Grain', quantity: 6200, unit: 'bushels', location: 'Quonset', threshold: 0, cost: 8.15, supplier: '', notes: 'Grade #2, 13.4% protein. Waiting on contract. Valued off KC wheat futures — set a basis to match your elevator.', days: 9, commodity: 'wheat_hrw' }
    ];
    return ex.map(function (e) {
      var at = daysAgoIso(e.days);
      return {
        id: uid(), name: e.name, category: e.category, quantity: e.quantity, unit: e.unit, location: e.location,
        threshold: e.threshold, cost: e.cost, supplier: e.supplier, notes: e.notes, barcode: '',
        commodity: e.commodity || '', basis: null, marketPrice: null, headWeight: null,
        createdAt: at, updatedAt: at, example: true,
        history: [{ id: uid(), date: at.slice(0, 10), at: at, type: 'create', change: e.quantity, qtyAfter: e.quantity, note: 'Starting count (example)' }]
      };
    });
  }

  // ---------- commodity prices ----------
  // Live quotes come from ./prices.json (same origin, refreshed by a GitHub Action from Yahoo Finance's
  // delayed futures data — Yahoo has no CORS headers, so the browser can't call it directly) and the
  // USD/CAD rate comes live from the Bank of Canada Valet API (CORS-enabled), falling back to the rate in prices.json.
  // These are FUTURES reference prices in USD converted to CAD — not a local elevator / auction cash price.
  // Use the per-item basis (+/- CAD per unit) to bring them in line with your local bids, or set your own price.
  var PRICE_CACHE_KEY = 'farmInventory.prices';
  var PRICES_URL = 'prices.json';
  var BOC_URL = 'https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1';
  var LB_KG = 0.45359237;          // 1 lb in kg (exact)
  var US_GAL_L = 3.785411784;      // US gallon (futures contract unit), litres
  var IMP_GAL_L = 4.54609;         // Imperial gallon (the app's "gallons" unit), litres
  // buLb = Canadian standard bushel weight used for your stored bushels; futBuLb = bushel weight of the futures contract.
  // Wheat/durum/soybeans/peas/lentils 60 lb, corn/flax/rye 56 lb, canola/mustard/canaryseed 50 lb, barley 48 lb, oats 34 lb (CBOT oats contract: 32 lb).
  var COMMODITIES = [
    { id: 'wheat_hrw', short: 'KC HRW wheat', label: 'Wheat — KC hard red winter futures', kind: 'grain', symbol: 'KE=F', futBuLb: 60, buLb: 60, hint: 'Closest live proxy for CWRS. Set a basis to match your elevator.' },
    { id: 'wheat_srw', short: 'Chicago SRW wheat', label: 'Wheat — Chicago soft red winter futures', kind: 'grain', symbol: 'ZW=F', futBuLb: 60, buLb: 60 },
    { id: 'oats', short: 'Oats', label: 'Oats — CBOT futures', kind: 'grain', symbol: 'ZO=F', futBuLb: 32, buLb: 34 },
    { id: 'corn', short: 'Corn', label: 'Corn — CBOT futures', kind: 'grain', symbol: 'ZC=F', futBuLb: 56, buLb: 56 },
    { id: 'soybeans', short: 'Soybeans', label: 'Soybeans — CBOT futures', kind: 'grain', symbol: 'ZS=F', futBuLb: 60, buLb: 60 },
    { id: 'live_cattle', short: 'Live cattle', label: 'Live cattle — CME futures', kind: 'livestock', symbol: 'LE=F', hint: 'Per lb live weight. For “head”, set the average weight.' },
    { id: 'feeder_cattle', short: 'Feeder cattle', label: 'Feeder cattle — CME futures', kind: 'livestock', symbol: 'GF=F', hint: 'Per lb live weight. For “head”, set the average weight.' },
    { id: 'lean_hogs', short: 'Lean hogs', label: 'Lean hogs — CME futures', kind: 'livestock', symbol: 'HE=F', hint: 'Per lb lean carcass weight. For “head”, set the average carcass weight.' },
    { id: 'diesel', short: 'Diesel (ULSD)', label: 'Diesel — NY Harbor ULSD futures', kind: 'fuel', symbol: 'HO=F', hint: 'Wholesale futures before taxes, freight and margin; farm pump prices run higher. Use the basis.' },
    // No free browser-friendly live source: use "Your price" for these.
    { id: 'canola', label: 'Canola (ICE) — enter your price', kind: 'manual' },
    { id: 'wheat_cwrs', label: 'Wheat — CWRS spring — enter your price', kind: 'manual' },
    { id: 'durum', label: 'Durum — enter your price', kind: 'manual' },
    { id: 'barley', label: 'Barley — enter your price', kind: 'manual' },
    { id: 'peas', label: 'Peas — enter your price', kind: 'manual' },
    { id: 'lentils', label: 'Lentils — enter your price', kind: 'manual' },
    { id: 'flax', label: 'Flax — enter your price', kind: 'manual' },
    { id: 'rye', label: 'Rye — enter your price', kind: 'manual' },
    { id: 'mustard', label: 'Mustard — enter your price', kind: 'manual' },
    { id: 'canaryseed', label: 'Canaryseed — enter your price', kind: 'manual' },
    { id: 'hay', label: 'Hay / forage — enter your price', kind: 'manual' },
    { id: 'fertilizer', label: 'Fertilizer — enter your price', kind: 'manual' },
    { id: 'cattle_cash', label: 'Cattle (Canadian cash/auction) — enter your price', kind: 'manual' },
    { id: 'other', label: 'Other — enter your price', kind: 'manual' }
  ];
  function shortName(c) { return c.short || c.label.replace(/ — .*$/, ''); }
  function commodityById(id) { return COMMODITIES.find(function (c) { return c.id === id; }) || null; }

  var prices = loadPriceCache();
  function loadPriceCache() {
    try { var p = JSON.parse(localStorage.getItem(PRICE_CACHE_KEY) || 'null'); if (p && p.quotes) return p; } catch (e) {}
    return { quotes: {}, fx: null, fileGeneratedAt: null, fetchedAt: null, status: '' };
  }
  function savePriceCache() { try { localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(prices)); } catch (e) {} }

  // Futures quote in USD per contract unit (handles USX = US cents).
  function quoteUsd(q) { return q.currency === 'USX' ? q.price / 100 : q.price; }
  // Base CAD price: grain -> CAD/tonne, livestock -> CAD/lb, fuel -> CAD/litre.
  function baseCad(c) {
    if (!c || !c.symbol) return null;
    var q = prices.quotes[c.symbol], fx = prices.fx && prices.fx.USDCAD;
    if (!q || typeof q.price !== 'number' || !fx) return null;
    var usd = quoteUsd(q);
    if (c.kind === 'grain') return usd / (c.futBuLb * LB_KG / 1000) * fx;
    if (c.kind === 'livestock') return usd * fx;
    if (c.kind === 'fuel') return usd / US_GAL_L * fx;
    return null;
  }
  // How many base units (tonne / lb / litre) are in one of the item's units, or null if it can't convert.
  function unitFactor(c, unit, it) {
    if (c.kind === 'grain') return { tonnes: 1, kg: 0.001, lbs: LB_KG / 1000, cwt: 100 * LB_KG / 1000, bushels: c.buLb * LB_KG / 1000 }[unit] || null;
    if (c.kind === 'livestock') {
      if (unit === 'head') return it && it.headWeight > 0 ? it.headWeight : null;
      return { lbs: 1, kg: 1 / LB_KG, cwt: 100, tonnes: 1000 / LB_KG }[unit] || null;
    }
    if (c.kind === 'fuel') return { litres: 1, gallons: IMP_GAL_L }[unit] || null;
    return null;
  }
  function unitWord(u) { return u === 'each' ? 'each' : u === 'head' ? 'head' : u.replace(/s$/, ''); }
  // Market price per item unit (CAD) from futures, before basis. Returns { price } or { reason }.
  function marketUnitPrice(it) {
    var c = commodityById(it.commodity);
    if (!c) return { reason: 'none' };
    if (c.kind === 'manual') return { reason: 'manual-only' };
    var f = unitFactor(c, it.unit, it);
    if (!f) return { reason: c.kind === 'livestock' && it.unit === 'head' ? 'need-weight' : 'unit' };
    var b = baseCad(c);
    if (b == null) return { reason: 'no-price' };
    return { price: b * f };
  }
  // The price used for valuing an item: your price > futures + basis > cost.
  function valuation(it) {
    if (it.marketPrice != null) return { unitPrice: it.marketPrice, method: 'manual', label: 'your price' };
    var m = marketUnitPrice(it);
    if (m.price != null) {
      var p = m.price + (it.basis || 0);
      return { unitPrice: p, futures: m.price, method: 'market', label: 'futures' + (it.basis ? ' ' + (it.basis > 0 ? '+' : '−') + cad.format(Math.abs(it.basis)) + ' basis' : '') };
    }
    if (it.cost != null) return { unitPrice: it.cost, method: 'cost', label: 'cost', reason: m.reason };
    return { unitPrice: null, method: 'none', label: 'no price', reason: m.reason };
  }
  function reasonText(r, it) {
    var c = commodityById(it.commodity);
    return {
      'manual-only': 'No free live price for ' + (c ? c.label.replace(/ — enter your price$/, '') : 'this') + ' — enter your price.',
      'need-weight': 'Set the average weight per head (lb) to use the futures price.',
      unit: 'Futures price can’t convert to “' + it.unit + '”. Use a weight' + (c && c.kind === 'fuel' ? '/volume (litres, gallons)' : ' unit (bushels, tonnes, lbs, kg)') + ' or enter your price.',
      'no-price': 'Live price not loaded yet — tap Refresh prices.'
    }[r] || '';
  }

  function fetchJSON(url, ms) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, ms || 10000) : null;
    return fetch(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then(function (r) {
      clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
    }, function (e) { clearTimeout(t); throw e; });
  }
  var refreshing = false;
  function refreshPrices(userAsked) {
    if (refreshing) return Promise.resolve();
    refreshing = true; prices.status = 'loading'; renderPrices();
    var file = fetchJSON(PRICES_URL + '?t=' + Date.now());
    var boc = fetchJSON(BOC_URL).then(function (d) {
      var o = d.observations[d.observations.length - 1], v = Number(o.FXUSDCAD.v);
      if (!(v > 0)) throw new Error('bad rate');
      return { USDCAD: v, date: o.d, source: 'Bank of Canada daily average' };
    });
    return Promise.allSettled([file, boc]).then(function (r) {
      var ok = false;
      if (r[0].status === 'fulfilled' && r[0].value && r[0].value.quotes) {
        prices.quotes = r[0].value.quotes; prices.fileGeneratedAt = r[0].value.generatedAt || null; prices.source = r[0].value.source || '';
        if (r[0].value.fx && r[0].value.fx.USDCAD > 0 && !(r[1].status === 'fulfilled')) prices.fx = r[0].value.fx;
        ok = true;
      }
      if (r[1].status === 'fulfilled') prices.fx = r[1].value;
      if (ok) { prices.fetchedAt = nowIso(); prices.status = 'ok'; }
      else prices.status = prices.fetchedAt ? 'offline' : 'error';
      savePriceCache();
      refreshing = false; render();
      if (userAsked) toast(ok ? 'Prices updated' : prices.fetchedAt ? 'Couldn’t reach the price feed — showing saved prices' : 'Couldn’t load prices — check your connection');
    });
  }

  // older saved data / backups have no barcode or price fields
  function normalizePriceFields(i) {
    if (!i) return;
    if (typeof i.barcode !== 'string') i.barcode = '';
    i.commodity = commodityById(i.commodity) ? i.commodity : '';
    i.basis = num(i.basis, null); i.marketPrice = num(i.marketPrice, null); i.headWeight = num(i.headWeight, null);
    if (i.marketPrice != null && i.marketPrice < 0) i.marketPrice = null;
    if (i.headWeight != null && i.headWeight <= 0) i.headWeight = null;
  }

  // ---------- state ----------
  var state = load();
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.items)) {
          parsed.items.forEach(normalizePriceFields);
          return parsed;
        }
      }
    } catch (e) { console.warn('Could not read saved data', e); }
    return { version: 1, items: makeExamples() };
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { toast('Could not save — storage full or blocked.'); }
  }
  function findItem(id) { return state.items.find(function (i) { return i.id === id; }); }

  // ---------- barcode helpers ----------
  function cleanCode(v) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 64); }
  // UPC-A (12 digits) and EAN-13 with a leading 0 are the same product, so compare them as equal.
  function codeKey(v) {
    var c = cleanCode(v);
    if (/^\d{13}$/.test(c) && c.charAt(0) === '0') c = c.slice(1);
    return c.toLowerCase();
  }
  function findByBarcode(code) {
    var k = codeKey(code); if (!k) return null;
    return state.items.find(function (i) { return i.barcode && codeKey(i.barcode) === k; }) || null;
  }

  function recordChange(it, type, change, note, date) {
    it.quantity = round(Math.max(0, it.quantity + change));
    var at = nowIso();
    it.updatedAt = at;
    it.history.unshift({ id: uid(), date: date || todayStr(), at: at, type: type, change: round(change), qtyAfter: it.quantity, note: note || '' });
  }

  // ---------- UI state ----------
  var ui = { search: '', category: '', location: '', sort: 'name', lowOnly: false };

  // ---------- rendering ----------
  function render() {
    renderStats();
    renderPrices();
    renderBreakdown();
    renderFilters();
    renderList();
    $('#exampleBanner').hidden = !state.items.some(function (i) { return i.example; });
  }

  function renderStats() {
    var total = state.items.length;
    var low = state.items.filter(isLow).length;
    var value = state.items.reduce(function (s, i) { return s + itemValue(i); }, 0);
    $('#stats').innerHTML =
      '<div class="stat"><div class="label">Items</div><div class="value">' + total + '</div></div>' +
      '<button type="button" class="stat' + (low ? ' alert' : '') + '" id="lowStat" title="Show low stock only"><div class="label">Low stock</div><div class="value">' + low + '</div></button>' +
      '<button type="button" class="stat" id="valueStat" title="See how this is valued"><div class="label">Inventory value</div><div class="value">' + cad.format(value).replace('.00', '') + '</div></button>';
    $('#lowStat').onclick = function () { ui.lowOnly = !ui.lowOnly; $('#lowOnly').checked = ui.lowOnly; renderList(); };
    $('#valueStat').onclick = function () { $('#valueCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso); if (isNaN(d)) return iso;
    return d.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function renderPrices() {
    var el = $('#valueCard'); if (!el) return;
    var t = { market: 0, manual: 0, cost: 0 }, counts = { market: 0, manual: 0, cost: 0, none: 0 };
    state.items.forEach(function (i) {
      var v = valuation(i); counts[v.method]++;
      if (v.unitPrice != null) t[v.method] += i.quantity * v.unitPrice;
    });
    var total = t.market + t.manual + t.cost;
    var fx = prices.fx;
    var st = prices.status === 'loading' ? 'Updating prices…' :
      prices.status === 'offline' ? 'Offline — using prices saved ' + relTime(prices.fetchedAt) + '.' :
      prices.status === 'error' && !prices.fetchedAt ? 'Couldn’t load live prices. Items use your price or cost until they load.' :
      prices.fetchedAt ? 'Checked ' + relTime(prices.fetchedAt) + '.' : '';
    var rows = COMMODITIES.filter(function (c) { return c.symbol; }).map(function (c) {
      var q = prices.quotes[c.symbol], b = baseCad(c);
      if (!q || b == null) return '<tr><td>' + esc(c.label) + '</td><td colspan="2" class="muted">not loaded</td></tr>';
      var usd = quoteUsd(q), qtxt, ctxt;
      if (c.kind === 'grain') { qtxt = 'US$' + usd.toFixed(2) + '/bu'; ctxt = cad.format(b) + '/t · ' + cad.format(b * c.buLb * LB_KG / 1000) + '/bu'; }
      else if (c.kind === 'livestock') { qtxt = 'US$' + (usd * 100).toFixed(2) + '/cwt'; ctxt = cad.format(b * 100) + '/cwt'; }
      else { qtxt = 'US$' + usd.toFixed(4) + '/US gal'; ctxt = cad.format(b) + '/L'; }
      var chg = typeof q.prevClose === 'number' && q.prevClose ? (q.price - q.prevClose) / q.prevClose * 100 : null;
      return '<tr data-sym="' + esc(c.symbol) + '"><td>' + esc(shortName(c)) + '<div class="muted tiny">' + esc(q.name || c.symbol) + (q.stale ? ' · stale' : '') + '</div></td>' +
        '<td>' + qtxt + (chg != null ? ' <span class="' + (chg >= 0 ? 'up' : 'down') + '">' + (chg >= 0 ? '▲' : '▼') + Math.abs(chg).toFixed(1) + '%</span>' : '') + '<div class="muted tiny">' + esc(fmtTime(q.time)) + '</div></td>' +
        '<td class="cadp">' + ctxt + '</td></tr>';
    }).join('');
    el.innerHTML =
      '<div class="vc-head"><h2>Inventory value</h2><button type="button" class="btn small" id="refreshPrices"' + (prices.status === 'loading' ? ' disabled' : '') + '>↻ Refresh prices</button></div>' +
      '<div class="vc-total" id="vcTotal">' + cad.format(total) + '</div>' +
      '<div class="vc-split">' +
        '<div><span class="dot market"></span>Market (futures + basis)<strong id="vcMarket">' + cad.format(t.market) + '</strong><small>' + counts.market + ' items</small></div>' +
        '<div><span class="dot manual"></span>Your prices<strong id="vcManual">' + cad.format(t.manual) + '</strong><small>' + counts.manual + ' items</small></div>' +
        '<div><span class="dot cost"></span>At cost<strong id="vcCost">' + cad.format(t.cost) + '</strong><small>' + counts.cost + ' items</small></div>' +
      '</div>' +
      (counts.none ? '<p class="muted small">' + counts.none + ' item' + (counts.none > 1 ? 's have' : ' has') + ' no price or cost and ' + (counts.none > 1 ? 'aren’t' : 'isn’t') + ' counted.</p>' : '') +
      '<p class="muted small" id="priceStatus">' + esc(st) + (prices.fileGeneratedAt ? ' Futures as of ' + esc(fmtTime(prices.fileGeneratedAt)) + '.' : '') +
        (fx ? ' US$1 = C$' + fx.USDCAD.toFixed(4) + ' (' + esc(fx.source || 'Bank of Canada') + ', ' + esc(fx.date || '') + ').' : '') + '</p>' +
      '<details class="quotes"><summary>Live futures prices (CAD)</summary><table><thead><tr><th>Commodity</th><th>Futures quote</th><th>In CAD</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="muted tiny">Futures reference prices from Yahoo Finance (CBOT/CME, delayed and front-month), converted to CAD at the Bank of Canada rate. They are <strong>not your local cash price</strong> — add a basis on each item to match your elevator or auction, or set your own price. Canola, CWRS, durum, barley, peas, lentils, flax and other crops have no free live feed here, so enter your price for those.</p></details>';
    $('#refreshPrices').onclick = function () { refreshPrices(true); };
  }

  function renderBreakdown() {
    var by = {};
    state.items.forEach(function (i) {
      var b = by[i.category] || (by[i.category] = { count: 0, value: 0, low: 0 });
      b.count++; b.value += itemValue(i); if (isLow(i)) b.low++;
    });
    var cats = Object.keys(by).sort(function (a, b) { return by[b].value - by[a].value || by[b].count - by[a].count; });
    var maxVal = Math.max.apply(null, cats.map(function (c) { return by[c].value; }).concat([1]));
    if (!cats.length) { $('#breakdown').innerHTML = '<p class="muted">Nothing yet — add your first item.</p>'; return; }
    $('#breakdown').innerHTML = cats.map(function (c) {
      var b = by[c];
      var pct = Math.max(2, (b.value / maxVal) * 100);
      return '<div class="cat-row" data-cat="' + esc(c) + '" title="Filter to ' + esc(c) + '"><span>' + esc(c) + (b.low ? ' <span class="tag lowtag">' + b.low + ' low</span>' : '') + '</span>' +
        '<div class="bar"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
        '<span class="cat-meta">' + b.count + ' · ' + cad.format(b.value).replace('.00', '') + '</span></div>';
    }).join('');
  }

  function renderFilters() {
    var catSel = $('#filterCategory');
    catSel.innerHTML = '<option value="">All categories</option>' + CATEGORIES.map(function (c) {
      return '<option' + (ui.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var locs = Array.from(new Set(state.items.map(function (i) { return (i.location || '').trim(); }).filter(Boolean))).sort();
    if (ui.location && locs.indexOf(ui.location) < 0) ui.location = '';
    $('#filterLocation').innerHTML = '<option value="">All locations</option>' + locs.map(function (l) {
      return '<option' + (ui.location === l ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('');
    $('#locationList').innerHTML = locs.concat(['Shop', 'Quonset', 'Bin 1', 'Bin 2', 'Bin 3', 'Chem shed', 'Fuel tank', 'Barn', 'Yard'])
      .filter(function (v, i, a) { return a.indexOf(v) === i; })
      .map(function (l) { return '<option value="' + esc(l) + '">'; }).join('');
  }

  function visibleItems() {
    var q = ui.search.trim().toLowerCase();
    var items = state.items.filter(function (i) {
      if (ui.category && i.category !== ui.category) return false;
      if (ui.location && (i.location || '').trim() !== ui.location) return false;
      if (ui.lowOnly && !isLow(i)) return false;
      if (q) {
        var hay = [i.name, i.category, i.location, i.supplier, i.notes, i.barcode].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    items.sort(function (a, b) {
      if (ui.sort === 'qty') return a.quantity - b.quantity || a.name.localeCompare(b.name);
      if (ui.sort === 'updated') return new Date(b.updatedAt) - new Date(a.updatedAt);
      return a.name.localeCompare(b.name, 'en-CA', { sensitivity: 'base' });
    });
    return items;
  }

  function priceMeta(i) {
    var v = valuation(i), c = commodityById(i.commodity), u = esc(unitWord(i.unit));
    var html = '';
    if (v.unitPrice != null) {
      html = '<span class="pricebox ' + v.method + '">' + (v.method === 'market' ? '📈 ' : '') + cad.format(v.unitPrice) + '/' + u +
        ' <em>(' + esc(v.label) + ')</em> · <strong class="item-value">' + cad.format(itemValue(i)) + '</strong></span>';
    } else html = '<span>No price or cost set</span>';
    if (c) html += '<span class="tag commodity" title="' + esc(c.label) + '">' + esc(shortName(c)) + (v.method === 'market' ? ' · futures ref' : '') + '</span>';
    if (c && v.method !== 'market' && v.method !== 'manual' && v.reason) html += '<span class="muted price-note">' + esc(reasonText(v.reason, i)) + '</span>';
    if (v.method !== 'cost' && i.cost != null) html += '<span class="muted">Cost ' + cad.format(i.cost) + '/' + u + '</span>';
    return html;
  }

  function renderList() {
    var items = visibleItems();
    if (!items.length) {
      $('#list').innerHTML = '<div class="empty">' + (state.items.length ? 'No items match your search or filters.' : 'No items yet. Tap <strong>+ Add item</strong> to get started.') + '</div>';
      return;
    }
    $('#list').innerHTML = items.map(function (i) {
      var low = isLow(i);
      return '<article class="item' + (low ? ' low' : '') + '" data-id="' + i.id + '">' +
        '<div class="item-head"><div><h3 class="item-name">' + esc(i.name) + '</h3><div class="tags">' +
          '<span class="tag">' + esc(i.category) + '</span>' +
          (i.location ? '<span class="tag loc">📍 ' + esc(i.location) + '</span>' : '') +
          (i.example ? '<span class="tag ex">Example</span>' : '') +
          (low ? '<span class="tag lowtag">LOW STOCK</span>' : '') +
        '</div></div></div>' +
        '<div class="qty-row"><div class="qty">' + numFmt.format(i.quantity) + '<small>' + esc(i.unit) + '</small></div>' +
          '<div class="steppers"><button class="step" data-act="dec" aria-label="Decrease ' + esc(i.name) + ' by 1">−</button><button class="step" data-act="inc" aria-label="Increase ' + esc(i.name) + ' by 1">+</button></div></div>' +
        '<div class="meta">' +
          '<span>Alert at: ' + (i.threshold > 0 ? numFmt.format(i.threshold) + ' ' + esc(i.unit) : 'off') + '</span>' +
          priceMeta(i) +
          '<span>' + (i.supplier ? 'Supplier: ' + esc(i.supplier) : '') + '</span>' +
          (i.barcode ? '<span class="barcode" data-barcode="' + esc(i.barcode) + '">▥ ' + esc(i.barcode) + '</span>' : '') +
          '<span title="' + esc(new Date(i.updatedAt).toLocaleString('en-CA')) + '">Updated ' + relTime(i.updatedAt) + '</span>' +
          (i.notes ? '<span class="notes">' + esc(i.notes) + '</span>' : '') +
        '</div>' +
        '<div class="item-actions">' +
          '<button class="btn" data-act="log">Log use / delivery</button>' +
          '<button class="btn" data-act="history">History</button>' +
          '<button class="btn" data-act="edit">Edit</button>' +
          '<button class="btn del" data-act="delete" aria-label="Delete ' + esc(i.name) + '">🗑</button>' +
        '</div></article>';
    }).join('');
  }

  // ---------- dialogs ----------
  function openDialog(d) { if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); }
  function closeDialog(d) { if (typeof d.close === 'function') d.close(); else d.removeAttribute('open'); }
  document.querySelectorAll('dialog').forEach(function (d) {
    d.addEventListener('click', function (e) {
      if (e.target.matches('[data-close]')) closeDialog(d);
      if (e.target === d) closeDialog(d); // backdrop click
    });
  });

  var editingId = null;
  function openItemForm(id, prefill) {
    editingId = id || null;
    var f = $('#itemForm');
    f.reset();
    $('#formError').hidden = true;
    $('#fCategory').innerHTML = CATEGORIES.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
    $('#fUnit').innerHTML = UNITS.map(function (u) { return '<option>' + u + '</option>'; }).join('');
    var live = COMMODITIES.filter(function (c) { return c.symbol; }), man = COMMODITIES.filter(function (c) { return !c.symbol; });
    var opt = function (c) { return '<option value="' + c.id + '">' + esc(c.label) + '</option>'; };
    $('#fCommodity').innerHTML = '<option value="">Not linked</option><optgroup label="Live futures price">' + live.map(opt).join('') +
      '</optgroup><optgroup label="No live feed — enter your price">' + man.map(opt).join('') + '</optgroup>';
    var it = id ? findItem(id) : null;
    $('#itemDialogTitle').textContent = it ? 'Edit item' : 'Add item';
    if (it) {
      f.name.value = it.name; f.category.value = it.category; f.location.value = it.location || '';
      f.quantity.value = it.quantity; f.unit.value = it.unit; f.threshold.value = it.threshold || 0;
      f.cost.value = it.cost != null ? it.cost : ''; f.supplier.value = it.supplier || ''; f.notes.value = it.notes || '';
      f.barcode.value = it.barcode || '';
      f.commodity.value = it.commodity || ''; f.basis.value = it.basis != null ? it.basis : '';
      f.marketPrice.value = it.marketPrice != null ? it.marketPrice : ''; f.headWeight.value = it.headWeight != null ? it.headWeight : '';
    } else if (ui.category) {
      f.category.value = ui.category;
    }
    if (!it && prefill && prefill.barcode) f.barcode.value = prefill.barcode;
    updatePricePreview();
    openDialog($('#itemDialog'));
    setTimeout(function () { f.name.focus(); }, 30);
  }

  // live preview of the futures price for the item being edited
  function updatePricePreview() {
    var f = $('#itemForm'), c = commodityById(f.commodity.value);
    var tmp = { commodity: f.commodity.value, unit: f.unit.value, headWeight: num(f.headWeight.value, null), basis: num(f.basis.value, null), marketPrice: num(f.marketPrice.value, null), cost: num(f.cost.value, null), quantity: Math.max(0, num(f.quantity.value, 0)) };
    var u = unitWord(tmp.unit);
    $('#priceFields').hidden = !c;
    $('#headWeightWrap').hidden = !(c && c.kind === 'livestock' && tmp.unit === 'head');
    $('#basisWrap').hidden = !(c && c.symbol);
    $('#basisLabel').textContent = 'Basis (+/− CAD per ' + u + ')';
    $('#marketPriceLabel').textContent = 'Your price (CAD per ' + u + ')' + (c && c.symbol ? ' — overrides futures' : '');
    var out = '';
    if (c) {
      var m = marketUnitPrice(tmp);
      if (c.hint) out += esc(c.hint) + ' ';
      if (m.price != null) out += 'Futures now ≈ <strong>' + cad.format(m.price) + '/' + esc(u) + '</strong>' + (tmp.basis ? ' → ' + cad.format(m.price + tmp.basis) + ' with basis' : '') + '. ';
      else out += esc(reasonText(m.reason, tmp)) + ' ';
      var v = valuation(tmp);
      if (v.unitPrice != null) out += 'Value: ' + cad.format(tmp.quantity * v.unitPrice) + ' (' + esc(v.label) + ').';
    }
    $('#pricePreview').innerHTML = out;
  }
  ['commodity', 'unit', 'headWeight', 'basis', 'marketPrice', 'cost', 'quantity'].forEach(function (n) {
    var el = $('#itemForm').elements[n]; el.addEventListener('input', updatePricePreview); el.addEventListener('change', updatePricePreview);
  });

  $('#itemForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var name = f.name.value.trim();
    var qty = num(f.quantity.value, NaN);
    var barcode = cleanCode(f.barcode.value);
    var dupe = barcode ? findByBarcode(barcode) : null;
    var err = !name ? 'Give the item a name.' : (!isFinite(qty) || qty < 0) ? 'Quantity must be 0 or more.' :
      (dupe && dupe.id !== editingId) ? 'That barcode is already on “' + dupe.name + '”.' : '';
    if (err) { $('#formError').textContent = err; $('#formError').hidden = false; return; }
    var data = {
      name: name, category: f.category.value, location: f.location.value.trim(), unit: f.unit.value,
      threshold: Math.max(0, num(f.threshold.value, 0)), cost: num(f.cost.value, null),
      supplier: f.supplier.value.trim(), notes: f.notes.value.trim(), barcode: barcode,
      commodity: f.commodity.value, basis: num(f.basis.value, null), marketPrice: num(f.marketPrice.value, null), headWeight: num(f.headWeight.value, null)
    };
    if (data.cost != null && data.cost < 0) data.cost = null;
    normalizePriceFields(data);
    if (editingId) {
      var it = findItem(editingId);
      var diff = round(qty - it.quantity);
      Object.assign(it, data);
      it.example = false; // edited -> it's the user's now
      if (diff !== 0) recordChange(it, 'edit', diff, 'Quantity edited');
      else it.updatedAt = nowIso();
      toast('Saved ' + it.name);
    } else {
      var at = nowIso();
      var newItem = Object.assign({ id: uid(), quantity: round(qty), createdAt: at, updatedAt: at, example: false, history: [] }, data);
      newItem.history.push({ id: uid(), date: todayStr(), at: at, type: 'create', change: newItem.quantity, qtyAfter: newItem.quantity, note: 'Starting count' });
      state.items.push(newItem);
      toast('Added ' + newItem.name);
    }
    save(); closeDialog($('#itemDialog')); render();
  });

  var loggingId = null;
  function openLog(id) {
    var it = findItem(id); if (!it) return;
    loggingId = id;
    var f = $('#logForm'); f.reset();
    f.date.value = todayStr();
    $('#logError').hidden = true;
    $('#logTitle').textContent = it.name;
    $('#logCurrent').textContent = 'On hand: ' + numFmt.format(it.quantity) + ' ' + it.unit;
    openDialog($('#logDialog'));
    setTimeout(function () { f.amount.focus(); }, 30);
  }
  $('#logForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, it = findItem(loggingId);
    var amt = num(f.amount.value, NaN);
    if (!isFinite(amt) || amt < 0 || (amt === 0 && f.kind.value !== 'count')) { $('#logError').textContent = 'Enter an amount greater than 0.'; $('#logError').hidden = false; return; }
    var kind = f.kind.value, change;
    if (kind === 'use') change = -Math.min(amt, it.quantity);
    else if (kind === 'delivery') change = amt;
    else change = amt - it.quantity;
    var note = f.note.value.trim() || (kind === 'use' ? 'Used' : kind === 'delivery' ? 'Delivery' : 'Count adjusted');
    recordChange(it, kind, change, note, f.date.value);
    save(); closeDialog($('#logDialog')); render();
    toast(it.name + ': ' + numFmt.format(it.quantity) + ' ' + it.unit + ' on hand' + (isLow(it) ? ' — low stock!' : ''));
  });

  function openHistory(id) {
    var it = findItem(id); if (!it) return;
    $('#historyTitle').textContent = 'History — ' + it.name;
    var labels = { create: 'Added', use: 'Used', delivery: 'Delivery', count: 'Count', adjust: 'Quick adjust', edit: 'Edited' };
    $('#historyList').innerHTML = it.history.length ? '<ul class="hist">' + it.history.map(function (h) {
      var cls = h.change > 0 ? 'pos' : h.change < 0 ? 'neg' : '';
      return '<li><span class="chg ' + cls + '">' + (h.change > 0 ? '+' : '') + numFmt.format(h.change) + '</span>' +
        '<span><strong>' + esc(labels[h.type] || h.type) + '</strong>' + (h.note ? ' — ' + esc(h.note) : '') + '<br><span class="muted">→ ' + numFmt.format(h.qtyAfter) + ' ' + esc(it.unit) + '</span></span>' +
        '<span class="when">' + esc(fmtDate(h.date + 'T12:00:00')) + '</span></li>';
    }).join('') + '</ul>' : '<p class="muted">No history yet.</p>';
    openDialog($('#historyDialog'));
  }

  var confirmCb = null;
  function confirmBox(title, msg, yesLabel, cb) {
    $('#confirmTitle').textContent = title; $('#confirmMsg').textContent = msg; $('#confirmYes').textContent = yesLabel || 'Delete';
    confirmCb = cb; openDialog($('#confirmDialog'));
  }
  $('#confirmNo').onclick = function () { confirmCb = null; closeDialog($('#confirmDialog')); };
  $('#confirmYes').onclick = function () { var cb = confirmCb; confirmCb = null; closeDialog($('#confirmDialog')); if (cb) cb(); };

  // ---------- list actions (delegated) ----------
  var quickTimers = {};
  function quickAdjust(it, dir) {
    var id = it.id;
    if (dir < 0 && it.quantity <= 0) return;
    var delta = dir > 0 ? 1 : -Math.min(1, it.quantity);
    // merge rapid taps into one history entry
    var last = it.history[0];
    if (quickTimers[id] && last && last.type === 'adjust') {
      it.quantity = round(Math.max(0, it.quantity + delta));
      last.change = round(last.change + delta); last.qtyAfter = it.quantity; it.updatedAt = nowIso();
      if (last.change === 0) it.history.shift();
    } else {
      recordChange(it, 'adjust', delta, 'Quick +/-');
    }
    clearTimeout(quickTimers[id]);
    quickTimers[id] = setTimeout(function () { delete quickTimers[id]; }, 4000);
    save(); render();
  }
  $('#list').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]'); if (!btn) return;
    var id = btn.closest('.item').dataset.id, it = findItem(id); if (!it) return;
    var act = btn.dataset.act;
    if (act === 'inc' || act === 'dec') {
      quickAdjust(it, act === 'inc' ? 1 : -1);
    } else if (act === 'log') openLog(id);
    else if (act === 'history') openHistory(id);
    else if (act === 'edit') openItemForm(id);
    else if (act === 'delete') {
      confirmBox('Delete “' + it.name + '”?', 'This removes the item and its history. You can’t undo this (unless you have a backup).', 'Delete', function () {
        state.items = state.items.filter(function (x) { return x.id !== id; });
        save(); render(); toast('Deleted ' + it.name);
      });
    }
  });

  $('#breakdown').addEventListener('click', function (e) {
    var row = e.target.closest('.cat-row'); if (!row) return;
    ui.category = ui.category === row.dataset.cat ? '' : row.dataset.cat;
    renderFilters(); renderList();
    $('#list').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // ---------- controls ----------
  $('#search').addEventListener('input', function (e) { ui.search = e.target.value; renderList(); });
  $('#filterCategory').addEventListener('change', function (e) { ui.category = e.target.value; renderList(); });
  $('#filterLocation').addEventListener('change', function (e) { ui.location = e.target.value; renderList(); });
  $('#sortBy').addEventListener('change', function (e) { ui.sort = e.target.value; renderList(); });
  $('#lowOnly').addEventListener('change', function (e) { ui.lowOnly = e.target.checked; renderList(); });
  $('#addBtn').addEventListener('click', function () { openItemForm(null); });

  // ---------- data menu ----------
  var menu = $('#menu'), menuBtn = $('#menuBtn');
  menuBtn.addEventListener('click', function (e) { e.stopPropagation(); menu.hidden = !menu.hidden; menuBtn.setAttribute('aria-expanded', String(!menu.hidden)); });
  document.addEventListener('click', function (e) { if (!menu.hidden && !menu.contains(e.target)) { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); } });
  menu.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-action]'); if (!b) return;
    menu.hidden = true;
    var a = b.dataset.action;
    if (a === 'export-csv') exportCSV();
    else if (a === 'export-json') exportJSON();
    else if (a === 'import-json') $('#importFile').click();
    else if (a === 'clear-examples') clearExamples();
    else if (a === 'load-examples') { state.items = state.items.concat(makeExamples()); save(); render(); toast('Example items added'); }
  });
  $('#clearExamplesBtn').addEventListener('click', clearExamples);

  function clearExamples() {
    var n = state.items.filter(function (i) { return i.example; }).length;
    if (!n) { toast('No example items to clear.'); return; }
    confirmBox('Clear example data?', 'Removes the ' + n + ' items tagged “Example”. Your own items (and any example you edited) stay.', 'Clear', function () {
      state.items = state.items.filter(function (i) { return !i.example; });
      save(); render(); toast('Example data cleared');
    });
  }

  function download(filename, text, type) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // guard against spreadsheet formula injection
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV() {
    var head = ['Name', 'Category', 'Quantity', 'Unit', 'Location', 'Low-stock threshold', 'Low stock?', 'Cost per unit (CAD)', 'Commodity', 'Basis (CAD/unit)', 'Your price (CAD/unit)', 'Avg weight per head (lb)', 'Futures price (CAD/unit)', 'Price used (CAD/unit)', 'Price source', 'Total value (CAD)', 'Supplier', 'Notes', 'Barcode', 'Last updated', 'Example data'];
    var rows = state.items.map(function (i) {
      var v = valuation(i), m = marketUnitPrice(i), c = commodityById(i.commodity);
      return [i.name, i.category, i.quantity, i.unit, i.location, i.threshold, isLow(i) ? 'yes' : 'no', i.cost != null ? i.cost : '',
        c ? c.label : '', i.basis != null ? i.basis : '', i.marketPrice != null ? i.marketPrice : '', i.headWeight != null ? i.headWeight : '',
        m.price != null ? m.price.toFixed(4) : '', v.unitPrice != null ? v.unitPrice.toFixed(4) : '', v.label, v.unitPrice != null ? itemValue(i).toFixed(2) : '',
        i.supplier, i.notes, i.barcode || '', i.updatedAt, i.example ? 'yes' : 'no'];
    });
    return [head].concat(rows).map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }
  function exportCSV() { download('farm-inventory-' + todayStr() + '.csv', '\ufeff' + toCSV(), 'text/csv;charset=utf-8'); toast('CSV exported'); }
  function exportJSON() {
    var payload = { app: 'farm-inventory', version: 1, exportedAt: nowIso(), items: state.items, prices: { fetchedAt: prices.fetchedAt, fileGeneratedAt: prices.fileGeneratedAt, fx: prices.fx, quotes: prices.quotes } };
    download('farm-inventory-backup-' + todayStr() + '.json', JSON.stringify(payload, null, 2), 'application/json');
    toast('Backup saved');
  }

  function sanitizeItem(r) {
    if (!r || typeof r !== 'object' || !String(r.name || '').trim()) return null;
    var at = r.updatedAt && !isNaN(new Date(r.updatedAt)) ? r.updatedAt : nowIso();
    var out = {
      id: String(r.id || uid()), name: String(r.name).trim().slice(0, 120),
      category: CATEGORIES.indexOf(r.category) >= 0 ? r.category : 'Other',
      quantity: Math.max(0, num(r.quantity, 0)), unit: UNITS.indexOf(r.unit) >= 0 ? r.unit : 'each',
      location: String(r.location || ''), threshold: Math.max(0, num(r.threshold, 0)),
      cost: num(r.cost, null), supplier: String(r.supplier || ''), notes: String(r.notes || ''),
      barcode: cleanCode(r.barcode),
      commodity: r.commodity, basis: r.basis, marketPrice: r.marketPrice, headWeight: r.headWeight,
      createdAt: r.createdAt || at, updatedAt: at, example: !!r.example,
      history: Array.isArray(r.history) ? r.history.filter(function (h) { return h && typeof h === 'object'; }).map(function (h) {
        return { id: String(h.id || uid()), date: String(h.date || at.slice(0, 10)), at: h.at || at, type: String(h.type || 'adjust'), change: num(h.change, 0), qtyAfter: num(h.qtyAfter, 0), note: String(h.note || '') };
      }) : []
    };
    normalizePriceFields(out);
    return out;
  }
  function importData(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { toast('That file isn’t valid JSON.'); return; }
    var raw = Array.isArray(data) ? data : data && data.items;
    if (!Array.isArray(raw)) { toast('No items found in that file.'); return; }
    var items = raw.map(sanitizeItem).filter(Boolean);
    confirmBox('Import ' + items.length + ' items?', 'This replaces everything currently in the app with the backup. Export a backup first if you want to keep what’s here.', 'Replace', function () {
      state.items = items; save(); render(); toast('Imported ' + items.length + ' items');
    });
  }
  $('#importFile').addEventListener('change', function (e) {
    var file = e.target.files[0]; if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { importData(String(reader.result)); e.target.value = ''; };
    reader.readAsText(file);
  });

  var toastTimer;
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  // ---------- barcode scanning ----------
  // Native BarcodeDetector where the browser has it (Chrome/Edge on Android, Chrome on macOS);
  // otherwise html5-qrcode (ZXing-based) from a pinned CDN URL, loaded only when first needed (iOS Safari, Firefox, desktop Chrome on Windows/Linux).
  var FALLBACK_LIB = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';
  var FALLBACK_SRI = 'sha384-c9d8RFSL+u3exBOJ4Yp3HUJXS4znl9f+z66d1y54ig+ea249SpqR+w1wyvXz/lk+';
  var WANTED_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code', 'itf', 'data_matrix'];
  var scan = { mode: 'lookup', stream: null, timer: null, h5: null, busy: false, session: 0 };
  var libPromise = null;

  function setScanStatus(msg, isError) {
    var el = $('#scanStatus'); el.textContent = msg; el.classList.toggle('error-msg', !!isError);
  }
  function loadFallbackLib() {
    if (window.Html5Qrcode) return Promise.resolve();
    if (libPromise) return libPromise;
    libPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = FALLBACK_LIB; s.integrity = FALLBACK_SRI; s.crossOrigin = 'anonymous'; s.async = true;
      s.onload = function () { window.Html5Qrcode ? resolve() : reject(new Error('Scanner library did not load')); };
      s.onerror = function () { libPromise = null; reject(new Error('Could not download the scanner library (are you offline?)')); };
      document.head.appendChild(s);
    });
    return libPromise;
  }
  function nativeFormats() {
    if (!('BarcodeDetector' in window) || typeof window.BarcodeDetector.getSupportedFormats !== 'function') return Promise.resolve([]);
    return window.BarcodeDetector.getSupportedFormats().then(function (f) {
      return WANTED_FORMATS.filter(function (x) { return f.indexOf(x) >= 0; });
    }).catch(function () { return []; });
  }
  function cameraErrorMessage(err) {
    var n = err && err.name || '', m = String(err && err.message || err || '');
    if (n === 'NotAllowedError' || n === 'SecurityError' || /permission|denied|notallowed/i.test(m))
      return 'Camera access was blocked. Type the barcode below, or allow camera access for this site in your browser settings and try again.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError' || /not ?found|no camera|requested device/i.test(m))
      return 'No camera found on this device. Type the barcode below instead.';
    if (n === 'NotReadableError' || /in use|could not start/i.test(m))
      return 'The camera is busy in another app. Close it and try again, or type the barcode below.';
    if (n === 'NotSupportedError' || /notsupported/i.test(m))
      return 'This browser can’t open the camera on this page. Type the barcode below instead.';
    return 'Couldn’t start the camera (' + (m.replace(/^Error getting userMedia, error = /i, '') || n || 'unknown error') + '). Type the barcode below instead.';
  }

  function openScanner(mode) {
    scan.mode = mode || 'lookup';
    scan.session++;
    $('#scanTitle').textContent = scan.mode === 'fill' ? 'Scan into barcode field' : 'Scan a barcode';
    $('#manualCode').value = '';
    $('#manualGo').textContent = scan.mode === 'fill' ? 'Use this code' : 'Look up';
    openDialog($('#scanDialog'));
    startCamera(scan.session);
  }

  function startCamera(session) {
    var view = $('#scanView'), video = $('#scanVideo');
    view.hidden = false; video.hidden = true; $('#scanFrame').hidden = true; $('#scanReader').innerHTML = '';
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      view.hidden = true;
      setScanStatus('The camera isn’t available here (it needs a secure https:// page and a browser with camera support). Type the barcode below instead.', true);
      return;
    }
    setScanStatus('Starting camera…');
    nativeFormats().then(function (formats) {
      if (session !== scan.session) return;
      if (formats.length) return startNative(session, formats);
      return startFallback(session);
    }).catch(function (err) {
      if (session !== scan.session) return;
      stopCamera(); view.hidden = true;
      setScanStatus(cameraErrorMessage(err), true);
      setTimeout(function () { $('#manualCode').focus(); }, 30);
    });
  }

  function startNative(session, formats) {
    var detector = new window.BarcodeDetector({ formats: formats });
    var video = $('#scanVideo');
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(function (stream) {
        if (session !== scan.session) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
        scan.stream = stream;
        video.srcObject = stream; video.hidden = false; $('#scanFrame').hidden = false;
        return video.play().then(function () {
          setScanStatus('Point the camera at a barcode or QR code.');
          var tick = function () {
            if (session !== scan.session || !scan.stream) return;
            if (video.readyState < 2) { scan.timer = setTimeout(tick, 150); return; }
            detector.detect(video).then(function (codes) {
              if (session !== scan.session) return;
              var hit = codes && codes.find(function (c) { return c.rawValue; });
              if (hit) onDetected(hit.rawValue); else scan.timer = setTimeout(tick, 120);
            }).catch(function () { scan.timer = setTimeout(tick, 250); });
          };
          tick();
        });
      });
  }

  function startFallback(session) {
    setScanStatus('Loading scanner…');
    return loadFallbackLib().then(function () {
      if (session !== scan.session) return;
      var F = window.Html5QrcodeSupportedFormats;
      var fmts = F ? [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.QR_CODE, F.ITF, F.DATA_MATRIX].filter(function (x) { return x != null; }) : undefined;
      var h5 = new window.Html5Qrcode('scanReader', { formatsToSupport: fmts, verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
      scan.h5 = h5;
      return h5.start({ facingMode: 'environment' }, {
        fps: 10,
        qrbox: function (w, h) { var bw = Math.max(50, Math.floor(Math.min(w * 0.85, 360))); return { width: bw, height: Math.max(50, Math.floor(Math.min(h * 0.6, bw * 0.6))) }; }
      }, function (text) { if (session === scan.session) onDetected(text); }, function () { /* no code in this frame */ })
        .then(function () { if (session === scan.session) setScanStatus('Point the camera at a barcode or QR code.'); else stopCamera(); });
    });
  }

  function stopCamera() {
    clearTimeout(scan.timer); scan.timer = null;
    if (scan.stream) { scan.stream.getTracks().forEach(function (t) { t.stop(); }); scan.stream = null; }
    var v = $('#scanVideo'); if (v) { try { v.pause(); } catch (e) {} v.srcObject = null; }
    if (scan.h5) {
      var h5 = scan.h5; scan.h5 = null;
      try { var p = h5.stop(); if (p && p.then) p.then(function () { try { h5.clear(); } catch (e) {} }).catch(function () {}); } catch (e) {}
    }
  }
  $('#scanDialog').addEventListener('close', function () { scan.session++; stopCamera(); });

  function onDetected(code) {
    code = cleanCode(code); if (!code) return;
    if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) {} }
    scan.session++; stopCamera(); closeDialog($('#scanDialog'));
    if (scan.mode === 'fill') {
      $('#fBarcode').value = code;
      var dupe = findByBarcode(code);
      toast(dupe && dupe.id !== editingId ? 'Heads up: that barcode is already on “' + dupe.name + '”.' : 'Barcode added: ' + code);
    } else {
      handleScan(code);
    }
  }

  $('#manualForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var code = cleanCode($('#manualCode').value);
    if (!code) { setScanStatus('Type a barcode number first.', true); $('#manualCode').focus(); return; }
    onDetected(code);
  });

  // ---------- scan result ----------
  var resultCode = '';
  function handleScan(code) {
    resultCode = cleanCode(code);
    var it = findByBarcode(resultCode);
    if (it) showFound(it); else showNotFound(resultCode);
    var d = $('#scanResultDialog'); if (!d.open) openDialog(d);
  }
  function showFound(it) {
    var low = isLow(it);
    $('#scanResult').innerHTML =
      '<p class="muted small-cap">Scanned ▥ ' + esc(resultCode) + '</p>' +
      '<h2 class="sr-name">' + esc(it.name) + '</h2>' +
      '<div class="tags">' + '<span class="tag">' + esc(it.category) + '</span>' +
        (it.location ? '<span class="tag loc">📍 ' + esc(it.location) + '</span>' : '') +
        (low ? '<span class="tag lowtag">LOW STOCK</span>' : '') + '</div>' +
      '<div class="qty-row sr-qty' + (low ? ' low' : '') + '" data-id="' + it.id + '"><div class="qty" id="srQty">' + numFmt.format(it.quantity) + '<small>' + esc(it.unit) + '</small></div>' +
        '<div class="steppers"><button type="button" class="step" data-sr="dec" aria-label="Decrease ' + esc(it.name) + ' by 1">−</button><button type="button" class="step" data-sr="inc" aria-label="Increase ' + esc(it.name) + ' by 1">+</button></div></div>' +
      '<div class="sr-actions">' +
        '<button type="button" class="btn primary" data-sr="use">Log usage</button>' +
        '<button type="button" class="btn primary" data-sr="delivery">Log delivery</button>' +
        '<button type="button" class="btn" data-sr="history">History</button>' +
        '<button type="button" class="btn" data-sr="edit">Edit</button>' +
      '</div>' +
      '<div class="dialog-actions"><button type="button" class="btn ghost" data-sr="again">📷 Scan another</button><button type="button" class="btn primary" data-sr="done">Done</button></div>';
    $('#scanResult').dataset.id = it.id;
  }
  function showNotFound(code) {
    var opts = state.items.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'en-CA', { sensitivity: 'base' }); })
      .map(function (i) { return '<option value="' + i.id + '">' + esc(i.name) + (i.barcode ? ' (has ' + esc(i.barcode) + ')' : '') + '</option>'; }).join('');
    $('#scanResult').dataset.id = '';
    $('#scanResult').innerHTML =
      '<p class="muted small-cap">Scanned ▥ ' + esc(code) + '</p>' +
      '<h2>No item with this barcode yet</h2>' +
      '<p class="muted">Add it as a new item, or attach this barcode to something you already track.</p>' +
      '<div class="sr-actions"><button type="button" class="btn primary" data-sr="add">+ Add new item</button></div>' +
      (state.items.length ?
        '<div class="link-box"><label for="linkSelect">Link to existing item</label><div class="input-with-btn">' +
        '<select id="linkSelect">' + opts + '</select><button type="button" class="btn" data-sr="link">Link</button></div></div>' : '') +
      '<div class="dialog-actions"><button type="button" class="btn ghost" data-sr="again">📷 Scan again</button><button type="button" class="btn ghost" data-sr="done">Cancel</button></div>';
  }
  $('#scanResultDialog').addEventListener('click', function (e) {
    var d = $('#scanResultDialog');
    if (e.target === d) { closeDialog(d); return; }
    var b = e.target.closest('[data-sr]'); if (!b) return;
    var act = b.dataset.sr, it = findItem($('#scanResult').dataset.id);
    if (act === 'done') closeDialog(d);
    else if (act === 'again') { closeDialog(d); openScanner('lookup'); }
    else if (act === 'add') { closeDialog(d); openItemForm(null, { barcode: resultCode }); }
    else if (act === 'link') {
      var target = findItem($('#linkSelect').value); if (!target) return;
      var go = function () {
        target.barcode = resultCode; target.updatedAt = nowIso(); target.example = false;
        save(); render(); toast('Linked ' + resultCode + ' to ' + target.name);
        showFound(target);
      };
      if (target.barcode && codeKey(target.barcode) !== codeKey(resultCode)) {
        confirmBox('Replace barcode?', '“' + target.name + '” already has barcode ' + target.barcode + '. Replace it with ' + resultCode + '?', 'Replace', go);
      } else go();
    }
    else if (!it) return;
    else if (act === 'inc' || act === 'dec') { quickAdjust(it, act === 'inc' ? 1 : -1); showFound(it); }
    else if (act === 'use' || act === 'delivery') {
      closeDialog(d); openLog(it.id);
      var r = $('#logForm').querySelector('input[name=kind][value=' + act + ']'); if (r) r.checked = true;
    }
    else if (act === 'history') { closeDialog(d); openHistory(it.id); }
    else if (act === 'edit') { closeDialog(d); openItemForm(it.id); }
  });

  $('#scanBtn').addEventListener('click', function () { openScanner('lookup'); });
  $('#formScanBtn').addEventListener('click', function () { openScanner('fill'); });

  // expose a tiny API for testing/debugging
  window.FarmInventory = { state: function () { return state; }, toCSV: toCSV, importData: importData, isLow: isLow, handleScan: handleScan, findByBarcode: findByBarcode,
    prices: function () { return prices; }, valuation: valuation, refreshPrices: refreshPrices, COMMODITIES: COMMODITIES };

  save();
  render();
  // refresh on open if the saved prices are older than 20 minutes (or missing); works offline from the cache
  if (!prices.fetchedAt || Date.now() - new Date(prices.fetchedAt).getTime() > 20 * 60000 || !prices.fx) refreshPrices(false);
  window.addEventListener('online', function () { refreshPrices(false); });
})();
