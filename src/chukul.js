// Chukul (login-gated) data client — personal use. Sends your chk-session
// cookie (stored on-device) as a Cookie header. RN has no CORS, so this works.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getWatchlist, getIndexBand } from './data';
import { analyze } from './analysis';
import { loadJournal, liveStats, calibration } from './journal';

const KEY_COOKIE = 'chukul.session';
export const STOCK_LIST_URL = 'https://chukul.com/api/stock/';
export const CANDLE_BASE = 'https://live.chukul.com/api/data/adjhistorydata/data/';

// How many recent daily candles to analyse. Keeps S/R, targets and the chart
// anchored to CURRENT structure instead of years of history.
export const WINDOW = 120;

export async function getCookie() {
  return (await AsyncStorage.getItem(KEY_COOKIE)) || '';
}
export async function setCookie(v) {
  await AsyncStorage.setItem(KEY_COOKIE, (v || '').trim());
}

function buildHeaders(cookie) {
  const h = { Accept: 'application/json' };
  if (cookie) h.Cookie = `chk-session=${cookie}`;
  return h;
}

async function getJSON(url, cookie, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: buildHeaders(cookie) });
    if (res.status === 401 || res.status === 403)
      throw new Error('Session expired — paste a fresh chk-session cookie in the Chart tab.');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function fetchStockList(cookie) {
  const data = await getJSON(STOCK_LIST_URL, cookie);
  const arr = Array.isArray(data) ? data : data.results || data.data || [];
  return arr
    .filter((s) => s && s.symbol && !s.is_delisted && !s.is_merged)
    .map((s) => ({ symbol: String(s.symbol).toUpperCase(), name: s.name || s.symbol, sector: s.sector }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export async function fetchCandles(symbol, cookie) {
  const v = Math.floor(Date.now() / 1000);
  const url = `${CANDLE_BASE}?symbol=${encodeURIComponent(symbol)}&v=${v}`;
  const d = await getJSON(url, cookie);
  const src = d && d.o ? d : d && d.data && d.data.o ? d.data : d || {};
  const o = src.o || [], h = src.h || [], l = src.l || [], c = src.c || [], t = src.t || [], vol = src.vol || src.v || [];
  const n = Math.min(o.length, h.length, l.length, c.length);

  let rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({ o: +o[i], h: +h[i], l: +l[i], c: +c[i], v: +(vol[i] || 0), t: +(t[i] || 0) });
  }

  // Ensure chronological order (oldest -> newest) using timestamps when present,
  // so the LAST element is the most recent candle (= current price).
  const haveT = rows.every((r) => r.t > 0);
  if (haveT) rows.sort((a, b) => a.t - b.t);

  // Keep only the most recent WINDOW candles so analysis reflects current structure.
  rows = rows.slice(-WINDOW);

  // Re-index for the chart.
  return rows.map((r, i) => ({ i, ...r }));
}

// Unified loader — drives Picks/Watch/index from real Chukul candle analysis.
// Falls back to stored bands + manual prices when no cookie is set.
function pctChange(candles, price) {
  if (!candles || candles.length < 2 || price == null) return null;
  const prev = candles[candles.length - 2].c;
  return prev ? ((price - prev) / prev) * 100 : null;
}

export async function loadAnalysis() {
  const cookie = await getCookie();
  const [watchlist, indexBand] = await Promise.all([getWatchlist(), getIndexBand()]);

  if (!cookie) {
    const stocks = watchlist.map((w) => ({
      ...w,
      price: w.manualPrice ? Number(w.manualPrice) : null,
      support: w.support, resistance: w.resistance,
      watchlist: w.alert, percentChange: null,
    }));
    return {
      live: false,
      error: 'Set your Chukul cookie in the Chart tab to load live prices and real levels.',
      hasCookie: false, stocks, indexBand, watchlist,
      index: { name: 'NEPSE Index', value: null, changePct: 0, ...indexBand },
    };
  }

  // Fetch NEPSE index candles ONCE up front so each stock gets relative-strength vs index.
  let indexCandles = [];
  try { indexCandles = await fetchCandles('NEPSE', cookie); } catch (e) { /* RS will be null */ }
  const benchmark = indexCandles.length >= 60 ? indexCandles : null;

  const stocks = [];
  for (const w of watchlist) {
    try {
      const candles = await fetchCandles(w.symbol, cookie);
      const a = analyze(candles, { benchmark });
      if (a) {
        stocks.push({
          ...w, price: a.price, support: a.support, resistance: a.resistance,
          watchlist: w.alert, percentChange: pctChange(candles, a.price), analysis: a,
        });
      } else {
        const lp = candles.length ? candles[candles.length - 1].c : (w.manualPrice ? Number(w.manualPrice) : null);
        stocks.push({ ...w, price: lp, support: w.support, resistance: w.resistance, watchlist: w.alert, percentChange: pctChange(candles, lp) });
      }
    } catch (e) {
      stocks.push({ ...w, price: w.manualPrice ? Number(w.manualPrice) : null, support: w.support, resistance: w.resistance, watchlist: w.alert, percentChange: null });
    }
  }
  // Track record reads from the journal (which is fed by Chart-tab searches, not the watchlist).
  const _jrnl = await loadJournal();
  const liveRecord = liveStats(_jrnl);
  const liveCalibration = calibration(_jrnl);

  // Reuse the index candles fetched above for the header gauge.
  let index = { name: 'NEPSE Index', value: null, changePct: 0, ...indexBand };
  let indexOk = false;
  if (indexCandles.length) {
    const v = indexCandles[indexCandles.length - 1].c;
    index = { name: 'NEPSE Index', value: v, changePct: pctChange(indexCandles, v) ?? 0, ...indexBand };
    indexOk = true;
  }

  const anyStockOk = stocks.some((s) => s.price != null);
  const cookieWorks = indexOk || anyStockOk;
  let error = '';
  if (!cookieWorks) error = 'Chukul cookie may have expired — re-paste it in Settings or the Chart tab.';
  else if (watchlist.length && !anyStockOk) error = 'Index loaded but watchlist prices are missing — try Pull to refresh.';
  return {
    live: cookieWorks, error, hasCookie: true, stocks, index, indexBand, watchlist, liveRecord, liveCalibration,
  };
}
