// Live signal journal — the ONLY honest accuracy. Logs each watchlist signal
// once per trading day, then scores its real forward outcome as new candles
// arrive (win = T1 before SL, loss = SL before T1, timeout = neither in 10 days).
import AsyncStorage from '@react-native-async-storage/async-storage';

const JKEY = 'journal.v1';
const HORIZON = 10;

export async function loadJournal() {
  try { const v = await AsyncStorage.getItem(JKEY); return v ? JSON.parse(v) : []; }
  catch { return []; }
}
export async function saveJournal(list) {
  try { await AsyncStorage.setItem(JKEY, JSON.stringify(list.slice(-3000))); } catch (e) { /* ignore */ }
}
export async function clearJournal() {
  try { await AsyncStorage.removeItem(JKEY); } catch (e) { /* ignore */ }
}

// Record the current signal for a symbol, once per candle-day. Mutates `list`.
export function recordInto(list, symbol, a, t0) {
  if (!a || !t0 || !isFinite(a.price)) return false;
  const id = `${symbol}:${Math.floor(t0 / 86400)}`;
  if (list.some((e) => e.id === id)) return false;
  list.push({
    id, symbol, t0, signal: a.signal,
    entry: a.price, stop: a.stop, t1: a.t1,
    status: 'open', created: Date.now(),
  });
  return true;
}

// Resolve any open entries for `symbol` against its candles. Mutates `list`.
export function evaluateInto(list, symbol, candles, horizon = HORIZON) {
  let changed = false;
  for (const e of list) {
    if (e.symbol !== symbol || e.status !== 'open') continue;
    const fut = candles.filter((c) => c.t > e.t0).sort((x, y) => x.t - y.t);
    if (!fut.length) continue;
    let res = null, days = 0, exit = null;
    for (let k = 0; k < fut.length; k++) {
      days = k + 1;
      if (fut[k].h >= e.t1) { res = 'win'; exit = e.t1; break; }
      if (fut[k].l <= e.stop) { res = 'loss'; exit = e.stop; break; }
      if (days >= horizon) { res = 'timeout'; exit = fut[k].c; break; }
    }
    if (res) {
      e.status = res;
      e.days = days;
      e.returnPct = +(((exit - e.entry) / e.entry) * 100).toFixed(2);
      changed = true;
    }
  }
  return changed;
}

// Aggregate resolved entries into a real, forward track record.
export function liveStats(list, signalFilter) {
  const resolved = list.filter((e) => e.status && e.status !== 'open' && (!signalFilter || e.signal === signalFilter));
  const n = resolved.length;
  if (!n) return { n: 0, open: list.filter((e) => e.status === 'open').length };
  const wins = resolved.filter((e) => e.status === 'win').length;
  const losses = resolved.filter((e) => e.status === 'loss').length;
  const timeouts = resolved.filter((e) => e.status === 'timeout').length;
  const rets = resolved.map((e) => e.returnPct || 0);
  const grossW = rets.filter((x) => x > 0).reduce((a, b) => a + b, 0);
  const grossL = rets.filter((x) => x < 0).reduce((a, b) => a + b, 0);
  const expectancy = +(rets.reduce((a, b) => a + b, 0) / n).toFixed(2);
  const pf = grossL !== 0 ? +Math.abs(grossW / grossL).toFixed(2) : (grossW > 0 ? null : 0);
  const decided = wins + losses;
  const hitRate = decided ? Math.round((wins / decided) * 100) : null;
  const since = new Date(Math.min(...resolved.map((e) => e.created || Date.now()))).toISOString().slice(0, 10);
  return { n, wins, losses, timeouts, hitRate, expectancy, pf, since, open: list.filter((e) => e.status === 'open').length };
}
