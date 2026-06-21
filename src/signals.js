import { C } from './theme';

// ---- Signal definitions -----------------------------------------------------
// A stock's state is derived purely from where the last traded price sits inside
// its support / resistance band: ACCUMULATE / HOLD / TRIM / BREAKOUT / BREAKDOWN.
export const SIGNAL_META = {
  BREAKOUT: {
    label: 'Breakout',
    color: C.good,
    hint: 'Trading above resistance. Momentum is up — wait for a confirmed close / volume before chasing.',
  },
  ACCUMULATE: {
    label: 'Accumulate',
    color: '#2E9E6B',
    hint: 'In the lower quarter of the band, near support. Favourable zone to build a position.',
  },
  HOLD: {
    label: 'Hold',
    color: C.gold,
    hint: 'Mid-band, no clear edge. Let it resolve toward support or resistance first.',
  },
  TRIM: {
    label: 'Trim',
    color: C.warn,
    hint: 'Upper quarter of the band, near resistance. Reasonable spot to book partial profit.',
  },
  BREAKDOWN: {
    label: 'Breakdown',
    color: C.bad,
    hint: 'Below support. Trend is weak — protect capital, avoid averaging down blindly.',
  },
  NODATA: {
    label: 'No data',
    color: C.textFaint,
    hint: 'No live price for this symbol yet. Pull to refresh, or check the symbol spelling and your API connection.',
  },
};

export const SIGNAL_ORDER = ['BREAKOUT', 'ACCUMULATE', 'HOLD', 'TRIM', 'BREAKDOWN', 'NODATA'];

export function computeSignal(price, support, resistance) {
  if (price == null || isNaN(price)) return 'NODATA';
  if (!support || !resistance || resistance <= support) return 'NODATA';
  if (price > resistance) return 'BREAKOUT';
  if (price < support) return 'BREAKDOWN';
  const pos = (price - support) / (resistance - support); // 0 at support, 1 at resistance
  if (pos <= 0.25) return 'ACCUMULATE';
  if (pos >= 0.75) return 'TRIM';
  return 'HOLD';
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- Scoring ----------------------------------------------------------------
// Quality = the "accounting" side. Rewards strong ROE, sane P/E, low P/B and
// decent EPS. Returns 50 (neutral) when fundamentals are absent.
export function qualityScore(f) {
  if (!f || (!f.eps && !f.pe && !f.pb && !f.roe)) return 50;
  let s = 50;
  if (f.roe) s += (f.roe - 15) * 1.4;
  if (f.pe) s += (20 - f.pe) * 0.9;
  if (f.pb) s += (2.5 - f.pb) * 6;
  if (f.eps) s += Math.min(f.eps, 80) * 0.15;
  return clamp(Math.round(s), 0, 100);
}

// Technical = where price sits in the band right now.
export function technicalScore(price, support, resistance) {
  const sig = computeSignal(price, support, resistance);
  return { BREAKOUT: 82, ACCUMULATE: 88, HOLD: 60, TRIM: 45, BREAKDOWN: 24, NODATA: 0 }[sig];
}

// Composite blends the accounting and technical views 50 / 50.
export function compositeScore(stock) {
  const q = qualityScore(stock.fundamentals);
  const t = technicalScore(stock.price, stock.support, stock.resistance);
  return { quality: q, technical: t, total: Math.round(q * 0.5 + t * 0.5) };
}

export function rankStocks(stocks) {
  return stocks
    .map((s) => ({ ...s, signal: computeSignal(s.price, s.support, s.resistance), score: compositeScore(s) }))
    .sort((a, b) => b.score.total - a.score.total);
}
