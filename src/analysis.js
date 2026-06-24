// Pure analysis engine (no UI) — EMA, RSI, swing S/R, pivots, SMC, targets.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

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

  const MINGAP = 0.03; // ignore micro swings closer than ~3% — NEPSE moves in bigger swings (T+2, ~10% band)
  const lowVals = lows.map((i) => data[i].l);
  const highVals = highs.map((i) => data[i].h);
  const recentLo = Math.min(...data.map((d) => d.l));
  const recentHi = Math.max(...data.map((d) => d.h));

  const sigBelow = lowVals.filter((v) => v <= price * (1 - MINGAP));
  const sigAbove = highVals.filter((v) => v >= price * (1 + MINGAP));
  const support = sigBelow.length ? Math.max(...sigBelow) : Math.min(recentLo, price * 0.95);
  const resistance = sigAbove.length
    ? Math.min(...sigAbove)
    : (recentHi >= price * (1 + MINGAP) ? recentHi : price * 1.08);

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

  // ---- Market structure labels: HH / HL / LH / LL ----
  const pts = [
    ...highs.map((i) => ({ i, type: 'H', p: data[i].h })),
    ...lows.map((i) => ({ i, type: 'L', p: data[i].l })),
  ].sort((a, b) => a.i - b.i);
  let lastH = null, lastL = null;
  const swingLabels = [];
  for (const pt of pts) {
    if (pt.type === 'H') { pt.label = lastH == null ? 'H' : pt.p > lastH ? 'HH' : 'LH'; lastH = pt.p; }
    else { pt.label = lastL == null ? 'L' : pt.p > lastL ? 'HL' : 'LL'; lastL = pt.p; }
    swingLabels.push(pt);
  }
  const recentLabels = swingLabels.slice(-3).map((s) => s.label);
  const marketStructure = swingLabels.slice(-4).map((s) => s.label).join(' → ') || '—';
  const bull = swingLabels.slice(-4).filter((s) => s.label === 'HH' || s.label === 'HL').length;
  const bear = swingLabels.slice(-4).filter((s) => s.label === 'LH' || s.label === 'LL').length;
  const structureBias = bull > bear ? 'Bullish' : bear > bull ? 'Bearish' : 'Mixed';

  // Regime: Uptrend / Downtrend / Range / Accumulation / Distribution
  const recent30 = data.slice(-30);
  const rHi = Math.max(...recent30.map((d) => d.h));
  const rLo = Math.min(...recent30.map((d) => d.l));
  const posInRange = (price - rLo) / ((rHi - rLo) || 1);
  const priorTrend = swingLabels.slice(-8, -4);
  const priorBear = priorTrend.filter((s) => s.label === 'LH' || s.label === 'LL').length;
  const priorBull = priorTrend.filter((s) => s.label === 'HH' || s.label === 'HL').length;
  let regime;
  if (bull >= 3) regime = 'Uptrend';
  else if (bear >= 3) regime = 'Downtrend';
  else if (posInRange <= 0.35 && priorBear >= priorBull) regime = 'Accumulation';
  else if (posInRange >= 0.65 && priorBull >= priorBear) regime = 'Distribution';
  else regime = 'Range';
  const structureExplain =
    regime === 'Uptrend' ? 'Higher highs and higher lows — buyers in control.'
    : regime === 'Downtrend' ? 'Lower highs and lower lows — sellers in control.'
    : regime === 'Accumulation' ? 'Basing near the lows after weakness — possible accumulation, not yet confirmed.'
    : regime === 'Distribution' ? 'Stalling near the highs after strength — possible distribution; be cautious.'
    : 'Choppy, overlapping swings — no clear trend; range conditions.';

  // ---- Volume analysis ----
  const vN = Math.min(40, data.length);
  const vRecent = data.slice(-vN);
  const avgVol = mean(data.slice(-vN).map((d) => d.v)) || 1;
  let upVol = 0, dnVol = 0, buyers = 0, sellers = 0;
  vRecent.forEach((d) => { if (d.c >= d.o) { upVol += d.v; buyers++; } else { dnVol += d.v; sellers++; } });
  const buyerPressure = Math.round((upVol / (upVol + dnVol || 1)) * 100);
  const sellerPressure = 100 - buyerPressure;
  const relVol = +(data[data.length - 1].v / avgVol).toFixed(2);
  const volScore = buyerPressure;
  const volLabel = buyerPressure >= 60 ? 'Buyers' : buyerPressure <= 40 ? 'Sellers' : 'Balanced';
  const volumeConfirms =
    (regime === 'Uptrend' || regime === 'Accumulation') ? buyerPressure > 52
    : (regime === 'Downtrend' || regime === 'Distribution') ? sellerPressure > 52
    : Math.abs(buyerPressure - 50) > 8;
  const volumeSummary = `${buyerPressure}% buyer pressure vs ${sellerPressure}% seller pressure over ${vN} days; last bar ${relVol}× average. Volume ${volumeConfirms ? 'confirms' : 'does not confirm'} the ${regime.toLowerCase()}.`;

  // ---- Support / resistance strength (0-100, multi-factor, capped at 97) ----
  const levelStrength = (level, kind) => {
    const tol = 0.02;
    const touchIdx = [...lows, ...highs].filter((i) => Math.abs((kind === 'sup' ? data[i].l : data[i].h) - level) / level <= tol);
    const touches = touchIdx.length;
    const nearVols = data.filter((d) => Math.abs(d.l - level) / level <= tol || Math.abs(d.h - level) / level <= tol).map((d) => d.v);
    const volRatio = nearVols.length ? mean(nearVols) / avgVol : 0;
    let bounce = 0, bn = 0;
    touchIdx.forEach((i) => { const f = data.slice(i + 1, i + 6); if (f.length) { bounce += Math.max(...f.map((d) => Math.abs(d.c - level))) / level; bn++; } });
    const bounceQ = bn ? bounce / bn : 0;
    const span = touchIdx.length >= 2 ? (Math.max(...touchIdx) - Math.min(...touchIdx)) / data.length : 0;
    const sTouch = clamp(touches / 5, 0, 1);
    const sVol = clamp(volRatio / 1.5, 0, 1);
    const sBounce = clamp(bounceQ / 0.08, 0, 1);
    const sSpan = clamp(span, 0, 1);
    const strength = Math.round(clamp((sTouch * 0.4 + sVol * 0.2 + sBounce * 0.25 + sSpan * 0.15) * 100, 0, 97));
    return { price: +level.toFixed(1), strength, touches };
  };
  const supInfo = levelStrength(support, 'sup');
  const resInfo = levelStrength(resistance, 'res');
  const supStrength = supInfo.strength;
  const resStrength = resInfo.strength;
  const supTouches = supInfo.touches;
  const resTouches = resInfo.touches;

  // ---- Backtest (per signal: n, wins, losses, rate, avgReturn, avgDays) ----
  const winRates = backtest(data, 10);

  const eq = (rHi + rLo) / 2;
  const zone = price > eq ? 'Premium' : 'Discount';

  // ---- Swing plan (NEPSE T+2, ~10% band) ----
  const entryLow = support;
  const entryHigh = support * 1.03;
  const entry = support * 1.02;
  const stop = Math.min(support * 0.96, lastSwingLow != null ? lastSwingLow * 0.99 : support * 0.96);
  const t1 = resistance;
  let t2 = resistance + (resistance - support);
  if (t2 < t1 * 1.04) t2 = t1 * 1.06;
  const rr = (t1 - entry) / Math.max(entry - stop, 1e-6);
  const holdNote = 'NEPSE settles T+2 — plan as a multi-day swing, not an intraday trade.';

  let signal = 'HOLD';
  if (price > resistance) signal = 'BREAKOUT';
  else if (price < support) signal = 'BREAKDOWN';
  else {
    const pos = (price - support) / (resistance - support);
    signal = pos <= 0.25 ? 'ACCUMULATE' : pos >= 0.75 ? 'TRIM' : 'HOLD';
  }
  const rsiNow = rsi[rsi.length - 1] ?? 50;
  const e20Now = e20[e20.length - 1];
  const e50Now = e50[e50.length - 1];

  // ---- Bias engine (-100..+100) ----
  const cStruct = structureBias === 'Bullish' ? 30 : structureBias === 'Bearish' ? -30 : 0;
  const cRsi = clamp((rsiNow - 50) / 50, -1, 1) * 20;
  const cEma = e20Now > e50Now ? 18 : -18;
  const cVol = ((buyerPressure - 50) / 50) * 17;
  const cSR = ((supStrength - resStrength) / 100) * 15;
  const biasScore = Math.round(clamp(cStruct + cRsi + cEma + cVol + cSR, -100, 100));
  const bias = biasScore >= 50 ? 'Strong Bullish' : biasScore >= 15 ? 'Bullish' : biasScore > -15 ? 'Neutral' : biasScore > -50 ? 'Bearish' : 'Strong Bearish';
  const biasExplain = `Structure ${structureBias} (${cStruct >= 0 ? '+' : ''}${cStruct}), RSI ${Math.round(rsiNow)} (${cRsi >= 0 ? '+' : ''}${Math.round(cRsi)}), EMA20${e20Now > e50Now ? '>' : '<'}EMA50 (${cEma >= 0 ? '+' : ''}${cEma}), volume (${cVol >= 0 ? '+' : ''}${Math.round(cVol)}), S/R balance (${cSR >= 0 ? '+' : ''}${Math.round(cSR)}).`;

  // ---- Confidence (0-100) ----
  const cur = winRates[signal] || { n: 0 };
  const sSample = clamp(cur.n / 20, 0, 1);
  const sTrendClarity = clamp(Math.abs(biasScore) / 60, 0, 1);
  const sVolConf = volumeConfirms ? 1 : clamp(Math.abs(buyerPressure - 50) / 50, 0, 1);
  const sSRq = clamp((supStrength + resStrength) / 200, 0, 1);
  const dirs = [structureBias === 'Bullish' ? 1 : structureBias === 'Bearish' ? -1 : 0, rsiNow > 55 ? 1 : rsiNow < 45 ? -1 : 0, e20Now > e50Now ? 1 : -1, buyerPressure > 52 ? 1 : buyerPressure < 48 ? -1 : 0];
  const net = dirs.reduce((a, b) => a + b, 0);
  const sAgree = clamp(Math.abs(net) / 4, 0, 1);
  const confidence = Math.round((sSample * 0.3 + sTrendClarity * 0.25 + sVolConf * 0.15 + sSRq * 0.15 + sAgree * 0.15) * 100);
  const confidenceLabel = confidence >= 66 ? 'High' : confidence >= 40 ? 'Moderate' : 'Low';
  const confidenceExplain = `Sample n=${cur.n}, trend clarity ${Math.round(sTrendClarity * 100)}%, volume ${volumeConfirms ? 'confirms' : 'mixed'}, S/R quality ${Math.round(sSRq * 100)}%, ${Math.abs(net)}/4 indicators agree.`;

  // ---- Trade quality (0-100) -> grade ----
  const sRR = clamp(rr / 3, 0, 1);
  const sAlign = (biasScore > 10 && (signal === 'ACCUMULATE' || signal === 'BREAKOUT')) ? 1 : biasScore > 0 ? 0.6 : 0.3;
  const sHist = cur.rate != null ? clamp(cur.rate / 100, 0, 1) * clamp(cur.n / 10, 0.3, 1) : 0.3;
  const tradeQuality = Math.round((sRR * 0.3 + sAlign * 0.2 + (volumeConfirms ? 1 : 0.4) * 0.15 + clamp(supStrength / 100, 0, 1) * 0.15 + sHist * 0.2) * 100);
  const grade = tradeQuality >= 85 ? 'A+' : tradeQuality >= 70 ? 'A' : tradeQuality >= 55 ? 'B' : tradeQuality >= 40 ? 'C' : 'Avoid';

  const summary = `${bias} bias with ${confidenceLabel.toLowerCase()} confidence (${regime}). Support ${supStrength >= 60 ? 'is strong' : supStrength >= 35 ? 'is moderate' : 'is weak'}; volume favours ${buyerPressure >= 52 ? 'buyers' : sellerPressure >= 52 ? 'sellers' : 'neither side'}. ${cur.n ? `Similar past setups: ${cur.wins}/${cur.n} reached T1 first (${cur.rate}%, avg ${cur.avgReturn}% in ~${cur.avgDays}d).` : 'Too few similar past setups to judge odds.'}`;

  const report = {
    bias, biasScore, confidence, confidenceLabel, tradeQuality, grade,
    marketStructure, trend: regime,
    support: { price: supInfo.price, strength: supStrength },
    resistance: { price: resInfo.price, strength: resStrength },
    volume: { buyers, sellers, buyerPressure, sellerPressure, relVol, confirms: volumeConfirms },
    historicalPerformance: { wins: cur.wins || 0, losses: cur.losses || 0, matches: cur.n || 0, unresolved: cur.unresolved || 0, hitRate: cur.rate, ci: cur.ci || null, avgReturn: cur.avgReturn, avgDays: cur.avgDays },
    summary,
  };

  return {
    e20, e50, rsi, highs, lows, support, resistance, PP, R1, S1, R2, S2,
    trend, regime, structure, ob, fvg, eq, zone, entry, entryLow, entryHigh, stop, t1, t2, rr, holdNote, price, signal,
    swingLabels, recentLabels, marketStructure, structureBias, structureExplain,
    volScore, volLabel, buyers, sellers, buyerPressure, sellerPressure, relVol, volumeConfirms, volumeSummary,
    supStrength, resStrength, supTouches, resTouches, supInfo, resInfo,
    winRates, bias, biasScore, biasExplain, confidence, confidenceLabel, confidenceExplain,
    tradeQuality, grade, summary, report,
    rsiNow, e20Now, e50Now,
  };
}

// Rolling backtest: at each past candle, derive the signal from ONLY prior data,
// then look forward `horizon` candles to see if price reached T1 (resistance)
// before SL (support*0.96). In-sample & descriptive — NOT a prediction.
export function backtest(data, horizon = 10) {
  const mk = () => ({ n: 0, w: 0, l: 0, unresolved: 0, retSum: 0, daySum: 0 });
  const tally = {
    ACCUMULATE: mk(), HOLD: mk(), TRIM: mk(), BREAKOUT: mk(), BREAKDOWN: mk(),
  };
  for (let i = 40; i < data.length - 1; i++) {
    const win = data.slice(Math.max(0, i - 119), i + 1);
    const price = win[win.length - 1].c;
    const { highs: H, lows: L } = swings(win, 2);
    const lo = L.map((j) => win[j].l).filter((v) => v <= price * 0.97);
    const hi = H.map((j) => win[j].h).filter((v) => v >= price * 1.03);
    const sup = lo.length ? Math.max(...lo) : Math.min(...win.map((d) => d.l));
    const allHi = Math.max(...win.map((d) => d.h));
    const rst = hi.length ? Math.min(...hi) : (allHi >= price * 1.03 ? allHi : price * 1.08);
    let sig = 'HOLD';
    if (price > rst) sig = 'BREAKOUT';
    else if (price < sup) sig = 'BREAKDOWN';
    else { const pos = (price - sup) / (rst - sup || 1); sig = pos <= 0.25 ? 'ACCUMULATE' : pos >= 0.75 ? 'TRIM' : 'HOLD'; }
    const t1 = rst, sl = sup * 0.96;
    let outcome = null, days = 0;
    for (let k = i + 1; k <= Math.min(data.length - 1, i + horizon); k++) {
      days = k - i;
      if (data[k].h >= t1) { outcome = 'win'; break; }
      if (data[k].l <= sl) { outcome = 'loss'; break; }
    }
    if (outcome) {
      const t = tally[sig];
      t.n++;
      if (outcome === 'win') { t.w++; t.retSum += ((t1 - price) / price) * 100; t.daySum += days; }
      else { t.l++; t.retSum += ((sl - price) / price) * 100; t.daySum += days; }
    } else {
      tally[sig].unresolved++;
    }
  }
  const out = {};
  for (const k of Object.keys(tally)) {
    const t = tally[k];
    out[k] = t.n
      ? { n: t.n, wins: t.w, losses: t.l, unresolved: t.unresolved, rate: Math.round((t.w / t.n) * 100), avgReturn: +(t.retSum / t.n).toFixed(1), avgDays: +(t.daySum / t.n).toFixed(1), ci: wilson(t.w, t.n) }
      : { n: 0, wins: 0, losses: 0, unresolved: t.unresolved, rate: null, avgReturn: null, avgDays: null, ci: null };
  }
  return out;
}

// Wilson 95% score interval for a win-rate — honest uncertainty band for small n.
export function wilson(wins, n, z = 1.96) {
  if (!n) return null;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.round(Math.max(0, center - margin) * 100), high: Math.round(Math.min(1, center + margin) * 100) };
}
