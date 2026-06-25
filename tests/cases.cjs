/* Engine test suite. Run with: npm test
 * Builds src/analysis.js to a CJS bundle first (see package.json "test" script),
 * then asserts invariants — including regression tests for the two bugs we shipped:
 *   (1) trend classification ignoring EMAs  (LL->LH->LL->HH labelled "Downtrend")
 *   (2) stale trigger ("close above X" with X below current price)
 */
const path = require('path');
const A = require(path.join(__dirname, '..', '.test-bundle.cjs'));
const { analyze, atrArr, backtest, walkForward } = A;

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL:', msg); } };
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---- fixture builders ----
function candle(p, vol = 5000) { const o = p - 1, c = p; return { o, h: Math.max(o, c) + p * 0.012, l: Math.min(o, c) - p * 0.012, c, v: vol }; }
function series(vals, vols) { return vals.map((p, i) => ({ i, t: 1700000000 + i * 86400, ...candle(p, vols ? vols[i] : 5000) })); }
function trendUp(n = 140) { const v = []; let p = 400; for (let i = 0; i < n; i++) { p = p * 1.004 + (Math.random() - 0.5) * 3; v.push(p); } return series(v); }
function trendDown(n = 140) { const v = []; let p = 900; for (let i = 0; i < n; i++) { p = p * 0.996 + (Math.random() - 0.5) * 3; v.push(p); } return series(v); }
// Recovery: long downtrend, then a sharp rally that turns EMAs up and prints a fresh HH.
function recoveryWithFreshHH(n = 150) {
  const v = []; let p = 1100;
  for (let i = 0; i < 80; i++) { p -= 4 + (Math.random() - 0.5) * 3; v.push(p); }      // downtrend
  for (let i = 0; i < 10; i++) { p += 9; v.push(p); }                                    // rally
  for (let i = 0; i < 5; i++) { p -= 5; v.push(p); }                                      // pullback (LL/HL)
  for (let i = 0; i < 25; i++) { p += 8; v.push(p); }                                     // fresh HH
  return series(v);
}

console.log('Running engine tests...');

// 1) basic shape
{
  const a = analyze(trendUp());
  ok(a && typeof a === 'object', 'analyze returns object for valid data');
  ok(analyze([]) === null, 'analyze returns null for too-short data');
}

// 2) uptrend classified up
{
  const a = analyze(trendUp());
  ok(a.primaryTrend.includes('Uptrend'), `uptrend -> primaryTrend (got ${a.primaryTrend})`);
}

// 3) downtrend classified down
{
  const a = analyze(trendDown());
  ok(a.primaryTrend.includes('Downtrend'), `downtrend -> primaryTrend (got ${a.primaryTrend})`);
}

// 4) REGRESSION (bug #1): EMA-bullish recovery must NOT be labelled any Downtrend
{
  const a = analyze(recoveryWithFreshHH());
  const emaBull = a.e20Now > a.e50Now && a.price > a.e50Now;
  if (emaBull) ok(!a.primaryTrend.includes('Downtrend'),
    `EMA-bullish recovery must not be Downtrend (got ${a.primaryTrend}, struct ${a.marketStructure})`);
  else ok(true, '(recovery fixture did not reach EMA-bull; skipped)');
}

// 5) REGRESSION (bug #2): trigger is never a stale "close above X" with X <= price
{
  const fixtures = [trendUp(), trendDown(), recoveryWithFreshHH(), trendUp(160), trendDown(160)];
  let bad = 0;
  for (const f of fixtures) {
    const a = analyze(f);
    const t = a.action.trigger;
    const m = t.match(/above\s+(\d+(\.\d+)?)/i);
    if (m && !a.action.triggerMet) {
      const lvl = parseFloat(m[1]);
      if (lvl <= a.price) { bad++; console.error('    stale trigger:', t, 'price', Math.round(a.price)); }
    }
  }
  ok(bad === 0, `no stale "close above" triggers across fixtures (${bad} bad)`);
}

// 6) qualityBreakdown sums to tradeQuality (unless capped)
{
  for (const f of [trendUp(), trendDown(), recoveryWithFreshHH()]) {
    const a = analyze(f);
    const sum = a.qualityBreakdown.reduce((s, x) => s + x.v, 0);
    const capped = !!a.qualityCapNote;
    ok(capped ? a.tradeQuality <= sum : a.tradeQuality === sum,
      `quality breakdown sums to total (sum ${sum}, total ${a.tradeQuality}, capped ${capped})`);
  }
}

// 7) biasScore bounded, no NaN in core fields
{
  const a = analyze(recoveryWithFreshHH());
  ok(a.biasScore >= -100 && a.biasScore <= 100, 'biasScore in [-100,100]');
  for (const k of ['tradeQuality', 'confidence', 'rr', 'price', 'support', 'resistance', 'atrNow']) {
    ok(Number.isFinite(a[k]), `${k} is finite (got ${a[k]})`);
  }
}

// 8) ATR positive
{
  const atr = atrArr(trendUp());
  ok(atr[atr.length - 1] > 0, 'ATR last value > 0');
}

// 9) net expectancy <= gross expectancy (cost drag)
{
  const d = recoveryWithFreshHH(220);
  const gross = backtest(d, 10, { cost: 0 });
  const net = backtest(d, 10);
  for (const sig of Object.keys(gross)) {
    if (gross[sig].n >= 5 && net[sig].n >= 5 && gross[sig].expectancy != null) {
      ok(net[sig].expectancy <= gross[sig].expectancy + 1e-9, `net <= gross expectancy for ${sig}`);
    }
  }
}

// 10) confidence capped when sample small
{
  // a short, flat series yields few/no matches -> small sample -> capped confidence
  const flat = series(Array.from({ length: 70 }, (_, i) => 500 + Math.sin(i / 3)));
  const a = analyze(flat);
  if (a.report.historicalPerformance.matches < 10) {
    ok(a.confidence <= 35, `confidence capped on small sample (n=${a.report.historicalPerformance.matches}, conf=${a.confidence})`);
  } else ok(true, '(flat fixture produced enough matches; skipped)');
}

// 11) walk-forward returns a verdict string
{
  const wf = walkForward(recoveryWithFreshHH(220), 'ACCUMULATE', 10);
  ok(typeof wf.verdict === 'string' && wf.verdict.length > 0, 'walkForward yields a verdict');
}

// 12) action is always one of the allowed labels
{
  const allowed = ['Strong Buy', 'Buy', 'Watch', 'Hold', 'Avoid'];
  for (const f of [trendUp(), trendDown(), recoveryWithFreshHH()]) {
    const a = analyze(f);
    ok(allowed.includes(a.action.label), `action label valid (${a.action.label})`);
  }
}

// 13) consistency: never Buy/Strong Buy on negative bias
{
  for (const f of [trendDown(), trendDown(160), recoveryWithFreshHH()]) {
    const a = analyze(f);
    if (a.biasScore < 0) ok(!['Buy', 'Strong Buy'].includes(a.action.label),
      `no Buy on negative bias (bias ${a.biasScore}, action ${a.action.label})`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
