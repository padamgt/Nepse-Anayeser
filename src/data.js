// ============================================================================
//  DATA LAYER  —  ShareBazaar NEPSE feed (per-symbol)
//  https://nepsetty.kokomo.workers.dev/api?symbol=SYMBOL
//
//  ShareBazaar returns ONE stock per request, so for your watchlist we query
//  each symbol and combine the results. Support/resistance bands and the
//  accounting figures (EPS/PE/PB/ROE) live in your own watchlist (editable,
//  stored on the device). You can also set a manual price per stock, used as a
//  fallback when the feed has no live data (e.g. market closed / server down).
// ============================================================================
import AsyncStorage from '@react-native-async-storage/async-storage';

export const DEFAULT_API = 'https://nepsetty.kokomo.workers.dev';

const KEY_API = 'nepse.apiUrl';
const KEY_WATCH = 'nepse.watchlist.v1';
const KEY_INDEX = 'nepse.indexBand.v1';

// ---- First-run seed (your tracked names + bands; everything is editable) ----
export const SEED_WATCHLIST = [
  { symbol: 'RFPL', name: 'Reliance Finance', sector: 'Finance', support: 837, resistance: 910,
    fundamentals: { eps: 41, pe: 21.2, pb: 2.1, roe: 16.5 }, alert: { cost: 838, above: 910, below: 837 }, manualPrice: '' },
  { symbol: 'MMKJL', name: 'Mailung Khola Jal Vidhyut', sector: 'Hydropower', support: 630, resistance: 660,
    fundamentals: { eps: 28, pe: 23.0, pb: 1.8, roe: 13.0 }, alert: { above: 660, below: 630 }, manualPrice: '' },
  { symbol: 'HRL', name: 'Himalayan Reinsurance', sector: 'Reinsurance', support: 680, resistance: 760,
    fundamentals: { eps: 19, pe: 37.5, pb: 3.2, roe: 9.1 }, alert: { above: 760, below: 680 }, manualPrice: '' },
  { symbol: 'SAHAS', name: 'Sahas Urja', sector: 'Hydropower', support: 500, resistance: 560,
    fundamentals: { eps: 31, pe: 17.4, pb: 1.9, roe: 17.1 }, alert: { above: 560, below: 500 }, manualPrice: '' },
  { symbol: 'NABIL', name: 'Nabil Bank', sector: 'Commercial Bank', support: 498, resistance: 545,
    fundamentals: { eps: 33, pe: 15.5, pb: 1.6, roe: 18.2 }, alert: {}, manualPrice: '' },
];

export const SEED_INDEX_BAND = { support: 2640, resistance: 2700 };

// ---- Persistence ------------------------------------------------------------
export async function getApiUrl() {
  const v = await AsyncStorage.getItem(KEY_API);
  return v || DEFAULT_API;
}
export async function setApiUrl(url) {
  await AsyncStorage.setItem(KEY_API, (url || '').trim().replace(/\/+$/, ''));
}
export async function getWatchlist() {
  const v = await AsyncStorage.getItem(KEY_WATCH);
  if (!v) {
    await AsyncStorage.setItem(KEY_WATCH, JSON.stringify(SEED_WATCHLIST));
    return SEED_WATCHLIST;
  }
  try { return JSON.parse(v); } catch { return SEED_WATCHLIST; }
}
export async function saveWatchlist(list) {
  await AsyncStorage.setItem(KEY_WATCH, JSON.stringify(list));
}
export async function getIndexBand() {
  const v = await AsyncStorage.getItem(KEY_INDEX);
  if (!v) return SEED_INDEX_BAND;
  try { return JSON.parse(v); } catch { return SEED_INDEX_BAND; }
}
export async function saveIndexBand(band) {
  await AsyncStorage.setItem(KEY_INDEX, JSON.stringify(band));
}

// ---- HTTP helper ------------------------------------------------------------
async function getJSON(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const pick = (o, keys) => {
  for (const k of keys) {
    if (o && o[k] != null && o[k] !== '') return o[k];
    // case-insensitive fallback
    if (o) {
      const hit = Object.keys(o).find((kk) => kk.toLowerCase() === k.toLowerCase());
      if (hit && o[hit] != null && o[hit] !== '') return o[hit];
    }
  }
  return undefined;
};
const num = (v) => {
  if (v == null) return null;
  const n = Number(String(v).replace(/,/g, '').replace(/%/g, '').trim());
  return isNaN(n) ? null : n;
};

const base = (api) => (api || DEFAULT_API).trim().replace(/\/+$/, '');

// ShareBazaar returns a single object (sometimes wrapped). Pull fields tolerantly.
function normalizeShareBazaar(raw, symbol) {
  let o = raw;
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    if (o.data && typeof o.data === 'object') o = o.data;
    else if (o.result && typeof o.result === 'object') o = o.result;
  }
  if (Array.isArray(o)) o = o[0] || {};
  return {
    symbol: String(symbol).toUpperCase(),
    ltp: num(pick(o, ['ltp', 'lastTradedPrice', 'lastPrice', 'currentPrice', 'price', 'close', 'closePrice', 'lastUpdatedPrice'])),
    percentChange: num(pick(o, ['percentChange', 'changePercent', 'perChange', 'pChange', 'changePercentage', 'percentageChange', 'change_percent'])),
    change: num(pick(o, ['change', 'pointChange', 'priceChange', 'changeInPrice'])),
    volume: num(pick(o, ['volume', 'totalTradedQuantity', 'totalTradeQuantity', 'qty', 'shareTraded'])),
  };
}

// ---- Public fetchers --------------------------------------------------------
// Query ShareBazaar once per watchlist symbol and build a {SYMBOL: quote} map.
export async function fetchQuoteMap(api, symbols) {
  const b = base(api);
  const map = {};
  await Promise.all(
    (symbols || []).map(async (sym) => {
      try {
        const data = await getJSON(`${b}/api?symbol=${encodeURIComponent(sym)}`);
        const q = normalizeShareBazaar(data, sym);
        if (q.ltp != null) map[q.symbol] = q;
      } catch (e) {
        /* skip symbols that fail; manual price (if set) still shows */
      }
    })
  );
  return map;
}

export async function fetchIndex(api, band) {
  const bnd = band || SEED_INDEX_BAND;
  try {
    const data = await getJSON(`${base(api)}/api?symbol=NEPSE`);
    const q = normalizeShareBazaar(data, 'NEPSE');
    return { name: 'NEPSE Index', value: q.ltp, changePct: q.percentChange ?? 0, support: bnd.support, resistance: bnd.resistance };
  } catch (e) {
    return { name: 'NEPSE Index', value: null, changePct: 0, support: bnd.support, resistance: bnd.resistance };
  }
}

// ShareBazaar is per-symbol; it has no market-wide movers list.
export async function fetchMovers() {
  return { gainers: [], losers: [] };
}

// "Test connection" — hit a known-good symbol.
export async function pingApi(api) {
  return await getJSON(`${base(api)}/api?symbol=NABIL`, 8000);
}

// Merge live prices onto the saved watchlist. Falls back to the manual price.
export function mergeWatchlist(watchlist, quoteMap) {
  return watchlist.map((w) => {
    const q = quoteMap[String(w.symbol).toUpperCase()];
    const live = q ? q.ltp : null;
    const manual = w.manualPrice != null && w.manualPrice !== '' ? Number(w.manualPrice) : null;
    const price = live != null ? live : manual;
    return {
      ...w,
      price,
      isManual: live == null && manual != null,
      percentChange: q ? q.percentChange : null,
      volume: q ? q.volume : null,
      watchlist: w.alert,
    };
  });
}

// One-shot loader used on mount / refresh.
export async function loadData() {
  const api = await getApiUrl();
  const [watchlist, indexBand] = await Promise.all([getWatchlist(), getIndexBand()]);
  let live = false;
  let error;
  let quoteMap = {};
  let index = { name: 'NEPSE Index', value: null, changePct: 0, ...indexBand };
  try {
    const symbols = watchlist.map((w) => w.symbol);
    [quoteMap, index] = await Promise.all([fetchQuoteMap(api, symbols), fetchIndex(api, indexBand)]);
    live = Object.keys(quoteMap).length > 0;
    if (!live) error = 'No live prices returned (market may be closed, or symbols not found on this feed).';
  } catch (e) {
    error = String(e.message || e);
  }
  return { live, error, api, stocks: mergeWatchlist(watchlist, quoteMap), index, indexBand, watchlist };
}
