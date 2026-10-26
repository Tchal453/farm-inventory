// Fetches delayed futures quotes (Yahoo Finance chart endpoint; MIAX hard red spring wheat from the
// TradingView public scanner, since Yahoo has no MIAX/MGEX data) + USD/CAD (Bank of Canada Valet)
// and writes prices.json next to index.html. Run by .github/workflows/update-prices.yml, or by hand:
//   node scripts/update-prices.mjs
// The browser can't call Yahoo directly (no CORS headers), so the app reads this same-origin file instead.
// If every fetch fails, the existing prices.json is left untouched.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prices.json');
const SYMBOLS = ['ZC=F', 'ZS=F', 'ZW=F', 'KE=F', 'ZO=F', 'LE=F', 'GF=F', 'HE=F', 'HO=F'];
// TradingView symbols (MIAX = Minneapolis, formerly MGEX). Stored in prices.json under these keys.
const TV_SYMBOLS = ['MIAX:MWE1!'];
// Note: Yahoo answers "Too Many Requests" to browser-like User-Agents, so keep this plain one.
const UA = { 'User-Agent': 'Mozilla/5.0 (farm-inventory price updater; github.com/Tchal453/farm-inventory)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url, opts = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { ...opts, headers: { ...UA, Accept: 'application/json', ...(opts.headers || {}) } });
      if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
      return await r.json();
    } catch (e) { lastErr = e; await sleep(1500 * (attempt + 1)); }
  }
  throw lastErr;
}
// TradingView scanner: price in USD per bushel (not cents).
async function tvQuotes(tickers) {
  const d = await getJSON('https://scanner.tradingview.com/futures/scan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols: { tickers }, columns: ['close', 'change_abs', 'currency', 'update_time', 'description', 'exchange'] })
  });
  const res = {};
  for (const row of (d && d.data) || []) {
    const [close, chg, currency, t, desc, exch] = row.d;
    if (typeof close !== 'number' || !(close > 0)) continue;
    // sanity: HRS wheat should be a few US$/bu; reject anything absurd (e.g. a unit change upstream)
    if (/MWE/.test(row.s) && (close < 2 || close > 20)) { console.warn('WARN', row.s, 'price out of range', close); continue; }
    res[row.s] = {
      price: close,
      prevClose: typeof chg === 'number' ? Math.round((close - chg) * 1e6) / 1e6 : null,
      currency: currency || 'USD',
      time: t ? new Date(t * 1000).toISOString() : null,
      name: (desc || row.s) + (/1!$/.test(row.s) ? ', front month' : ''),
      exchange: exch || ''
    };
  }
  return res;
}
async function quote(sym) {
  let lastErr;
  for (const host of ['query1', 'query2']) {
    try {
      const d = await getJSON(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1d`);
      const m = d && d.chart && d.chart.result && d.chart.result[0] && d.chart.result[0].meta;
      if (!m || typeof m.regularMarketPrice !== 'number') throw new Error(sym + ': no price in response');
      return {
        price: m.regularMarketPrice,
        prevClose: typeof m.chartPreviousClose === 'number' ? m.chartPreviousClose : null,
        currency: m.currency,            // USX = US cents, USD = US dollars
        time: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
        name: m.shortName || m.longName || sym,
        exchange: m.fullExchangeName || m.exchangeName || ''
      };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
async function fx() {
  const d = await getJSON('https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1');
  const o = d.observations[d.observations.length - 1];
  return { USDCAD: Number(o.FXUSDCAD.v), date: o.d, source: 'Bank of Canada daily average' };
}

const old = await readFile(OUT, 'utf8').then(JSON.parse).catch(() => null);
const quotes = {};
const failed = [];
for (const s of SYMBOLS) {
  try { quotes[s] = await quote(s); } catch (e) { failed.push(s); console.warn('WARN', e.message); if (old && old.quotes && old.quotes[s]) quotes[s] = { ...old.quotes[s], stale: true }; }
}
let tv = {};
try { tv = await tvQuotes(TV_SYMBOLS); } catch (e) { console.warn('WARN tradingview', e.message); }
for (const s of TV_SYMBOLS) {
  if (tv[s]) quotes[s] = tv[s];
  else { failed.push(s); console.warn('WARN no quote for', s); if (old && old.quotes && old.quotes[s]) quotes[s] = { ...old.quotes[s], stale: true }; }
}
let rate = null;
try { rate = await fx(); } catch (e) { console.warn('WARN fx', e.message); rate = old && old.fx || null; }
if (failed.length === SYMBOLS.length + TV_SYMBOLS.length) { console.error('All quote fetches failed; leaving prices.json unchanged.'); process.exit(0); }
const same = old && JSON.stringify(old.quotes) === JSON.stringify(quotes) && JSON.stringify(old.fx) === JSON.stringify(rate);
if (same) { console.log('No price changes; prices.json unchanged.'); process.exit(0); }
const out = {
  generatedAt: new Date().toISOString(),
  source: 'Yahoo Finance (CBOT/CME/NYMEX futures, delayed ~10-20 min) + TradingView (MIAX spring wheat, delayed ~10 min) + Bank of Canada USD/CAD',
  quotes, fx: rate
};
await writeFile(OUT, JSON.stringify(out, null, 2) + '\n');
console.log('Wrote', OUT, Object.keys(quotes).length, 'quotes', failed.length ? '(failed: ' + failed.join(', ') + ')' : '');
