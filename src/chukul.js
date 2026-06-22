// Chukul (login-gated) data client — personal use. Sends your chk-session
// cookie (stored on-device) as a Cookie header. RN has no CORS, so this works.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_COOKIE = 'chukul.session';
export const STOCK_LIST_URL = 'https://chukul.com/api/stock/';
export const CANDLE_BASE = 'https://live.chukul.com/api/data/adjhistorydata/data/';

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
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ i, o: +o[i], h: +h[i], l: +l[i], c: +c[i], v: +(vol[i] || 0), t: +(t[i] || 0) });
  }
  return out;
}
