// ============================================================================
//  DATA LAYER  —  live NEPSE feed (surajrimal07/NepseAPI-Unofficial)
//
//  The feed gives LIVE PRICES. Support/resistance bands and the accounting
//  figures (EPS/PE/PB/ROE) are NOT in the feed, so they live in your own
//  watchlist (editable in-app, persisted on the device). Live price is merged
//  onto each watchlist entry to compute the signal and scores.
//
//  Educational / personal use only — see the repo's licence.
// ============================================================================
import AsyncStorage from '@react-native-async-storage/async-storage';

// Hosted instance (free, rate-limited, no uptime guarantee). For reliability,
// self-host the FastAPI server and set this to e.g. http://192.168.1.50:8000
export const DEFAULT_API = 'https://nepseapi.surajrimal.dev';

const KEY_API = 'nepse.apiUrl';
const KEY_WATCH = 'nepse.watchlist.v1';
const KEY_INDEX = 'nepse.indexBand.v1';

// ---- First-run seed (your tracked names + bands; everything is editable) ----
export const SEED_WATCHLIST = [
  { symbol: 'RFPL', name: 'Reliance Finance', sector: 'Finance', support: 837, resistance: 910,
    fundamentals: { eps: 41, pe: 21.2, pb: 2.1, roe: 16.5 }, alert: { cost: 838, above: 910, below: 837 } },
  { symbol: 'MMKJL', name: 'Mailung Khola Jal Vidhyut', sector: 'Hydropower', support: 630, resistance: 660,
    fundamentals: { eps: 28, pe: 23.0, pb: 1.8, roe: 13.0 }, alert: { above: 660, below: 630 } },
  { symbol: 'HRL', name: 'Himalayan Reinsurance', sector: 'Reinsurance', support: 680, resistance: 760,
    fundamentals: { eps: 19, pe: 37.5, pb: 3.2, roe: 9.1 }, alert: { above: 760, below: 680 } },
  { symbol: 'SAHAS', name: 'Sahas Urja', sector: 'Hydropower', support: 500, resistance: 560,
    fundamentals: { eps: 31, pe: 17.4, pb: 1.9, roe: 17.1 }, alert: { above: 560, below: 500 } },
  { symbol: 'NABIL', name: 'Nabil Bank', sector: 'Commercial Bank', support: 498, resistance: 545,
    fundamentals: { eps: 33, pe: 15.5, pb: 1.6, roe: 18.2 }, alert: {} },
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
    if (res.status === 429) throw new Error('Rate limited (429) — wait a minute and retry.');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// The feed returns slightly different shapes across versions/endpoints, so pull
// each field from a list of likely keys.
const pick = (o, keys) => {
  for (const k of keys) if (o[k] != null && o[k] !== '') return o[k];
  return undefined;
};
const num = (v) => {
  if (v == null) return null;
  const n = Number(String(v).replace(/,/g, ''));
  return isNaN(n) ? null : n;
};

function normalizeQuote(raw) {
  const symbol = pick(raw, ['symbol', 'Symbol', 'scrip', 'ticker', 'stockSymbol']);
  if (!symbol) return null;
  return {
    symbol: String(symbol).toUpperCase(),
    ltp: num(pick(raw, ['ltp', 'lastTradedPrice', 'lastUpdatedPrice', 'closePrice', 'close', 'price', 'lastPrice'])),
    open: num(pick(raw, ['open', 'openPrice'])),
    high: num(pick(raw, ['high', 'highPrice', 'dayHigh'])),
    low: num(pick(raw, ['low', 'lowPrice', 'dayLow'])),
    prevClose: num(pick(raw, ['previousClose', 'previousDayClose', 'preClose', 'pclose'])),
    percentChange: num(pick(raw, ['percentChange', 'perChange', 'pchange', 'changePercent', 'pointChangePercent'])),
    volume: num(pick(raw, ['volume', 'totalTradeQuantity', 'shareTraded', 'qty'])),
  };
}

function arrFrom(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  // common containers: {data:[...]}, {LiveMarket:[...]}, etc.
  for (const k of ['data', 'LiveMarket', 'PriceVolume', 'content', 'result', 'records']) {
    if (Array.isArray(data[k])) return data[k];
  }
  // object keyed by symbol -> wrap values
  const vals = Object.values(data);
  if (vals.length && typeof vals[0] === 'object') return vals;
  return [];
}

// ---- Public fetchers --------------------------------------------------------
export async function fetchQuoteMap(api) {
  // Try LiveMarket first, fall back to PriceVolume.
  let list = [];
  try { list = arrFrom(await getJSON(`${api}/LiveMarket`)); } catch (e) {
    list = arrFrom(await getJSON(`${api}/PriceVolume`));
  }
  const map = {};
  for (const r of list) {
    const q = normalizeQuote(r);
    if (q && q.ltp != null) map[q.symbol] = q;
  }
  return map;
}

export async function fetchIndex(api, band) {
  const b = band || SEED_INDEX_BAND;
  try {
    const data = await getJSON(`${api}/NepseIndex`);
    // NepseIndex may be an object or an array of indices; find the NEPSE one.
    let node = data;
    if (Array.isArray(data)) {
      node = data.find((x) => /nepse/i.test(JSON.stringify(x.index || x.name || ''))) || data[0];
    } else if (data && data.NEPSE) {
      node = data.NEPSE;
    }
    const value = num(pick(node || {}, ['currentValue', 'value', 'index', 'close', 'ltp', 'indexValue']));
    const changePct = num(pick(node || {}, ['percentChange', 'perChange', 'changePercent', 'pchange'])) ?? 0;
    return { name: 'NEPSE Index', value, changePct, support: b.support, resistance: b.resistance };
  } catch (e) {
    return { name: 'NEPSE Index', value: null, changePct: 0, support: b.support, resistance: b.resistance, error: String(e.message || e) };
  }
}

export async function fetchMovers(api) {
  const out = { gainers: [], losers: [] };
  try { out.gainers = arrFrom(await getJSON(`${api}/TopGainers`)).map(normalizeQuote).filter(Boolean).slice(0, 12); } catch {}
  try { out.losers = arrFrom(await getJSON(`${api}/TopLosers`)).map(normalizeQuote).filter(Boolean).slice(0, 12); } catch {}
  return out;
}

export async function pingApi(api) {
  const data = await getJSON(`${api}/health`, 8000);
  return data;
}

// Merge live prices onto the saved watchlist -> the shape App.js renders.
export function mergeWatchlist(watchlist, quoteMap) {
  return watchlist.map((w) => {
    const q = quoteMap[String(w.symbol).toUpperCase()];
    return {
      ...w,
      price: q ? q.ltp : null,
      percentChange: q ? q.percentChange : null,
      volume: q ? q.volume : null,
      watchlist: w.alert, // App.js reads `.watchlist` for alert thresholds
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
    [quoteMap, index] = await Promise.all([fetchQuoteMap(api), fetchIndex(api, indexBand)]);
    live = Object.keys(quoteMap).length > 0;
    if (!live) error = 'Connected, but no quotes returned (market may be closed or schema changed).';
  } catch (e) {
    error = String(e.message || e);
  }
  return { live, error, api, stocks: mergeWatchlist(watchlist, quoteMap), index, indexBand, watchlist };
}
