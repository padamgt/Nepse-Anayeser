import AsyncStorage from '@react-native-async-storage/async-storage';

// Local cache of EOD daily candles so the app reads from storage instead of
// hitting Chukul on every screen/scan. Candles only change once a day after
// market close, so a manual daily Sync is enough.

const PRE = 'cache.candles.';
const META = 'cache.meta.v1';

export async function cacheSetCandles(symbol, candles) {
  try { await AsyncStorage.setItem(PRE + String(symbol).toUpperCase(), JSON.stringify({ at: Date.now(), c: candles })); } catch (e) { /* ignore */ }
}
export async function cacheGetCandles(symbol) {
  try { const s = await AsyncStorage.getItem(PRE + String(symbol).toUpperCase()); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}
export async function getSyncMeta() {
  try { const s = await AsyncStorage.getItem(META); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}
export async function setSyncMeta(m) {
  try { await AsyncStorage.setItem(META, JSON.stringify(m)); } catch (e) { /* ignore */ }
}

// "Synced today" — true if the last sync happened on the current calendar day.
export function syncedToday(at) {
  if (!at) return false;
  return new Date(at).toDateString() === new Date().toDateString();
}

// Remove every cached candle entry (keeps cookie/watchlist/screen prefs).
export async function clearCandleCache() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(PRE));
    if (mine.length) await AsyncStorage.multiRemove(mine);
    await AsyncStorage.removeItem(META);
    return mine.length;
  } catch (e) { return 0; }
}

export async function cachedSymbolCount() {
  try { return (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PRE)).length; } catch (e) { return 0; }
}

// List of symbols currently in the cache (so a sync can refresh what you've used).
export async function cachedSymbols() {
  try { return (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PRE)).map((k) => k.slice(PRE.length)); } catch (e) { return []; }
}
