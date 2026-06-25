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

// Average True Range (Wilder). Returns array aligned to data.
export function atrArr(data, p = 14) {
  const tr = data.map((d, i) => i === 0 ? d.h - d.l : Math.max(d.h - d.l, Math.abs(d.h - data[i - 1].c), Math.abs(d.l - data[i - 1].c)));
  const out = Array(data.length).fill(null);
  let a = 0;
  for (let i = 0; i < tr.length; i++) {
    if (i < p) { a += tr[i]; if (i === p - 1) out[i] = a / p; }
    else out[i] = (out[i - 1] * (p - 1) + tr[i]) / p;
  }
  return out;
}

// Round-trip transaction cost model for NEPSE (broker commission + SEBON/DP + slippage).
// Conservative blended estimate applied to every backtested trade so expectancy is NET.
export const NEPSE_COST_PCT = 0.9; // ~0.6% round-trip commission/fees + ~0.3% slippage

export function analyze(data, opts = {}) {
  if (!data || data.length < 20) return null;
  const benchmark = opts.benchmark || null; // optional index candles for relative strength
  const closes = data.map((d) => d.c);
  const e20 = emaArr(closes, 20);
  const e50 = emaArr(closes, 50);
  const rsi = rsiArr(closes, 14);
  const atr = atrArr(data, 14);
  const { highs, lows } = swings(data, 2);
  const last = data[data.length - 1];
  const price = last.c;

  // Volatility (ATR as % of price) — used to make thresholds adaptive instead of hard-coded.
  const atrNow = atr[atr.length - 1] || (price * 0.02);
  const atrPct = clamp(atrNow / price, 0.005, 0.2);
  // touch tolerance scales with volatility (floor 1.5%); fixes the hard-coded 2% flaw
  const TOL = Math.max(0.015, atrPct * 1.0);

  // ---- Liquidity / turnover (NEPSE illiquidity filter) ----
  const turn = data.slice(-30).map((d) => d.c * d.v);
  const avgTurnover = turn.length ? turn.reduce((s, x) => s + x, 0) / turn.length : 0;
  const liquidity =
    avgTurnover >= 10e6 ? 'Liquid'
    : avgTurnover >= 3e6 ? 'Moderate'
    : avgTurnover >= 1e6 ? 'Thin'
    : 'Illiquid';
  const liquidityNote =
    liquidity === 'Liquid' ? 'Healthy daily turnover — levels and stops are tradeable.'
    : liquidity === 'Moderate' ? 'Moderate turnover — expect some slippage on size.'
    : liquidity === 'Thin' ? 'Thin turnover — stops may slip and fills are uncertain.'
    : 'Very low turnover — signals are unreliable and exits may be hard to fill.';

  // ---- Relative strength vs benchmark (index) ----
  let relStrength = null, rsRising = null;
  if (benchmark && benchmark.length >= 60) {
    const bC = benchmark.map((d) => d.c);
    const look = 60;
    const stkRet = price / closes[Math.max(0, closes.length - look)] - 1;
    const bmRet = bC[bC.length - 1] / bC[Math.max(0, bC.length - look)] - 1;
    relStrength = +((stkRet - bmRet) * 100).toFixed(1); // outperformance in pp over ~60 bars
    const look2 = 20;
    const stk2 = price / closes[Math.max(0, closes.length - look2)] - 1;
    const bm2 = bC[bC.length - 1] / bC[Math.max(0, bC.length - look2)] - 1;
    rsRising = (stk2 - bm2) > (stkRet - bmRet) / (look / look2);
  }

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

  const recent30 = data.slice(-30);
  const rHi = Math.max(...recent30.map((d) => d.h));
  const rLo = Math.min(...recent30.map((d) => d.l));
  const posInRange = (price - rLo) / ((rHi - rLo) || 1);

  // NOTE: EMA values needed for trend classification are computed just below in
  // the original code (e20Now/e50Now/rsiNow). We compute slopes here from arrays.
  const e20N = e20[e20.length - 1], e50N = e50[e50.length - 1];
  const e50slope = e50.length > 11 && e50[e50.length - 11] ? (e50N - e50[e50.length - 11]) / e50[e50.length - 11] : 0;
  const e20slope = e20.length > 6 && e20[e20.length - 6] ? (e20N - e20[e20.length - 6]) / e20[e20.length - 6] : 0;
  const emaUp = e20N > e50N;
  const aboveE50 = price > e50N;

  // ---- PRIMARY TREND (slow truth: EMA structure + slope + price location) ----
  // Slope thresholds scale with volatility (atrPct) instead of fixed 0.3%/3% constants.
  const slopeStrong = atrPct * 1.5;
  const slopeMild = atrPct * 0.2;
  let primaryTrend;
  if (emaUp && aboveE50 && e50slope > slopeStrong) primaryTrend = 'Strong Uptrend';
  else if (emaUp && e50slope > slopeMild) primaryTrend = 'Uptrend';
  else if (!emaUp && !aboveE50 && e50slope < -slopeStrong) primaryTrend = 'Strong Downtrend';
  else if (!emaUp && e50slope < -slopeMild) primaryTrend = 'Downtrend';
  else primaryTrend = 'Sideways';

  // ---- WEEKLY (multi-timeframe) trend: resample ~5 daily bars -> 1 weekly ----
  const weekly = [];
  for (let i = 0; i < data.length; i += 5) {
    const chunk = data.slice(i, i + 5);
    if (!chunk.length) continue;
    weekly.push({ o: chunk[0].o, h: Math.max(...chunk.map((d) => d.h)), l: Math.min(...chunk.map((d) => d.l)), c: chunk[chunk.length - 1].c, v: chunk.reduce((s, d) => s + d.v, 0), t: chunk[0].t });
  }
  let weeklyTrend = 'Sideways';
  if (weekly.length >= 12) {
    const wC = weekly.map((d) => d.c);
    const we10 = emaArr(wC, 10), we20 = emaArr(wC, 20);
    const a = we10[we10.length - 1], b = we20[we20.length - 1];
    const wSlope = we20.length > 5 && we20[we20.length - 5] ? (b - we20[we20.length - 5]) / we20[we20.length - 5] : 0;
    weeklyTrend = a > b && wSlope > 0 ? 'Uptrend' : a < b && wSlope < 0 ? 'Downtrend' : 'Sideways';
  }
  const mtfAligned = weeklyTrend === 'Uptrend' || (weeklyTrend === 'Sideways' && primaryTrend.includes('Up'));

  // ---- CURRENT STATE (fast micro-structure from the most RECENT swings) ----
  const seq = swingLabels.slice(-5).map((s) => s.label);
  const lastSw = seq[seq.length - 1];
  const had = (arr, set) => arr.some((x) => set.includes(x));
  const earlier = seq.slice(0, -1);
  let currentState;
  if (price > resistance) currentState = 'Breakout';
  else if (price < support) currentState = 'Breakdown';
  else if (lastSw === 'HH' && had(earlier, ['LL', 'LH'])) currentState = 'Reversal attempt (up)';
  else if (lastSw === 'LL' && had(earlier, ['HH', 'HL'])) currentState = 'Rollover (down)';
  else if (lastSw === 'HL' && had(earlier, ['LH', 'LL'])) currentState = 'Base forming';
  else if (lastSw === 'LH' && had(earlier, ['HH', 'HL'])) currentState = 'Topping';
  else if (had(seq.slice(-2), ['HH']) && had(seq.slice(-2), ['HL'])) currentState = 'Uptrend continuation';
  else if (had(seq.slice(-2), ['LH']) && had(seq.slice(-2), ['LL'])) currentState = 'Downtrend continuation';
  else currentState = 'Range';
  // Hysteresis: the swing that defines the state must be confirmed (k=2 bars already passed)
  // AND not based purely on the single newest pivot. Flag low-confidence transitions.
  const lastSwingBar = swingLabels.length ? swingLabels[swingLabels.length - 1].i : 0;
  const barsSinceSwing = (data.length - 1) - lastSwingBar;
  const stateConfirmed = barsSinceSwing >= 2 || /continuation|Breakout|Breakdown/.test(currentState);
  if (!stateConfirmed && /Reversal attempt|Rollover|Base forming|Topping/.test(currentState)) {
    currentState = currentState + ' (forming)';
  }
  const csBase = currentState.replace(' (forming)', '');

  // ---- MOMENTUM (price-based ONLY — decoupled from RSI/volume to avoid double-counting) ----
  const rocLook = Math.min(10, closes.length - 1);
  const roc = rocLook > 0 ? (price / closes[closes.length - 1 - rocLook] - 1) : 0;
  const pVsE20 = price > e20N ? 1 : -1;
  const mScore = (roc > atrPct ? 1 : roc < -atrPct ? -1 : 0) + (e20slope > 0 ? 1 : -1) + pVsE20;
  const momentum = mScore >= 2 ? 'Rising' : mScore <= -2 ? 'Falling' : 'Flat';

  // ---- Compat regime bucket (drives Accumulation/Distribution downstream logic) ----
  let regime;
  if (primaryTrend.includes('Uptrend')) regime = 'Uptrend';
  else if (primaryTrend.includes('Downtrend')) regime = 'Downtrend';
  else if (csBase === 'Base forming' || (posInRange <= 0.4 && momentum !== 'Falling')) regime = 'Accumulation';
  else if (csBase === 'Topping' || (posInRange >= 0.6 && momentum === 'Falling')) regime = 'Distribution';
  else regime = 'Range';

  // Combined human label, e.g. "Downtrend · Reversal attempt (up)"
  const trendState = primaryTrend === 'Sideways' && csBase === 'Range' ? 'Range' : `${primaryTrend} · ${currentState}`;
  const structureExplain =
    csBase === 'Reversal attempt (up)' ? `Primary trend is ${primaryTrend.toLowerCase()}, but the latest swing printed a higher high — an early reversal attempt. Not a confirmed uptrend yet.`
    : csBase === 'Rollover (down)' ? `Primary trend is ${primaryTrend.toLowerCase()}, but price just made a lower low after higher highs — momentum is rolling over.`
    : csBase === 'Base forming' ? `A higher low is forming after lower highs — a base may be building. Needs a higher high to confirm.`
    : csBase === 'Topping' ? `A lower high after higher highs — buyers are losing control near the top.`
    : csBase === 'Uptrend continuation' ? 'Higher highs and higher lows — buyers in control.'
    : csBase === 'Downtrend continuation' ? 'Lower highs and lower lows — sellers in control.'
    : csBase === 'Breakout' ? 'Price has pushed above the prior resistance.'
    : csBase === 'Breakdown' ? 'Price has broken below the prior support.'
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
    const tol = TOL;
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

  // ---- Swing plan (NEPSE T+2) — ATR-based stop instead of fixed support×0.96 ----
  const entryLow = support;
  const entryHigh = support * (1 + Math.max(0.02, atrPct));
  const entry = support * (1 + Math.max(0.01, atrPct * 0.5));
  // Stop is the TIGHTER-justified of: structure break, or ATR-distance from entry.
  const atrStop = entry - 1.5 * atrNow;
  const structStop = Math.min(support * 0.96, lastSwingLow != null ? lastSwingLow * 0.99 : support * 0.96);
  const stop = Math.min(atrStop, structStop); // whichever gives the trade room, but capped by structure
  const t1 = resistance;
  let t2 = resistance + (resistance - support);
  if (t2 < t1 * 1.04) t2 = t1 * 1.06;
  const rr = (t1 - entry) / Math.max(entry - stop, 1e-6);
  const holdNote = 'NEPSE settles T+2 — plan as a multi-day swing, not an intraday trade.';
  // Position sizing: risk 1% of capital per trade → shares = (capital×1%) / riskPerShare
  const riskPerShare = +(entry - stop).toFixed(2);
  const riskPlan = {
    entry: +entry.toFixed(1), stop: +stop.toFixed(1), t1: +t1.toFixed(1), t2: +t2.toFixed(1),
    riskPerShare, riskPct: +((riskPerShare / entry) * 100).toFixed(1),
    atr: +atrNow.toFixed(1), atrPct: +(atrPct * 100).toFixed(1),
    sharesPer100k: riskPerShare > 0 ? Math.floor((100000 * 0.01) / riskPerShare) : 0,
  };

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
  const biasBreakdown = [
    { k: 'Trend / Structure', v: cStruct },
    { k: 'RSI', v: Math.round(cRsi) },
    { k: 'EMA 20 vs 50', v: cEma },
    { k: 'Volume', v: Math.round(cVol) },
    { k: 'Support vs Resistance', v: Math.round(cSR) },
  ];
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
  let confidence = Math.round((sSample * 0.3 + sTrendClarity * 0.25 + sVolConf * 0.15 + sSRq * 0.15 + sAgree * 0.15) * 100);
  // HARD GATES (fix: a read can no longer be "High" on a tiny sample or illiquid name)
  let confidenceCapNote = '';
  if (cur.n < 10) { confidence = Math.min(confidence, 35); confidenceCapNote = `Capped — only ${cur.n} past matches; not enough to be confident.`; }
  if (liquidity === 'Illiquid' || liquidity === 'Thin') { confidence = Math.min(confidence, 45); confidenceCapNote = (confidenceCapNote ? confidenceCapNote + ' ' : '') + 'Capped for low liquidity.'; }
  const confidenceLabel = confidence >= 66 ? 'High' : confidence >= 40 ? 'Moderate' : 'Low';
  const confidenceExplain = `Sample n=${cur.n}, trend clarity ${Math.round(sTrendClarity * 100)}%, volume ${volumeConfirms ? 'confirms' : 'mixed'}, S/R quality ${Math.round(sSRq * 100)}%, ${Math.abs(net)}/4 indicators agree.${confidenceCapNote ? ' ' + confidenceCapNote : ''}`;

  // ---- Reversal confirmation (does current price confirm a turn up?) ----
  const lastLH = (() => { const lh = swingLabels.filter((s) => s.label === 'LH'); return lh.length ? lh[lh.length - 1].p : resistance; })();
  const reversalConfirmed = price > e50Now && /up/.test(structure);
  const supConfirmed = supTouches >= 2;
  const resConfirmed = resTouches >= 2;
  const strengthWord = (strength, touches) => touches === 0 ? 'Not confirmed' : strength >= 75 ? 'Very strong' : strength >= 55 ? 'Strong' : strength >= 35 ? 'Moderate' : strength >= 15 ? 'Weak' : 'Very weak';
  const supWord = strengthWord(supStrength, supTouches);
  const resWord = strengthWord(resStrength, resTouches);

  // ---- Three separate axes ----
  // 1) Historical edge (backward, about the pattern class)
  const histEdge =
    (cur.n >= 20 && (cur.profitFactor || 0) >= 1.6 && cur.expectancy > 0) ? 'Strong'
    : (cur.n >= 12 && (cur.profitFactor || 0) >= 1.2 && cur.expectancy > 0) ? 'Moderate'
    : (cur.n >= 12 && cur.expectancy > 0) ? 'Slight'
    : (cur.n < 12) ? 'Unproven' : 'Weak';
  // 2) Current technical condition (present state)
  const currentCondition = biasScore >= 15 ? 'Bullish' : biasScore <= -15 ? 'Bearish' : 'Neutral';

  // ---- Trade quality: transparent additive breakdown (sums to total) ----
  const edgeReliable = clamp(cur.n / 20, 0, 1);
  const pfScore = cur.profitFactor == null ? 0.5 : clamp((cur.profitFactor - 0.8) / 1.2, 0, 1);
  const edgeScore = (cur.expectancy > 0 ? pfScore : 0) * edgeReliable;
  const qualityBreakdown = [
    { k: 'Risk / Reward', v: Math.round(clamp(rr / 3, 0, 1) * 25), max: 25 },
    { k: 'Trend alignment', v: Math.round(clamp((biasScore + 100) / 200, 0, 1) * 20), max: 20 },
    { k: 'Volume support', v: Math.round(clamp(buyerPressure / 100, 0, 1) * 15), max: 15 },
    { k: 'Support quality', v: Math.round(clamp(supStrength / 100, 0, 1) * 15), max: 15 },
    { k: 'Historical edge', v: Math.round(edgeScore * 15), max: 15 },
    { k: 'Reversal confirmed', v: reversalConfirmed ? 10 : (regime === 'Accumulation' ? 3 : 0), max: 10 },
  ];
  let tradeQuality = qualityBreakdown.reduce((s, x) => s + x.v, 0);
  // Consistency rule: a still-bearish, unconfirmed setup can't be graded a good trade.
  let qualityCapNote = '';
  if (currentCondition === 'Bearish' && !reversalConfirmed && tradeQuality > 60) {
    tradeQuality = 60;
    qualityCapNote = 'Capped at 60: trend is still bearish and no reversal is confirmed, regardless of historical edge.';
  }
  const grade = tradeQuality >= 85 ? 'A+' : tradeQuality >= 70 ? 'A' : tradeQuality >= 55 ? 'B' : tradeQuality >= 40 ? 'C' : 'Avoid';

  // ---- Action engine (trend-hierarchy aware, with consistency) ----
  const aboveEMA50 = price > e50Now;
  const negEdge = cur.expectancy < 0 && cur.n >= 10 && (cur.profitFactor || 0) < 0.8;
  const reversalUp = currentState === 'Reversal attempt (up)' || currentState === 'Base forming' || currentState === 'Breakout';
  const downState = currentState === 'Downtrend continuation' || currentState === 'Rollover (down)' || currentState === 'Breakdown';
  const reasons = [
    { ok: cur.expectancy > 0 && cur.n >= 12, text: cur.n >= 12 ? `Historical edge ${cur.expectancy > 0 ? 'positive' : 'negative'} (PF ${cur.profitFactor ?? '—'}, ${cur.expectancy > 0 ? '+' : ''}${cur.expectancy}%)` : `Historical edge unproven (only ${cur.n} matches)` },
    { ok: primaryTrend.includes('Uptrend'), text: `Primary trend: ${primaryTrend}` },
    { ok: reversalUp, text: `Current state: ${currentState}` },
    { ok: momentum === 'Rising', text: `Momentum ${momentum.toLowerCase()}` },
    { ok: buyerPressure >= 50, text: buyerPressure >= 50 ? 'Buyer pressure dominant' : 'Seller pressure dominant' },
    { ok: aboveEMA50, text: aboveEMA50 ? 'Above EMA50' : 'Below EMA50' },
    { ok: reversalConfirmed, text: reversalConfirmed ? 'Reversal confirmed' : 'Reversal not confirmed' },
    { ok: rr >= 2, text: `Risk:Reward 1:${rr.toFixed(1)}` },
    { ok: weeklyTrend === 'Uptrend', text: `Weekly trend: ${weeklyTrend}` },
    { ok: liquidity === 'Liquid' || liquidity === 'Moderate', text: `Liquidity: ${liquidity}` },
    ...(relStrength != null ? [{ ok: relStrength > 0, text: `Relative strength vs index ${relStrength > 0 ? '+' : ''}${relStrength}pp` }] : []),
  ];

  let action;
  if (primaryTrend.includes('Uptrend') && reversalConfirmed && tradeQuality >= 70 && rr >= 2 && biasScore >= 40 && !negEdge) action = 'Strong Buy';
  else if ((primaryTrend.includes('Uptrend') || reversalUp) && reversalConfirmed && tradeQuality >= 55 && rr >= 1.5 && biasScore >= 15 && !negEdge) action = 'Buy';
  else if ((reversalUp || regime === 'Accumulation' || histEdge === 'Strong' || histEdge === 'Moderate') && !reversalConfirmed) action = 'Watch';
  else if (primaryTrend.includes('Uptrend') && currentState === 'Uptrend continuation') action = 'Hold';
  else if (downState && !reversalUp) action = 'Avoid';
  else if (Math.abs(biasScore) < 15) action = 'Watch';
  else action = 'Avoid';
  // consistency guards
  if (biasScore < 0 && (action === 'Buy' || action === 'Strong Buy')) action = 'Watch';        // never buy a negative-bias tape
  if (primaryTrend.includes('Downtrend') && !reversalUp && (action === 'Buy' || action === 'Strong Buy')) action = 'Watch';
  if (negEdge && (action === 'Buy' || action === 'Strong Buy')) action = 'Watch';               // negative proven edge → no fresh buy
  // MTF gate: don't issue a fresh Buy against a weekly downtrend
  if (weeklyTrend === 'Downtrend' && (action === 'Buy' || action === 'Strong Buy')) action = 'Watch';
  // Liquidity gate: illiquid names are not actionable as buys
  if (liquidity === 'Illiquid' && (action === 'Buy' || action === 'Strong Buy')) action = 'Watch';

  // ---- Walk-forward: does the edge survive out-of-sample? ----
  const wf = walkForward(data, signal, 10);

  // ---- Trigger builder: ALWAYS directionally valid vs current price ----
  const buildTrigger = () => {
    if (action === 'Strong Buy' || action === 'Buy') return { met: true, type: 'manage', text: `Entry valid now · manage stop below ${Math.round(stop)}` };
    if (action === 'Avoid') return { met: false, type: 'none', text: 'No long trigger — wait for a higher low to form and hold' };
    // Watch / Hold: find the next UNMET confirmation level above price
    if (!aboveEMA50 && e50Now > price) return { met: false, type: 'trend', text: `Close above EMA50 (${Math.round(e50Now)}) to confirm trend` };
    if (resistance > price) return { met: false, type: 'breakout', text: `Close above resistance ${Math.round(resistance)} on rising volume` };
    // price already above EMA50 and resistance → confirmation already happened; await retest
    return { met: true, type: 'retest', text: `Breakout in progress — wait for pullback into ${Math.round(entryLow)}–${Math.round(entryHigh)} and hold` };
  };
  const trig = buildTrigger();
  const action_obj = { label: action, reasons, trigger: trig.text, triggerMet: trig.met, triggerType: trig.type };

  const reconcile = `These three answer different questions and can disagree:\n• Historical edge (${histEdge}) — how this setup TYPE paid in the past.\n• Current condition (${currentCondition}) — what price is doing NOW.\n• Trade quality (${tradeQuality}/100) — whether entering HERE, today, is good timing.\nA strong past edge with a still-bearish, unconfirmed tape = wait for the trigger, don't buy weakness.`;

  const summary = `Historical edge ${histEdge}, current trend ${currentCondition}, trade quality ${grade}. ${regime === 'Accumulation' && currentCondition === 'Bearish' ? 'Accumulation is forming inside a still-bearish trend — reversal not yet confirmed. ' : ''}${cur.n ? `Past ${signal} setups: ${cur.wins}/${cur.n} hit T1 first (${cur.rate}%), expectancy ${cur.expectancy > 0 ? '+' : ''}${cur.expectancy}%.` : 'Too few past setups to judge odds.'}`;

  const dataCaveats = [
    'Backtest is on adjusted prices — dividend/split adjustments can leak hindsight into past bars, flattering results.',
    'Delisted/merged companies are excluded, so history is survivor-biased (failures are missing).',
    'Returns are net of an estimated ' + NEPSE_COST_PCT + '% round-trip cost; real fills on thin names may be worse.',
    'Sample sizes are small; treat every win-rate as a wide range, not a point estimate.',
  ];

  const report = {
    bias, biasScore, biasBreakdown, confidence, confidenceLabel, confidenceCapNote, tradeQuality, grade, qualityBreakdown, qualityCapNote,
    historicalEdge: histEdge, currentCondition, reversalConfirmed, reconcile,
    action: action_obj,
    primaryTrend, currentState, momentum, trendState, weeklyTrend, mtfAligned,
    liquidity, liquidityNote, avgTurnover: Math.round(avgTurnover),
    relStrength, rsRising,
    riskPlan,
    walkForward: { inSampleExp: wf.inSample.expectancy, inSampleN: wf.inSample.n, oosExp: wf.outSample.expectancy, oosN: wf.outSample.n, verdict: wf.verdict },
    byRegime: cur.byRegime || null,
    dataCaveats,
    marketStructure, trend: regime,
    support: { price: supInfo.price, strength: supStrength, touches: supTouches, label: supWord, confirmed: supConfirmed },
    resistance: { price: resInfo.price, strength: resStrength, touches: resTouches, label: resWord, confirmed: resConfirmed },
    volume: { buyers, sellers, buyerPressure, sellerPressure, relVol, confirms: volumeConfirms },
    historicalPerformance: { wins: cur.wins || 0, losses: cur.losses || 0, matches: cur.n || 0, unresolved: cur.unresolved || 0, hitRate: cur.rate, ci: cur.ci || null, avgReturn: cur.avgReturn, avgWin: cur.avgWin, avgLoss: cur.avgLoss, expectancy: cur.expectancy, profitFactor: cur.profitFactor, avgDays: cur.avgDays, breakevenWR: Math.round(100 / (1 + rr)), hasEdge: !!(cur.ci && cur.rate != null && cur.ci.low > Math.round(100 / (1 + rr))) },
    summary,
  };

  return {
    e20, e50, rsi, atr, highs, lows, support, resistance, PP, R1, S1, R2, S2,
    trend, regime, structure, ob, fvg, eq, zone, entry, entryLow, entryHigh, stop, t1, t2, rr, holdNote, price, signal,
    swingLabels, recentLabels, marketStructure, structureBias, structureExplain, reversalConfirmed,
    primaryTrend, currentState, csBase, momentum, trendState, weeklyTrend, mtfAligned, e50slope, e20slope,
    atrNow, atrPct, liquidity, liquidityNote, avgTurnover, relStrength, rsRising, riskPlan, walkForward: report.walkForward, dataCaveats,
    volScore, volLabel, buyers, sellers, buyerPressure, sellerPressure, relVol, volumeConfirms, volumeSummary,
    supStrength, resStrength, supTouches, resTouches, supInfo, resInfo, supWord, resWord, supConfirmed, resConfirmed,
    winRates, bias, biasScore, biasBreakdown, biasExplain, confidence, confidenceLabel, confidenceCapNote, confidenceExplain,
    historicalEdge: histEdge, currentCondition, tradeQuality, grade, qualityBreakdown, qualityCapNote, action: action_obj,
    reconcile, summary, report, byRegime: cur.byRegime || null,
    rsiNow, e20Now, e50Now,
  };
}

// Rolling backtest: at each past candle, derive the signal from ONLY prior data,
// then look forward `horizon` candles to see if price reached T1 before SL.
// Returns are NET of NEPSE transaction costs. Trades are tagged by EMA regime at entry.
// opts.startFrac/endFrac restrict the ENTRY index window (used for out-of-sample testing).
export function backtest(data, horizon = 10, opts = {}) {
  const startFrac = opts.startFrac ?? 0;
  const endFrac = opts.endFrac ?? 1;
  const iStart = Math.max(40, Math.floor(data.length * startFrac));
  const iEnd = Math.floor(data.length * endFrac);
  const cost = opts.cost ?? NEPSE_COST_PCT;
  const mk = () => ({ n: 0, w: 0, l: 0, unresolved: 0, wRet: 0, lRet: 0, netSum: 0, daySum: 0, upN: 0, upNet: 0, dnN: 0, dnNet: 0 });
  const tally = { ACCUMULATE: mk(), HOLD: mk(), TRIM: mk(), BREAKOUT: mk(), BREAKDOWN: mk() };
  const closes = data.map((d) => d.c);
  const e20full = emaArr(closes, 20), e50full = emaArr(closes, 50);
  for (let i = iStart; i < Math.min(data.length - 1, iEnd); i++) {
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
    const regimeUp = e20full[i] > e50full[i];
    let outcome = null, days = 0;
    for (let k = i + 1; k <= Math.min(data.length - 1, i + horizon); k++) {
      days = k - i;
      if (data[k].h >= t1) { outcome = 'win'; break; }
      if (data[k].l <= sl) { outcome = 'loss'; break; }
    }
    const t = tally[sig];
    if (outcome) {
      t.n++;
      const grossRet = outcome === 'win' ? ((t1 - price) / price) * 100 : ((sl - price) / price) * 100;
      const netRet = grossRet - cost; // subtract round-trip cost
      t.netSum += netRet; t.daySum += days;
      if (outcome === 'win') { t.w++; t.wRet += grossRet; } else { t.l++; t.lRet += grossRet; }
      if (regimeUp) { t.upN++; t.upNet += netRet; } else { t.dnN++; t.dnNet += netRet; }
    } else {
      t.unresolved++;
    }
  }
  const out = {};
  for (const k of Object.keys(tally)) {
    const t = tally[k];
    if (!t.n) { out[k] = { n: 0, wins: 0, losses: 0, unresolved: t.unresolved, rate: null, avgReturn: null, avgWin: null, avgLoss: null, expectancy: null, profitFactor: null, avgDays: null, ci: null, byRegime: null }; continue; }
    const avgWin = t.w ? +(t.wRet / t.w).toFixed(2) : 0;
    const avgLoss = t.l ? +(t.lRet / t.l).toFixed(2) : 0;
    const expectancy = +(t.netSum / t.n).toFixed(2); // NET of costs
    const profitFactor = t.lRet !== 0 ? +Math.abs(t.wRet / t.lRet).toFixed(2) : (t.wRet > 0 ? null : 0);
    out[k] = {
      n: t.n, wins: t.w, losses: t.l, unresolved: t.unresolved,
      rate: Math.round((t.w / t.n) * 100),
      avgReturn: expectancy, avgWin, avgLoss, expectancy, profitFactor,
      avgDays: +(t.daySum / t.n).toFixed(1), ci: wilson(t.w, t.n),
      byRegime: {
        up: { n: t.upN, exp: t.upN ? +(t.upNet / t.upN).toFixed(2) : null },
        down: { n: t.dnN, exp: t.dnN ? +(t.dnNet / t.dnN).toFixed(2) : null },
      },
    };
  }
  return out;
}

// Walk-forward: in-sample (first 60%) vs out-of-sample (last 40%) for a given signal.
// Exposes whether the edge SURVIVES on data the levels weren't fit on.
export function walkForward(data, signal, horizon = 10) {
  const is = backtest(data, horizon, { startFrac: 0, endFrac: 0.6 })[signal] || { n: 0 };
  const oos = backtest(data, horizon, { startFrac: 0.6, endFrac: 1 })[signal] || { n: 0 };
  let verdict;
  if (oos.n < 8) verdict = 'Insufficient out-of-sample data';
  else if (oos.expectancy > 0 && is.expectancy > 0) verdict = 'Edge holds out-of-sample';
  else if (oos.expectancy <= 0 && is.expectancy > 0) verdict = 'Edge collapses out-of-sample (likely overfit)';
  else if (oos.expectancy > 0 && is.expectancy <= 0) verdict = 'Positive only out-of-sample (unstable — treat as noise)';
  else verdict = 'No edge in either period';
  return { inSample: is, outSample: oos, verdict };
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
