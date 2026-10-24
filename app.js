/* Farm Inventory v1.1 — vanilla JS, data in localStorage. Barcode scanning added. */
(function () {
  'use strict';

  var STORAGE_KEY = 'farmInventory.v1';
  var CATEGORIES = ['Feed', 'Seed', 'Fertilizer', 'Chemicals/Spray', 'Fuel', 'Parts & Supplies', 'Equipment', 'Livestock', 'Harvested Grain', 'Other'];
  var UNITS = ['bags', 'lbs', 'kg', 'bushels', 'litres', 'gallons', 'tonnes', 'head', 'each'];

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
  function itemValue(it) { return it.cost != null ? it.quantity * it.cost : 0; }

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
      { name: 'CWRS wheat 2026', category: 'Harvested Grain', quantity: 6200, unit: 'bushels', location: 'Quonset', threshold: 0, cost: 8.15, supplier: '', notes: 'Grade #2, 13.4% protein. Waiting on contract.', days: 9 }
    ];
    return ex.map(function (e) {
      var at = daysAgoIso(e.days);
      return {
        id: uid(), name: e.name, category: e.category, quantity: e.quantity, unit: e.unit, location: e.location,
        threshold: e.threshold, cost: e.cost, supplier: e.supplier, notes: e.notes,
        createdAt: at, updatedAt: at, example: true,
        history: [{ id: uid(), date: at.slice(0, 10), at: at, type: 'create', change: e.quantity, qtyAfter: e.quantity, note: 'Starting count (example)' }]
      };
    });
  }

  // ---------- state ----------
  var state = load();
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.items)) {
          parsed.items.forEach(function (i) { if (i && typeof i.barcode !== 'string') i.barcode = ''; });
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
      '<div class="stat"><div class="label">Total value</div><div class="value">' + cad.format(value).replace('.00', '') + '</div></div>';
    $('#lowStat').onclick = function () { ui.lowOnly = !ui.lowOnly; $('#lowOnly').checked = ui.lowOnly; renderList(); };
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
          '<span>' + (i.cost != null ? cad.format(i.cost) + '/' + esc(i.unit.replace(/s$/, '')) + ' · ' + cad.format(itemValue(i)) : 'No cost set') + '</span>' +
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
    var it = id ? findItem(id) : null;
    $('#itemDialogTitle').textContent = it ? 'Edit item' : 'Add item';
    if (it) {
      f.name.value = it.name; f.category.value = it.category; f.location.value = it.location || '';
      f.quantity.value = it.quantity; f.unit.value = it.unit; f.threshold.value = it.threshold || 0;
      f.cost.value = it.cost != null ? it.cost : ''; f.supplier.value = it.supplier || ''; f.notes.value = it.notes || '';
      f.barcode.value = it.barcode || '';
    } else if (ui.category) {
      f.category.value = ui.category;
    }
    if (!it && prefill && prefill.barcode) f.barcode.value = prefill.barcode;
    openDialog($('#itemDialog'));
    setTimeout(function () { f.name.focus(); }, 30);
  }

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
      supplier: f.supplier.value.trim(), notes: f.notes.value.trim(), barcode: barcode
    };
    if (data.cost != null && data.cost < 0) data.cost = null;
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
    var head = ['Name', 'Category', 'Quantity', 'Unit', 'Location', 'Low-stock threshold', 'Low stock?', 'Cost per unit (CAD)', 'Total value (CAD)', 'Supplier', 'Notes', 'Barcode', 'Last updated', 'Example data'];
    var rows = state.items.map(function (i) {
      return [i.name, i.category, i.quantity, i.unit, i.location, i.threshold, isLow(i) ? 'yes' : 'no', i.cost != null ? i.cost : '', i.cost != null ? itemValue(i).toFixed(2) : '', i.supplier, i.notes, i.barcode || '', i.updatedAt, i.example ? 'yes' : 'no'];
    });
    return [head].concat(rows).map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }
  function exportCSV() { download('farm-inventory-' + todayStr() + '.csv', '\ufeff' + toCSV(), 'text/csv;charset=utf-8'); toast('CSV exported'); }
  function exportJSON() {
    var payload = { app: 'farm-inventory', version: 1, exportedAt: nowIso(), items: state.items };
    download('farm-inventory-backup-' + todayStr() + '.json', JSON.stringify(payload, null, 2), 'application/json');
    toast('Backup saved');
  }

  function sanitizeItem(r) {
    if (!r || typeof r !== 'object' || !String(r.name || '').trim()) return null;
    var at = r.updatedAt && !isNaN(new Date(r.updatedAt)) ? r.updatedAt : nowIso();
    return {
      id: String(r.id || uid()), name: String(r.name).trim().slice(0, 120),
      category: CATEGORIES.indexOf(r.category) >= 0 ? r.category : 'Other',
      quantity: Math.max(0, num(r.quantity, 0)), unit: UNITS.indexOf(r.unit) >= 0 ? r.unit : 'each',
      location: String(r.location || ''), threshold: Math.max(0, num(r.threshold, 0)),
      cost: num(r.cost, null), supplier: String(r.supplier || ''), notes: String(r.notes || ''),
      barcode: cleanCode(r.barcode),
      createdAt: r.createdAt || at, updatedAt: at, example: !!r.example,
      history: Array.isArray(r.history) ? r.history.filter(function (h) { return h && typeof h === 'object'; }).map(function (h) {
        return { id: String(h.id || uid()), date: String(h.date || at.slice(0, 10)), at: h.at || at, type: String(h.type || 'adjust'), change: num(h.change, 0), qtyAfter: num(h.qtyAfter, 0), note: String(h.note || '') };
      }) : []
    };
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
  window.FarmInventory = { state: function () { return state; }, toCSV: toCSV, importData: importData, isLow: isLow, handleScan: handleScan, findByBarcode: findByBarcode };

  save();
  render();
})();
