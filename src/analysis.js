// Pure analysis engine (no UI) — EMA, RSI, swing S/R, pivots, SMC, targets.
export const emaArr = (vals, p) => {
  const k = 2 / (p + 1);
  let prev;
  return vals.map((v, i) => (prev = i === 0 ? v : v * k + prev * (1 - k)));
};

export function rsiArr(closes, p = 14) {
  const out = Array(closes.length).fill(null);
  let g = 0, l = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= p) {
      g += up; l += dn;
      if (i === p) { g /= p; l /= p; out[i] = 100 - 100 / (1 + g / (l || 1e-9)); }
    } else {
      g = (g * (p - 1) + up) / p;
      l = (l * (p - 1) + dn) / p;
      out[i] = 100 - 100 / (1 + g / (l || 1e-9));
    }
  }
  return out;
}

export function swings(data, k = 2) {
  const highs = [], lows = [];
  for (let i = k; i < data.length - k; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= k; j++) {
      if (data[i].h <= data[i - j].h || data[i].h <= data[i + j].h) isH = false;
      if (data[i].l >= data[i - j].l || data[i].l >= data[i + j].l) isL = false;
    }
    if (isH) highs.push(i);
    if (isL) lows.push(i);
  }
  return { highs, lows };
}

export function analyze(data) {
  if (!data || data.length < 20) return null;
  const closes = data.map((d) => d.c);
  const e20 = emaArr(closes, 20);
  const e50 = emaArr(closes, 50);
  const rsi = rsiArr(closes, 14);
  const { highs, lows } = swings(data, 2);
  const last = data[data.length - 1];
  const price = last.c;

  const lowVals = lows.map((i) => data[i].l);
  const highVals = highs.map((i) => data[i].h);
  const belowLows = lowVals.filter((v) => v < price);
  const aboveHighs = highVals.filter((v) => v > price);
  const support = belowLows.length ? Math.max(...belowLows) : Math.min(...data.map((d) => d.l));
  const resistance = aboveHighs.length ? Math.min(...aboveHighs) : Math.max(...data.map((d) => d.h));

  const PP = (last.h + last.l + last.c) / 3;
  const R1 = 2 * PP - last.l, S1 = 2 * PP - last.h;
  const R2 = PP + (last.h - last.l), S2 = PP - (last.h - last.l);

  const lh = highs.slice(-2), ll = lows.slice(-2);
  let trend = "Range";
  if (lh.length === 2 && ll.length === 2) {
    const hh = data[lh[1]].h > data[lh[0]].h;
    const hl = data[ll[1]].l > data[ll[0]].l;
    if (hh && hl) trend = "Uptrend";
    else if (!hh && !hl) trend = "Downtrend";
  }
  const lastSwingHigh = highs.length ? data[highs[highs.length - 1]].h : null;
  const lastSwingLow = lows.length ? data[lows[lows.length - 1]].l : null;
  let structure = "—";
  if (lastSwingHigh && price > lastSwingHigh)
    structure = trend === "Downtrend" ? "CHoCH up" : "BOS up";
  else if (lastSwingLow && price < lastSwingLow)
    structure = trend === "Uptrend" ? "CHoCH down" : "BOS down";

  let ob = null;
  const brkIdx = highs.length ? highs[highs.length - 1] : data.length - 6;
  for (let i = brkIdx; i >= Math.max(1, brkIdx - 8); i--) {
    if (data[i].c < data[i].o) { ob = { from: i, top: data[i].h, bot: data[i].l }; break; }
  }
  let fvg = null;
  for (let i = data.length - 2; i >= 2; i--) {
    if (data[i - 1].h < data[i + 1].l) { fvg = { from: i - 1, to: i + 1, bot: data[i - 1].h, top: data[i + 1].l }; break; }
  }

  const recent = data.slice(-30);
  const rangeHi = Math.max(...recent.map((d) => d.h));
  const rangeLo = Math.min(...recent.map((d) => d.l));
  const eq = (rangeHi + rangeLo) / 2;
  const zone = price > eq ? "Premium" : "Discount";

  const entry = price;
  const stop = Math.min(support * 0.985, lastSwingLow != null ? lastSwingLow : support * 0.985);
  const t1 = resistance;
  const t2 = resistance + (resistance - support);
  const rr = (t1 - entry) / Math.max(entry - stop, 1e-6);

  let signal = "HOLD";
  if (price > resistance) signal = "BREAKOUT";
  else if (price < support) signal = "BREAKDOWN";
  else {
    const pos = (price - support) / (resistance - support);
    signal = pos <= 0.25 ? "ACCUMULATE" : pos >= 0.75 ? "TRIM" : "HOLD";
  }

  return {
    e20, e50, rsi, highs, lows, support, resistance, PP, R1, S1, R2, S2,
    trend, structure, ob, fvg, eq, zone, entry, stop, t1, t2, rr, price, signal,
    rsiNow: rsi[rsi.length - 1], e20Now: e20[e20.length - 1], e50Now: e50[e50.length - 1],
  };
}
