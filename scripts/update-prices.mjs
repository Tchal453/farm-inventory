// Fetches delayed futures quotes (Yahoo Finance chart endpoint) + USD/CAD (Bank of Canada Valet)
// and writes prices.json next to index.html. Run by .github/workflows/update-prices.yml, or by hand:
//   node scripts/update-prices.mjs
// The browser can't call Yahoo directly (no CORS headers), so the app reads this same-origin file instead.
// If every fetch fails, the existing prices.json is left untouched.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prices.json');
const SYMBOLS = ['ZC=F', 'ZS=F', 'ZW=F', 'KE=F', 'ZO=F', 'LE=F', 'GF=F', 'HE=F', 'HO=F'];
const UA = { 'User-Agent': 'Mozilla/5.0 (farm-inventory price updater; github.com/Tchal453/farm-inventory)' };

async function getJSON(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
  return r.json();
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
let rate = null;
try { rate = await fx(); } catch (e) { console.warn('WARN fx', e.message); rate = old && old.fx || null; }
if (failed.length === SYMBOLS.length) { console.error('All quote fetches failed; leaving prices.json unchanged.'); process.exit(0); }
const same = old && JSON.stringify(old.quotes) === JSON.stringify(quotes) && JSON.stringify(old.fx) === JSON.stringify(rate);
if (same) { console.log('No price changes; prices.json unchanged.'); process.exit(0); }
const out = {
  generatedAt: new Date().toISOString(),
  source: 'Yahoo Finance (exchange futures, delayed ~10-20 min) + Bank of Canada USD/CAD',
  quotes, fx: rate
};
await writeFile(OUT, JSON.stringify(out, null, 2) + '\n');
console.log('Wrote', OUT, Object.keys(quotes).length, 'quotes', failed.length ? '(failed: ' + failed.join(', ') + ')' : '');
