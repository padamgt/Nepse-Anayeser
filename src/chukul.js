// Chukul (login-gated) data client — personal use. Sends your chk-session
// cookie (stored on-device) as a Cookie header. RN has no CORS, so this works.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getWatchlist, getIndexBand } from './data';
import { analyze } from './analysis';
import { loadJournal, liveStats, calibration } from './journal';
import { cacheGetCandles, cacheSetCandles, setSyncMeta } from './cache';

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

// Persist the last sector-screen results so they survive tab switches / restarts
// until the user runs a new scan. Stored trimmed (UI fields only) to stay small.
const KEY_SCREEN = 'screen.results.v1';
export async function saveScreen(obj) {
  try { await AsyncStorage.setItem(KEY_SCREEN, JSON.stringify(obj)); } catch (e) { /* ignore */ }
}
export async function loadScreen() {
  try { const s = await AsyncStorage.getItem(KEY_SCREEN); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}
export async function clearScreen() {
  try { await AsyncStorage.removeItem(KEY_SCREEN); } catch (e) { /* ignore */ }
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
  const sectorOf = (s) => {
    for (const k of ['sector', 'sector_id', 'sectorId', 'sector_code', 'sectorCode', 'sectorName', 'sector_name', 'industry', 'category']) {
      if (s[k] != null && s[k] !== '') return s[k];
    }
    for (const k of Object.keys(s)) {
      if (/sector|industry/i.test(k) && s[k] != null && s[k] !== '') return s[k];
    }
    return null;
  };
  return arr
    .filter((s) => s && s.symbol && !s.is_delisted && !s.is_merged)
    .map((s) => ({ symbol: String(s.symbol).toUpperCase(), name: s.name || s.symbol, sector: sectorOf(s) }))
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

// Cache-first candle reader: returns stored candles without touching the network.
// Only fetches live the FIRST time a symbol is seen (then caches it). The daily
// Sync is what refreshes everything — normal reads never call Chukul again.
export async function getCandles(symbol, cookie, { allowLive = true } = {}) {
  const hit = await cacheGetCandles(symbol);
  if (hit && hit.c && hit.c.length) return hit.c;
  if (!allowLive) return [];
  const c = await fetchCandles(symbol, cookie);
  if (c && c.length) await cacheSetCandles(symbol, c);
  return c;
}

// Daily sync: force-fetch fresh candles for a SCOPED list of symbols and store them.
// Deliberately gentle — low concurrency + a small random delay between requests —
// so it reads like a person browsing, not a scraper hammering every symbol at once.
export async function syncAll(symbols, cookie, onProgress) {
  let done = 0, ok = 0, idx = 0;
  const CONC = 2;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const uniq = Array.from(new Set(['NEPSE', ...symbols.map((s) => String(s).toUpperCase())]));
  async function worker() {
    while (idx < uniq.length) {
      const sym = uniq[idx++];
      try {
        const c = await fetchCandles(sym, cookie);
        if (c && c.length) { await cacheSetCandles(sym, c); ok++; }
      } catch (e) { /* skip */ }
      done++;
      if (onProgress) onProgress(done, uniq.length);
      await sleep(200 + Math.random() * 350); // jittered pause between requests
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, uniq.length) }, worker));
  await setSyncMeta({ at: Date.now(), count: ok, total: uniq.length });
  return { synced: ok, total: uniq.length };
}

// Unified loader — drives Picks/Watch/index from real Chukul candle analysis.
// Falls back to stored bands + manual prices when no cookie is set.
function pctChange(candles, price) {
  if (!candles || candles.length < 2 || price == null) return null;
  const prev = candles[candles.length - 2].c;
  return prev ? ((price - prev) / prev) * 100 : null;
}

// Descriptive "setup quality" score used ONLY for ordering a research shortlist.
// NOT a buy recommendation — it deliberately rewards proven out-of-sample edge,
// liquidity and confirmation, and penalises unproven/illiquid/bearish setups.
export function screenScore(a) {
  if (!a) return -999;
  let s = a.tradeQuality || 0;
  const wf = a.report?.walkForward;
  if (wf && wf.oosN >= 8 && wf.oosExp > 0) s += 15;
  if (wf && /holds/.test(wf.verdict)) s += 10;
  if (a.relStrength != null && a.relStrength > 0) s += 8;
  const act = a.action?.label;
  s += act === 'Strong Buy' ? 10 : act === 'Buy' ? 6 : act === 'Watch' ? 2 : act === 'Avoid' ? -12 : 0;
  s += a.liquidity === 'Liquid' ? 5 : a.liquidity === 'Moderate' ? 2 : a.liquidity === 'Thin' ? -6 : -20;
  if ((a.report?.historicalPerformance?.matches || 0) < 10) s -= 10;
  return Math.round(s);
}

// Screen one or more sectors. `sectors` is an array of keyword strings matched
// case-insensitively against each stock's sector (e.g. ['hydro'], ['micro']).
// Heavy: fetches candles for every matching symbol with a small concurrency pool.
export async function screenSectors(sectors, onProgress) {
  const cookie = await getCookie();
  if (!cookie) return { error: 'Set your Chukul cookie in the Chart tab or Settings first.', results: [] };
  const list = await fetchStockList(cookie);
  // Chukul tags each stock with a numeric sector code. Hydropower = 5, Microfinance = 9.
  // Keep keyword fallbacks in case a payload ever uses text labels instead.
  const GROUPS = {
    hydro: { codes: ['5'], kw: ['hydro'] },
    micro: { codes: ['9'], kw: ['laghubitta'] },
    devbank: { codes: ['2'], kw: ['development bank'] },
    finance: { codes: ['3'], kw: [] },
    life: { codes: ['7'], kw: ['life insurance'] },
    nonlife: { codes: ['10'], kw: ['non life', 'non-life'] },
    manuf: { codes: ['8'], kw: ['manufactur', 'processing'] },
    other: { codes: ['11'], kw: [] },
  };
  const wanted = sectors.map((s) => GROUPS[String(s).toLowerCase()]).filter(Boolean);
  const codeSet = new Set(wanted.flatMap((g) => g.codes));
  const kws = wanted.flatMap((g) => g.kw);
  const matchSector = (sec) => {
    if (sec == null) return false;
    if (typeof sec === 'object') {
      const id = sec.id ?? sec.code ?? sec.sector_id ?? sec.pk ?? sec.value;
      if (id != null && codeSet.has(String(id).trim())) return true;
      const nm = String(sec.name ?? sec.title ?? sec.label ?? '').toLowerCase();
      return kws.some((k) => nm.includes(k));
    }
    const str = String(sec).trim().toLowerCase();
    if (codeSet.has(str)) return true;
    return kws.some((k) => str.includes(k));
  };
  const seenVal = (x) => (x == null ? null : typeof x === 'object' ? JSON.stringify(x) : String(x));
  const universe = list.filter((s) => matchSector(s.sector));
  if (!universe.length) {
    const seen = Array.from(new Set(list.map((s) => seenVal(s.sector)).filter(Boolean))).slice(0, 20);
    return { error: `No stocks matched ${[...codeSet].join('/') || '(none)'}. Sector values present: ${seen.join('  |  ') || '(sector field missing)'}`, results: [], total: 0, sectorsSeen: seen };
  }
  if (onProgress) onProgress(0, universe.length); // show the total right away

  let benchmark = null;
  try { const ic = await getCandles('NEPSE', cookie); if (ic.length >= 60) benchmark = ic; } catch (e) { /* RS optional */ }

  const results = [];
  let done = 0;
  const total = universe.length;
  const CONC = 3;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let idx = 0;
  async function worker() {
    while (idx < universe.length) {
      const mine = universe[idx++];
      let fromCache = true;
      try {
        const cached = await cacheGetCandles(mine.symbol);
        let candles = cached && cached.c && cached.c.length ? cached.c : null;
        if (!candles) { fromCache = false; candles = await getCandles(mine.symbol, cookie); }
        if (candles && candles.length >= 40) {
          const a = analyze(candles, { benchmark });
          if (a) results.push({ symbol: mine.symbol, name: mine.name, sector: mine.sector, a, score: screenScore(a) });
        }
      } catch (e) { /* skip symbol */ }
      done++;
      if (onProgress) onProgress(done, total);
      if (!fromCache) await sleep(200 + Math.random() * 300); // only pause when we actually hit the network
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, universe.length) }, worker));
  results.sort((x, y) => y.score - x.score);
  return { results, total, error: '' };
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
  try { indexCandles = await getCandles('NEPSE', cookie); } catch (e) { /* RS will be null */ }
  const benchmark = indexCandles.length >= 60 ? indexCandles : null;

  const stocks = [];
  for (const w of watchlist) {
    try {
      const candles = await getCandles(w.symbol, cookie);
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
