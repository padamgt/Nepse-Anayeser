import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, FlatList,
  ActivityIndicator, StyleSheet, Dimensions, Keyboard, Modal,
} from 'react-native';
import Svg, { Rect, Line, Path, G, Text as SvgText } from 'react-native-svg';
import { C } from './theme';
import { analyze } from './analysis';
import { getCookie, setCookie, fetchStockList, fetchCandles, getCandles } from './chukul';
import { getWatchlist } from './data';
import { loadJournal, saveJournal, recordInto, evaluateInto } from './journal';

const fmt = (n) => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 }));
const SIGNAL_COLOR = { BREAKOUT: C.good, ACCUMULATE: '#2E9E6B', HOLD: C.gold, TRIM: '#E5A23A', BREAKDOWN: C.bad };
const GRADE_COLOR = (g) => (g === 'A+' || g === 'A' ? C.good : g === 'B' ? C.gold : g === 'C' ? '#E5A23A' : C.bad);
const clampPct = (v) => Math.max(0, Math.min(100, v));

function StrengthBar({ label, val, sub, color }) {
  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
        <Text style={{ color: C.text, fontSize: 12.5, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color, fontSize: 12.5, fontWeight: '800' }}>{val}/100 {sub ? <Text style={{ color: C.textFaint, fontWeight: '400' }}>· {sub}</Text> : null}</Text>
      </View>
      <View style={{ height: 7, borderRadius: 4, backgroundColor: C.border, overflow: 'hidden' }}>
        <View style={{ width: `${clampPct(val)}%`, height: 7, backgroundColor: color }} />
      </View>
    </View>
  );
}

const ACTION_COLOR = (a) => (a === 'Strong Buy' ? C.good : a === 'Buy' ? '#2E9E6B' : a === 'Watch' ? C.gold : a === 'Hold' ? C.textDim : C.bad);
const AXIS_COLOR = (label) => {
  const up = ['Strong', 'Moderate', 'Bullish', 'A+', 'A'];
  const mid = ['Slight', 'Neutral', 'B', 'Unproven'];
  if (up.includes(label)) return C.good;
  if (mid.includes(label)) return C.gold;
  return C.bad;
};

// One of the three independent lenses
function AxisRow({ name, value, note }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.text, fontSize: 13.5, fontWeight: '700' }}>{name}</Text>
        <Text style={{ color: C.textFaint, fontSize: 11, marginTop: 1 }}>{note}</Text>
      </View>
      <Text style={{ color: AXIS_COLOR(value), fontSize: 14, fontWeight: '900' }}>{value}</Text>
    </View>
  );
}

// signed contribution row (bias breakdown)
function BreakdownRow({ k, v, max }) {
  const signed = max == null;
  const color = signed ? (v > 0 ? C.good : v < 0 ? C.bad : C.textDim) : C.text;
  const pct = max != null ? clampPct((v / max) * 100) : clampPct(((v + 40) / 80) * 100);
  return (
    <View style={{ marginTop: 7 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
        <Text style={{ color: C.textDim, fontSize: 12.5 }}>{k}</Text>
        <Text style={{ color, fontSize: 12.5, fontWeight: '800' }}>{signed ? (v >= 0 ? '+' : '') : ''}{v}{max != null ? <Text style={{ color: C.textFaint, fontWeight: '400' }}> / {max}</Text> : null}</Text>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: C.border, overflow: 'hidden', flexDirection: 'row' }}>
        {signed && <View style={{ width: '50%', alignItems: 'flex-end' }}>{v < 0 && <View style={{ width: `${clampPct((Math.abs(v) / 40) * 100)}%`, height: 6, backgroundColor: C.bad }} />}</View>}
        {signed
          ? <View style={{ width: '50%' }}>{v > 0 && <View style={{ width: `${clampPct((v / 40) * 100)}%`, height: 6, backgroundColor: C.good }} />}</View>
          : <View style={{ width: `${pct}%`, height: 6, backgroundColor: v / max >= 0.6 ? C.good : v / max >= 0.3 ? C.gold : C.bad }} />}
      </View>
    </View>
  );
}

function ActionCard({ A }) {
  const col = ACTION_COLOR(A.action.label);
  return (
    <View style={[styles.card, { borderColor: col, borderWidth: 1.5 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: C.textDim, fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>ACTION</Text>
        <Text style={{ color: col, fontSize: 22, fontWeight: '900' }}>{A.action.label.toUpperCase()}</Text>
      </View>
      <View style={{ marginTop: 10 }}>
        {A.action.reasons.map((r, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 4 }}>
            <Text style={{ color: r.ok ? C.good : C.bad, fontSize: 13, fontWeight: '900', width: 18 }}>{r.ok ? '✓' : '✗'}</Text>
            <Text style={{ color: C.text, fontSize: 13, flex: 1 }}>{r.text}</Text>
          </View>
        ))}
      </View>
      <View style={{ marginTop: 10, backgroundColor: C.bg, borderRadius: 8, padding: 9 }}>
        <Text style={{ color: C.textDim, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>
          {A.action.triggerType === 'manage' ? 'POSITION' : A.action.triggerMet ? 'STATUS' : 'TRIGGER (pending)'}
        </Text>
        <Text style={{ color: A.action.triggerMet ? C.good : C.text, fontSize: 13.5, fontWeight: '700', marginTop: 2 }}>
          {A.action.triggerMet && A.action.triggerType !== 'manage' ? '✓ ' : ''}{A.action.trigger}
        </Text>
      </View>
    </View>
  );
}

// ---- SVG chart ----
function ChartView({ data, A, show, zoom = 1 }) {
  const screenW = Math.round(Dimensions.get('window').width) - 32;
  const padL = 4, padR = 64;
  const priceTop = 8, priceH = 230, volTop = 246, volH = 34, rsiTop = 292, rsiH = 64;
  const H = rsiTop + rsiH + 16;
  const n = data.length;
  const baseStep = (screenW - padL - padR) / n;
  const xStep = baseStep * zoom;
  const W = Math.max(screenW, padL + padR + n * xStep);
  const cx = (i) => padL + i * xStep + xStep / 2;

  const prices = [...data.map((d) => d.h), ...data.map((d) => d.l), A.support, A.resistance, A.t1, A.t2, A.stop];
  const pMax = Math.max(...prices) * 1.01, pMin = Math.min(...prices) * 0.99;
  const y = (p) => priceTop + (1 - (p - pMin) / (pMax - pMin || 1)) * priceH;
  const vMax = Math.max(...data.map((d) => d.v), 1);
  const vy = (v) => volTop + volH - (v / vMax) * volH;
  const ry = (r) => rsiTop + (1 - r / 100) * rsiH;
  const bw = Math.max(1.5, xStep * 0.62);

  const path = (vals, yf) => {
    let d = '', started = false;
    vals.forEach((v, i) => {
      if (v == null) { started = false; return; }
      d += `${started ? 'L' : 'M'}${cx(i).toFixed(1)},${yf(v).toFixed(1)} `;
      started = true;
    });
    return d.trim();
  };

  const Lbl = ({ p, t, color }) => (
    <G>
      <Line x1={padL} y1={y(p)} x2={W - padR} y2={y(p)} stroke={color} strokeWidth="1" strokeDasharray="5,4" />
      <Rect x={W - padR + 1} y={y(p) - 8} width={padR - 2} height={16} rx={3} fill={color} />
      <SvgText x={W - padR / 2} y={y(p) + 4} fill="#06121f" fontSize="10" fontWeight="bold" textAnchor="middle">{t}</SvgText>
    </G>
  );

  return (
    <Svg width={W} height={H}>
      {[0, 0.5, 1].map((f, i) => (
        <Line key={i} x1={padL} y1={priceTop + f * priceH} x2={W - padR} y2={priceTop + f * priceH} stroke={C.border} strokeWidth="1" />
      ))}

      {show.smc && (
        <G>
          <Line x1={padL} y1={y(A.eq)} x2={W - padR} y2={y(A.eq)} stroke={C.accent} strokeWidth="1" strokeDasharray="2,3" opacity="0.6" />
          {A.ob && <Rect x={cx(A.ob.from)} y={y(A.ob.top)} width={W - padR - cx(A.ob.from)} height={Math.max(2, y(A.ob.bot) - y(A.ob.top))} fill={C.good} opacity="0.12" />}
          {A.fvg && <Rect x={cx(A.fvg.from)} y={y(A.fvg.top)} width={Math.max(2, cx(A.fvg.to) - cx(A.fvg.from))} height={Math.max(2, y(A.fvg.bot) - y(A.fvg.top))} fill="#3B82F6" opacity="0.18" />}
        </G>
      )}

      {data.map((d) => {
        const col = d.c >= d.o ? C.good : C.bad;
        return (
          <G key={d.i}>
            <Line x1={cx(d.i)} y1={y(d.h)} x2={cx(d.i)} y2={y(d.l)} stroke={col} strokeWidth="1" />
            <Rect x={cx(d.i) - bw / 2} y={y(Math.max(d.o, d.c))} width={bw} height={Math.max(1, Math.abs(y(d.o) - y(d.c)))} fill={col} />
          </G>
        );
      })}

      {show.ema && <Path d={path(A.e20, y)} fill="none" stroke={C.gold} strokeWidth="1.5" />}
      {show.ema && <Path d={path(A.e50, y)} fill="none" stroke="#7AA2F7" strokeWidth="1.5" />}

      {(A.swingLabels || []).slice(-6).map((s, idx) => (
        <SvgText key={'sl' + idx} x={cx(s.i)} y={s.type === 'H' ? y(s.p) - 4 : y(s.p) + 11}
          fill={s.label === 'HH' || s.label === 'HL' ? C.good : C.bad} fontSize="8" fontWeight="bold" textAnchor="middle">{s.label}</SvgText>
      ))}

      <Lbl p={A.resistance} t={`R ${fmt(A.resistance)}`} color={C.bad} />
      <Lbl p={A.support} t={`S ${fmt(A.support)}`} color={C.good} />
      {show.tgt && <Lbl p={A.t2} t={`T2 ${fmt(A.t2)}`} color="#13855F" />}
      {show.tgt && <Lbl p={A.t1} t={`T1 ${fmt(A.t1)}`} color={C.good} />}
      {show.tgt && <Lbl p={A.stop} t={`SL ${fmt(A.stop)}`} color={C.bad} />}

      {data.map((d) => (
        <Rect key={'v' + d.i} x={cx(d.i) - bw / 2} y={vy(d.v)} width={bw} height={volTop + volH - vy(d.v)} fill={d.c >= d.o ? C.good : C.bad} opacity="0.4" />
      ))}

      <Rect x={padL} y={rsiTop} width={W - padR - padL} height={rsiH} fill="none" stroke={C.border} />
      <Line x1={padL} y1={ry(70)} x2={W - padR} y2={ry(70)} stroke={C.bad} strokeWidth="1" strokeDasharray="3,3" opacity="0.5" />
      <Line x1={padL} y1={ry(30)} x2={W - padR} y2={ry(30)} stroke={C.good} strokeWidth="1" strokeDasharray="3,3" opacity="0.5" />
      <Path d={path(A.rsi, ry)} fill="none" stroke={C.accent} strokeWidth="1.5" />
      <SvgText x={padL + 2} y={rsiTop + 11} fill={C.textFaint} fontSize="9">{`RSI ${fmt(A.rsiNow)}`}</SvgText>
    </Svg>
  );
}

// ---- Full screen: cookie -> picker -> candles -> chart ----
export default function ChartScreen({ initialSymbol = null }) {
  const [cookie, setCk] = useState(null);
  const [cookieInput, setCookieInput] = useState('');
  const [list, setList] = useState([]);
  const [listErr, setListErr] = useState('');
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [show, setShow] = useState({ ema: true, smc: true, tgt: true });
  const [scan, setScan] = useState({ loading: false, results: null, err: '' });
  const [zoom, setZoom] = useState(1);
  const [showCalc, setShowCalc] = useState(false);
  const [bench, setBench] = useState(null);
  const hRef = useRef(null);

  useEffect(() => { getCookie().then((c) => { setCk(c); setCookieInput(c); }); }, []);

  // Load NEPSE index once for relative-strength benchmarking.
  useEffect(() => {
    if (!cookie) return;
    getCandles('NEPSE', cookie).then((c) => { if (c && c.length >= 60) setBench(c); }).catch(() => {});
  }, [cookie]);

  const loadList = useCallback(async (ck) => {
    setListErr('');
    try { setList(await fetchStockList(ck)); }
    catch (e) { setListErr(String(e.message || e)); }
  }, []);

  useEffect(() => { if (cookie) loadList(cookie); }, [cookie, loadList]);

  const saveCookie = async () => {
    await setCookie(cookieInput);
    setCk(cookieInput.trim());
    Keyboard.dismiss();
  };

  const pick = async (symbol) => {
    setSel(symbol); setQuery(''); Keyboard.dismiss();
    setLoading(true); setErr(''); setData(null);
    try {
      const candles = await getCandles(symbol, cookie);
      if (candles.length < 20) throw new Error('Not enough candle history returned for analysis.');
      setData(candles);
      // Journal: log this searched stock's signal and score any open entries for it.
      try {
        const a = analyze(candles, { benchmark: bench });
        if (a) {
          const journal = await loadJournal();
          let changed = evaluateInto(journal, symbol, candles);
          if (recordInto(journal, symbol, a, candles[candles.length - 1].t)) changed = true;
          if (changed) await saveJournal(journal);
        }
      } catch (e) { /* journaling is best-effort */ }
    } catch (e) { setErr(String(e.message || e)); }
    finally { setLoading(false); }
  };

  const A = useMemo(() => (data ? analyze(data, { benchmark: bench }) : null), [data, bench]);

  // Open a symbol handed in from another tab (e.g. the Screen tab).
  useEffect(() => {
    if (initialSymbol && cookie && initialSymbol !== sel) pick(initialSymbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSymbol, cookie]);

  const scanWatch = useCallback(async () => {
    setScan({ loading: true, results: null, err: '' });
    try {
      const wl = await getWatchlist();
      const out = [];
      for (const w of wl) {
        try {
          const candles = await getCandles(w.symbol, cookie);
          if (candles.length >= 20) {
            const a = analyze(candles, { benchmark: bench });
            if (a) out.push({ symbol: w.symbol, a });
          }
        } catch (e) { /* skip this symbol */ }
      }
      const acc = out
        .filter((x) => x.a.signal === 'ACCUMULATE')
        .sort((p, q) => q.a.rr - p.a.rr)
        .slice(0, 5);
      setScan({ loading: false, results: acc, err: out.length ? '' : 'No candle data — check the cookie.' });
    } catch (e) {
      setScan({ loading: false, results: null, err: String(e.message || e) });
    }
  }, [cookie]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return list.filter((s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).slice(0, 30);
  }, [list, query]);

  if (cookie === null) {
    return <View style={styles.center}><ActivityIndicator color={C.accent} /></View>;
  }

  if (!cookie) {
    return (
      <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 96 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Chart — connect Chukul</Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>chk-session cookie</Text>
          <Text style={styles.hint}>
            On chukul.com (logged in) open DevTools → Application → Cookies → copy the value of chk-session, paste below.
            Stored only on this device. It expires periodically — re-paste when the chart stops loading.
          </Text>
          <TextInput style={styles.input} value={cookieInput} onChangeText={setCookieInput} autoCapitalize="none" autoCorrect={false} placeholder="paste chk-session value" placeholderTextColor={C.textFaint} />
          <TouchableOpacity style={styles.btn} onPress={saveCookie}><Text style={styles.btnTxt}>Save &amp; load stocks</Text></TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 96 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
        <Text style={[styles.title, { marginTop: 0 }]}>Chart</Text>
        <Text style={styles.small}>{list.length ? `${list.length} scripts` : (listErr ? 'list error' : 'loading…')}</Text>
      </View>

      <TextInput style={styles.input} value={query} onChangeText={setQuery} autoCapitalize="characters" autoCorrect={false}
        placeholder={sel ? `Selected: ${sel} — search another…` : 'Search any NEPSE script…'} placeholderTextColor={C.textFaint} />
      {listErr ? <Text style={styles.errTxt}>{listErr}</Text> : null}

      {filtered.map((s) => (
        <TouchableOpacity key={s.symbol} style={styles.pickRow} onPress={() => pick(s.symbol)}>
          <Text style={styles.pickSym}>{s.symbol}</Text>
          <Text style={styles.pickName} numberOfLines={1}>{s.name}</Text>
        </TouchableOpacity>
      ))}

      {query.trim() === '' && (
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.cardTitle}>Watchlist · Accumulate setups</Text>
            <TouchableOpacity onPress={scanWatch} disabled={scan.loading} style={[styles.scanBtn, { opacity: scan.loading ? 0.6 : 1 }]}>
              <Text style={styles.scanBtnTxt}>{scan.loading ? 'Scanning…' : 'Scan'}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>Runs every watchlist stock through the candle engine and lists the ones in an Accumulate zone, with auto Entry / S1 / S2 / SL / T1 / T2. Tap one to open its chart.</Text>
          {scan.loading && <ActivityIndicator color={C.accent} style={{ marginTop: 10 }} />}
          {scan.err ? <Text style={styles.errTxt}>{scan.err}</Text> : null}
          {scan.results && scan.results.length === 0 && <Text style={styles.hint}>No watchlist stocks are in an Accumulate zone right now.</Text>}
          {scan.results && scan.results.length > 0 ? (
            <View style={{ marginTop: 8, backgroundColor: C.bg, borderRadius: 8, padding: 9, borderLeftWidth: 3, borderLeftColor: C.gold }}>
              <Text style={{ color: C.gold, fontSize: 12, fontWeight: '800' }}>Scanning inflates false positives</Text>
              <Text style={{ color: C.textDim, fontSize: 11.5, marginTop: 3 }}>You’re testing many names at once, so some will look good by chance alone. Don’t treat the best-looking card as “the pick” — open each, check its walk-forward and liquidity, and demand a real out-of-sample edge before acting.</Text>
            </View>
          ) : null}
          {scan.results && scan.results.map(({ symbol, a }) => (
            <TouchableOpacity key={symbol} style={styles.setup} onPress={() => pick(symbol)}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.pickSym}>{symbol}</Text>
                <Text style={{ color: '#2E9E6B', fontWeight: '800', fontSize: 12 }}>ACCUMULATE · R:R 1:{a.rr.toFixed(1)}</Text>
              </View>
              <Text style={styles.setupLine}><Text style={{ color: C.gold, fontWeight: '800' }}>Buy zone</Text> {fmt(a.entryLow)}–{fmt(a.entryHigh)}   ·   Now {fmt(a.price)}</Text>
              <Text style={styles.setupLine}><Text style={{ color: C.bad, fontWeight: '800' }}>SL</Text> {fmt(a.stop)}   ·   Support {fmt(a.support)}</Text>
              <Text style={styles.setupLine}><Text style={{ color: C.good, fontWeight: '800' }}>T1</Text> {fmt(a.t1)} (+{(((a.t1 - a.entry) / a.entry) * 100).toFixed(1)}%)   <Text style={{ color: '#13855F', fontWeight: '800' }}>T2</Text> {fmt(a.t2)} (+{(((a.t2 - a.entry) / a.entry) * 100).toFixed(1)}%)</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {loading && <View style={{ paddingVertical: 30 }}><ActivityIndicator color={C.accent} /></View>}
      {err ? <Text style={styles.errTxt}>{err}</Text> : null}

      {A && !loading && (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
            <Text style={styles.sym}>{sel}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={styles.price}>Rs {fmt(A.price)}</Text>
              <View style={[styles.sigPill, { backgroundColor: SIGNAL_COLOR[A.signal] }]}><Text style={styles.sigTxt}>{A.signal}</Text></View>
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, alignItems: 'center' }}>
            {['ema', 'smc', 'tgt'].map((k) => (
              <TouchableOpacity key={k} onPress={() => setShow((s) => ({ ...s, [k]: !s[k] }))}
                style={[styles.chip, { backgroundColor: show[k] ? C.accent : 'transparent', borderColor: show[k] ? C.accent : C.border }]}>
                <Text style={{ color: show[k] ? '#fff' : C.textDim, fontSize: 12, fontWeight: '700' }}>{k === 'ema' ? 'EMA' : k === 'smc' ? 'SMC' : 'Targets'}</Text>
              </TouchableOpacity>
            ))}
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))} style={styles.zoomBtn}><Text style={styles.zoomTxt}>−</Text></TouchableOpacity>
            <Text style={{ color: C.textDim, fontSize: 11, width: 30, textAlign: 'center' }}>{zoom}×</Text>
            <TouchableOpacity onPress={() => setZoom((z) => Math.min(5, +(z + 0.5).toFixed(1)))} style={styles.zoomBtn}><Text style={styles.zoomTxt}>＋</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => { setZoom(1); if (hRef.current) hRef.current.scrollTo({ x: 0, animated: false }); }} style={styles.zoomBtn}><Text style={[styles.zoomTxt, { fontSize: 17 }]}>↺</Text></TouchableOpacity>
          </View>

          <View style={styles.chartCard}>
            <ScrollView horizontal ref={hRef} showsHorizontalScrollIndicator
              onContentSizeChange={() => { if (zoom > 1 && hRef.current) hRef.current.scrollToEnd({ animated: false }); }}>
              <ChartView data={data} A={A} show={show} zoom={zoom} />
            </ScrollView>
          </View>

          <View style={styles.grid}>
            {[
              ['Trend', A.trend, C.text],
              ['Structure', A.structure, C.text],
              ['Zone', A.zone, A.zone === 'Discount' ? C.good : C.bad],
              ['RSI(14)', fmt(A.rsiNow), A.rsiNow > 70 ? C.bad : A.rsiNow < 30 ? C.good : C.text],
              ['EMA 20/50', `${fmt(A.e20Now)} / ${fmt(A.e50Now)}`, A.e20Now > A.e50Now ? C.good : C.bad],
              ['Risk:Reward', `1 : ${A.rr.toFixed(1)}`, A.rr >= 2 ? C.good : C.textDim],
            ].map(([k, v, col], i) => (
              <View key={i} style={styles.statCard}>
                <Text style={styles.statK}>{k}</Text>
                <Text style={[styles.statV, { color: col }]}>{v}</Text>
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Swing plan</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 4 }}>
              <View>
                <Text style={styles.statK}>BUY ZONE</Text>
                <Text style={{ color: C.gold, fontSize: 20, fontWeight: '900' }}>{fmt(A.entryLow)} – {fmt(A.entryHigh)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.statK}>CURRENT</Text>
                <Text style={{ color: A.price >= A.entryLow && A.price <= A.entryHigh ? C.good : C.text, fontSize: 20, fontWeight: '900' }}>{fmt(A.price)}</Text>
              </View>
            </View>
            <Text style={{ color: A.price >= A.entryLow && A.price <= A.entryHigh ? C.good : C.textDim, fontSize: 12, fontWeight: '700', marginBottom: 10 }}>
              {A.price < A.entryLow ? 'Below buy zone — already cheap, check why' : A.price <= A.entryHigh ? '● In buy zone now' : 'Above buy zone — wait for a pullback'}
            </Text>
            <View style={styles.grid}>
              {[
                ['Support', fmt(A.support), C.textDim],
                ['SL', fmt(A.stop), C.bad],
                ['R:R', `1:${A.rr.toFixed(1)}`, A.rr >= 2 ? C.good : C.textDim],
                ['T1', `${fmt(A.t1)} +${(((A.t1 - A.entry) / A.entry) * 100).toFixed(1)}%`, C.good],
                ['T2', `${fmt(A.t2)} +${(((A.t2 - A.entry) / A.entry) * 100).toFixed(1)}%`, '#13855F'],
              ].map(([k, v, col], i) => (
                <View key={i} style={styles.statCard}>
                  <Text style={styles.statK}>{k}</Text>
                  <Text style={[styles.statV, { color: col }]}>{v}</Text>
                </View>
              ))}
            </View>
            <Text style={[styles.disc, { marginTop: 8 }]}>{A.holdNote}</Text>
          </View>

          {/* ===== ACTION (final decision) ===== */}
          <ActionCard A={A} />

          {/* ===== THREE LENSES (why metrics can disagree) ===== */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Three lenses</Text>
            <AxisRow name="Historical edge" value={A.historicalEdge} note="How this setup TYPE paid in the past" />
            <AxisRow name="Current condition" value={A.currentCondition} note="What price is doing right now" />
            <AxisRow name={`Trade quality · ${A.grade}`} value={`${A.tradeQuality}/100`} note="Whether entering HERE today is good timing" />
            <Text style={[styles.disc, { marginTop: 8 }]}>{A.reconcile}</Text>
          </View>

          {/* ===== TRADE QUALITY BREAKDOWN ===== */}
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              <View style={[styles.gradeBox, { borderColor: GRADE_COLOR(A.grade) }]}>
                <Text style={[styles.gradeTxt, { color: GRADE_COLOR(A.grade) }]}>{A.grade}</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.cardTitle}>Trade quality {A.tradeQuality}/100</Text>
                <Text style={{ color: C.textFaint, fontSize: 11.5, marginTop: 2 }}>Points earned per factor (each capped). They sum to the score.</Text>
              </View>
            </View>
            {A.qualityBreakdown.map((q, i) => <BreakdownRow key={i} k={q.k} v={q.v} max={q.max} />)}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border }}>
              <Text style={{ color: C.text, fontSize: 13, fontWeight: '800' }}>Total</Text>
              <Text style={{ color: GRADE_COLOR(A.grade), fontSize: 13, fontWeight: '900' }}>{A.tradeQuality}/100</Text>
            </View>
            {A.qualityCapNote ? <Text style={[styles.disc, { marginTop: 8, color: C.gold }]}>⚠ {A.qualityCapNote}</Text> : null}
          </View>

          {/* ===== BIAS BREAKDOWN ===== */}
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.cardTitle}>Bias {A.biasScore > 0 ? '+' : ''}{A.biasScore}</Text>
              <Text style={{ color: A.biasScore > 0 ? C.good : A.biasScore < 0 ? C.bad : C.textDim, fontSize: 15, fontWeight: '900' }}>{A.bias}</Text>
            </View>
            <View style={[styles.biasTrack, { marginTop: 8, marginBottom: 2 }]}>
              <View style={styles.biasMid} />
              <View style={{ position: 'absolute', left: `${clampPct((A.biasScore + 100) / 2)}%`, top: -3, width: 10, height: 16, borderRadius: 3, marginLeft: -5, backgroundColor: A.biasScore > 0 ? C.good : A.biasScore < 0 ? C.bad : C.textDim }} />
            </View>
            {A.biasBreakdown.map((b, i) => <BreakdownRow key={i} k={b.k} v={b.v} max={null} />)}
            <Text style={{ color: C.text, fontSize: 13, marginTop: 10 }}>
              Confidence <Text style={{ color: A.confidence >= 66 ? C.good : A.confidence >= 40 ? C.gold : C.bad, fontWeight: '800' }}>{A.confidenceLabel} ({A.confidence})</Text>
              <Text style={{ color: C.textFaint }}>  — how reliable this read is, not its direction</Text>
            </Text>
            {A.confidenceCapNote ? <Text style={[styles.disc, { marginTop: 4, color: C.gold }]}>⚠ {A.confidenceCapNote}</Text> : null}
            <Text style={[styles.disc, { marginTop: 6 }]}>{A.summary}</Text>
          </View>

          {/* ===== TREND HIERARCHY (primary / state / momentum) ===== */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Trend</Text>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '900', marginTop: 2 }}>{A.trendState}</Text>
            <View style={{ flexDirection: 'row', marginTop: 10 }}>
              {[{ k: 'Primary trend', v: A.primaryTrend, c: A.primaryTrend.includes('Up') ? C.good : A.primaryTrend.includes('Down') ? C.bad : C.gold },
                { k: 'Current state', v: A.currentState, c: /up|Base|Breakout/.test(A.currentState) ? C.good : /down|Roll|Top|Breakdown/.test(A.currentState) ? C.bad : C.textDim },
                { k: 'Momentum', v: A.momentum, c: A.momentum === 'Rising' ? C.good : A.momentum === 'Falling' ? C.bad : C.textDim }].map((x, i) => (
                <View key={i} style={{ flex: 1, paddingRight: 6 }}>
                  <Text style={{ color: C.textFaint, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.3 }}>{x.k.toUpperCase()}</Text>
                  <Text style={{ color: x.c, fontSize: 12.5, fontWeight: '800', marginTop: 2 }}>{x.v}</Text>
                </View>
              ))}
            </View>
            <Text style={{ color: C.textFaint, fontSize: 11.5, marginTop: 10 }}>Structure: {A.marketStructure}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
              {[{ t: `Weekly: ${A.weeklyTrend}`, c: A.weeklyTrend === 'Uptrend' ? C.good : A.weeklyTrend === 'Downtrend' ? C.bad : C.textDim },
                { t: `Liquidity: ${A.liquidity}`, c: A.liquidity === 'Liquid' ? C.good : A.liquidity === 'Moderate' ? C.gold : C.bad },
                ...(A.relStrength != null ? [{ t: `RS vs index ${A.relStrength > 0 ? '+' : ''}${A.relStrength}pp`, c: A.relStrength > 0 ? C.good : C.bad }] : [])].map((chip, i) => (
                <View key={i} style={{ backgroundColor: C.bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6, marginBottom: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: chip.c }}>
                  <Text style={{ color: chip.c, fontSize: 11, fontWeight: '700' }}>{chip.t}</Text>
                </View>
              ))}
            </View>
            <Text style={[styles.hint, { marginTop: 4 }]}>{A.structureExplain}</Text>
            {A.primaryTrend.includes('Down') && /up|Base/.test(A.currentState) ? (
              <View style={{ marginTop: 8, backgroundColor: C.bg, borderRadius: 8, padding: 9, borderLeftWidth: 3, borderLeftColor: C.gold }}>
                <Text style={{ color: C.gold, fontSize: 12.5, fontWeight: '800' }}>Why both can be true</Text>
                <Text style={{ color: C.textDim, fontSize: 12, marginTop: 3 }}>The primary trend (slow, EMA-based) is still down, while the latest swings (fast) are attempting to turn up. The turn isn’t a new uptrend until price confirms — that’s what the trigger watches for.</Text>
              </View>
            ) : null}
          </View>

          {/* ===== RISK PLAN (ATR-based stop + position sizing) ===== */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Risk plan</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
              {[{ k: 'Entry', v: fmt(A.riskPlan.entry) }, { k: 'Stop', v: fmt(A.riskPlan.stop) },
                { k: 'Target 1', v: fmt(A.riskPlan.t1) }, { k: 'Target 2', v: fmt(A.riskPlan.t2) },
                { k: 'Risk / share', v: `${fmt(A.riskPlan.riskPerShare)} (${A.riskPlan.riskPct}%)` },
                { k: 'ATR', v: `${fmt(A.riskPlan.atr)} (${A.riskPlan.atrPct}%)` }].map((x, i) => (
                <View key={i} style={{ width: '50%', marginBottom: 8 }}>
                  <Text style={{ color: C.textFaint, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.3 }}>{x.k.toUpperCase()}</Text>
                  <Text style={{ color: C.text, fontSize: 14, fontWeight: '800', marginTop: 1 }}>{x.v}</Text>
                </View>
              ))}
            </View>
            <View style={{ backgroundColor: C.bg, borderRadius: 8, padding: 9, marginTop: 2 }}>
              <Text style={{ color: C.text, fontSize: 12.5 }}>
                Risking <Text style={{ fontWeight: '800' }}>1% of NPR 100,000</Text> → about <Text style={{ color: C.accent, fontWeight: '900' }}>{A.riskPlan.sharesPer100k}</Text> shares. Stop is the wider of a 1.5×ATR distance and the structure break, so volatile names get room and tight names aren’t over-risked.
              </Text>
            </View>
            {A.liquidity === 'Illiquid' || A.liquidity === 'Thin' ? (
              <Text style={[styles.disc, { marginTop: 8, color: C.bad }]}>⚠ {A.liquidityNote}</Text>
            ) : null}
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Support / resistance</Text>
            {[{ tag: 'Support', info: A.supInfo, str: A.supStrength, t: A.supTouches, word: A.supWord, conf: A.supConfirmed, color: C.good },
              { tag: 'Resistance', info: A.resInfo, str: A.resStrength, t: A.resTouches, word: A.resWord, conf: A.resConfirmed, color: C.bad }].map((x, i) => (
              <View key={i} style={{ marginTop: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: C.text, fontSize: 13.5, fontWeight: '700' }}>
                    {x.conf ? x.tag : `${x.tag} (candidate)`} <Text style={{ color: x.color, fontWeight: '900' }}>{fmt(x.info.price)}</Text>
                  </Text>
                  <Text style={{ color: x.t === 0 ? C.textFaint : x.color, fontSize: 12.5, fontWeight: '800' }}>{x.word}</Text>
                </View>
                <View style={{ height: 7, borderRadius: 4, backgroundColor: C.border, overflow: 'hidden', marginTop: 4 }}>
                  <View style={{ width: `${clampPct(x.str)}%`, height: 7, backgroundColor: x.color }} />
                </View>
                <Text style={{ color: C.textFaint, fontSize: 11, marginTop: 3 }}>
                  {x.str}/100 · {x.t} {x.t === 1 ? 'touch' : 'touches'}{x.t === 0 ? ' — price hasn’t tested this level yet, so it’s an untested candidate' : x.conf ? ' — tested and confirmed' : ' — only lightly tested'}
                </Text>
              </View>
            ))}
            <Text style={[styles.disc, { marginTop: 8 }]}>Strength blends touches, volume at the level, bounce quality and how long it’s held. A level with 0 touches is a projected candidate, not a confirmed wall.</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Volume</Text>
            <StrengthBar label="Buyer pressure" val={A.buyerPressure} sub={`${A.buyers} up days`} color={C.good} />
            <StrengthBar label="Seller pressure" val={A.sellerPressure} sub={`${A.sellers} down days`} color={C.bad} />
            <Text style={[styles.hint, { marginTop: 6 }]}>Last bar {A.relVol}× average volume · {A.volumeConfirms ? 'confirms' : 'does not confirm'} the {A.regime.toLowerCase()}.</Text>
          </View>

          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.cardTitle}>Historical performance · {A.signal}</Text>
              <TouchableOpacity onPress={() => setShowCalc(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={{ color: C.accent, fontSize: 16, fontWeight: '800' }}>ⓘ</Text>
              </TouchableOpacity>
            </View>
            {A.report.historicalPerformance.matches >= 5 ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginVertical: 6 }}>
                  <View>
                    <Text style={styles.statK}>EXPECTANCY / TRADE</Text>
                    <Text style={{ color: A.report.historicalPerformance.expectancy >= 0 ? C.good : C.bad, fontSize: 22, fontWeight: '900' }}>{A.report.historicalPerformance.expectancy > 0 ? '+' : ''}{A.report.historicalPerformance.expectancy}%</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.statK}>PROFIT FACTOR</Text>
                    <Text style={{ color: (A.report.historicalPerformance.profitFactor || 0) >= 1.3 ? C.good : C.gold, fontSize: 22, fontWeight: '900' }}>{A.report.historicalPerformance.profitFactor == null ? '∞' : A.report.historicalPerformance.profitFactor}</Text>
                  </View>
                </View>
                <View style={styles.grid}>
                  {[
                    ['Hit rate', `${A.report.historicalPerformance.hitRate}%`, A.report.historicalPerformance.hitRate >= 60 ? C.good : C.gold],
                    ['Breakeven', `${A.report.historicalPerformance.breakevenWR}%`, C.textDim],
                    ['Avg win', `+${A.report.historicalPerformance.avgWin}%`, C.good],
                    ['Avg loss', `${A.report.historicalPerformance.avgLoss}%`, C.bad],
                    ['Matches', `${A.report.historicalPerformance.matches}`, C.text],
                    ['Avg days', `${A.report.historicalPerformance.avgDays}`, C.text],
                  ].map(([k, v, col], i) => (
                    <View key={i} style={styles.statCard}><Text style={styles.statK}>{k}</Text><Text style={[styles.statV, { color: col }]}>{v}</Text></View>
                  ))}
                </View>
                <Text style={[styles.hint, { marginTop: 8, color: A.report.historicalPerformance.hasEdge ? C.good : C.gold, fontWeight: '700' }]}>
                  {A.report.historicalPerformance.hasEdge
                    ? `Edge: even the low end of the confidence range (${A.report.historicalPerformance.ci.low}%) beats the ${A.report.historicalPerformance.breakevenWR}% breakeven for this R:R.`
                    : `No proven edge yet: the ${A.report.historicalPerformance.breakevenWR}% breakeven sits inside the confidence range (${A.report.historicalPerformance.ci ? A.report.historicalPerformance.ci.low + '–' + A.report.historicalPerformance.ci.high + '%' : '—'}).`}
                </Text>
                <Text style={[styles.disc, { marginTop: 8 }]}>Backtest is NET of ~{0.9}% round-trip cost; describes the past, not a prediction. {A.report.historicalPerformance.unresolved > 0 ? `${A.report.historicalPerformance.unresolved} setup(s) didn’t resolve in 10 days. ` : ''}n={A.report.historicalPerformance.matches}{A.report.historicalPerformance.matches < 20 ? ', below the 20 needed for a reliable read' : ''}. The real test is the Live track record on the Picks tab. Tap ⓘ for formulas.</Text>

                {/* Walk-forward (out-of-sample) */}
                <View style={{ marginTop: 10, backgroundColor: C.bg, borderRadius: 8, padding: 10 }}>
                  <Text style={{ color: C.textDim, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>WALK-FORWARD (does the edge survive?)</Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                    <View><Text style={styles.statK}>In-sample exp</Text><Text style={{ color: (A.report.walkForward.inSampleExp || 0) >= 0 ? C.good : C.bad, fontSize: 14, fontWeight: '800' }}>{A.report.walkForward.inSampleExp == null ? '—' : (A.report.walkForward.inSampleExp > 0 ? '+' : '') + A.report.walkForward.inSampleExp + '%'} <Text style={{ color: C.textFaint, fontWeight: '400' }}>n={A.report.walkForward.inSampleN}</Text></Text></View>
                    <View style={{ alignItems: 'flex-end' }}><Text style={styles.statK}>Out-of-sample exp</Text><Text style={{ color: (A.report.walkForward.oosExp || 0) >= 0 ? C.good : C.bad, fontSize: 14, fontWeight: '800' }}>{A.report.walkForward.oosExp == null ? '—' : (A.report.walkForward.oosExp > 0 ? '+' : '') + A.report.walkForward.oosExp + '%'} <Text style={{ color: C.textFaint, fontWeight: '400' }}>n={A.report.walkForward.oosN}</Text></Text></View>
                  </View>
                  <Text style={{ color: /holds/.test(A.report.walkForward.verdict) ? C.good : /collapses|noise/.test(A.report.walkForward.verdict) ? C.bad : C.gold, fontSize: 12, fontWeight: '700', marginTop: 6 }}>{A.report.walkForward.verdict}</Text>
                </View>

                {/* Regime split */}
                {A.byRegime && (A.byRegime.up.n > 0 || A.byRegime.down.n > 0) ? (
                  <Text style={[styles.hint, { marginTop: 8 }]}>
                    By regime — uptrend (EMA20&gt;50): {A.byRegime.up.exp == null ? '—' : (A.byRegime.up.exp > 0 ? '+' : '') + A.byRegime.up.exp + '%'} over {A.byRegime.up.n}; downtrend: {A.byRegime.down.exp == null ? '—' : (A.byRegime.down.exp > 0 ? '+' : '') + A.byRegime.down.exp + '%'} over {A.byRegime.down.n}. Trade the regime where the edge actually lives.
                  </Text>
                ) : null}
              </>
            ) : (
              <Text style={styles.hint}>Only {A.report.historicalPerformance.matches} similar past setup(s) in recent history — too few to report a meaningful hit-rate. Sample size matters more than a flashy number. Tap ⓘ to see how this is calculated.</Text>
            )}
          </View>

          <Text style={styles.disc}>Descriptive analysis on Chukul candle history — not a prediction or trade advice. NEPSE is thin and can move on news/liquidity, not chart structure. Verify before acting.</Text>
        </>
      )}

      {!A && !loading && !err && (
        <Text style={styles.hint}>Search a script above and tap it to load its candle chart and analysis.</Text>
      )}

      <TouchableOpacity onPress={() => { setCk(''); }} style={{ marginTop: 24 }}>
        <Text style={{ color: C.textFaint, fontSize: 12 }}>Update Chukul cookie</Text>
      </TouchableOpacity>

      <CalcInfoModal visible={showCalc} A={A} onClose={() => setShowCalc(false)} />
    </ScrollView>
  );
}

// How-it's-calculated modal for the Historical Performance metrics.
function CalcInfoModal({ visible, A, onClose }) {
  const hp = A && A.report ? A.report.historicalPerformance : null;
  const rows = [
    ['Expectancy / trade', 'The headline metric: average % you’d expect per trade if you repeated this setup. = (WinRate × AvgWin) − (LossRate × |AvgLoss|). Positive = the setup made money historically; a high hit rate with tiny wins can still be negative.', hp && hp.expectancy != null ? `${hp.expectancy > 0 ? '+' : ''}${hp.expectancy}% per trade` : ''],
    ['Profit factor', 'Total winning % ÷ total losing %. Above 1.0 means wins outweigh losses; 1.3+ is decent, 1.6+ good — on out-of-sample data only.', hp && hp.profitFactor != null ? `${hp.profitFactor}` : ''],
    ['Breakeven win-rate', '1 ÷ (1 + Risk:Reward) × 100. The hit rate you’d need just to not lose money at this R:R. If your hit rate isn’t clearly above this, there’s no edge.', hp && hp.breakevenWR != null ? `${hp.breakevenWR}% needed` : ''],
    ['Matches', 'Count of past bars whose signal (computed from prior candles only) matched the current signal AND resolved as a win or loss within 10 trading days.', hp ? `${hp.matches} similar setups found` : ''],
    ['Wins / Losses', 'Win = high reached Target 1 before low hit Stop Loss (support − 4%). Loss = Stop Loss first.', hp ? `${hp.wins}W / ${hp.losses}L` : ''],
    ['Hit rate', 'Wins ÷ Matches × 100.', hp && hp.hitRate != null ? `${hp.wins} ÷ ${hp.matches} × 100 = ${hp.hitRate}%` : ''],
    ['95% interval', 'Wilson score interval — the range the true hit-rate likely falls in given the sample. Wide = not enough data to trust the headline %.', hp && hp.ci ? `${hp.ci.low}% – ${hp.ci.high}%` : ''],
    ['Avg win / Avg loss', 'Mean % gain on winners and mean % loss on losers, shown separately so payoff asymmetry is visible.', hp && hp.avgWin != null ? `+${hp.avgWin}% / ${hp.avgLoss}%` : ''],
    ['Avg days', 'Mean trading days from signal to hitting T1 or SL.', hp && hp.avgDays != null ? `${hp.avgDays} days` : ''],
    ['Unresolved', 'Setups that hit neither T1 nor SL within 10 days. Excluded from the rate (a known limitation).', hp ? `${hp.unresolved} excluded` : ''],
  ];
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
        <View style={[styles.card, { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, marginTop: 0, maxHeight: '85%' }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <Text style={[styles.cardTitle, { fontSize: 14 }]}>How historical performance is calculated</Text>
            <TouchableOpacity onPress={onClose}><Text style={{ color: C.textDim, fontSize: 16 }}>✕</Text></TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 460 }}>
            {rows.map(([k, desc, ex], i) => (
              <View key={i} style={{ marginBottom: 12 }}>
                <Text style={{ color: C.text, fontWeight: '800', fontSize: 13.5 }}>{k}</Text>
                <Text style={[styles.hint, { marginTop: 2 }]}>{desc}</Text>
                {ex ? <Text style={{ color: C.accent, fontSize: 12, marginTop: 3, fontWeight: '700' }}>This stock: {ex}</Text> : null}
              </View>
            ))}
            <Text style={[styles.disc, { marginTop: 4 }]}>
              Worked example — if 54 setups matched and 34 were wins: Hit rate = 34 ÷ 54 × 100 = 63%. With n=54 the 95% interval is roughly 49%–75%, i.e. “somewhere in the low-to-mid 60s,” not exactly 63%.
            </Text>
            <View style={{ marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, paddingTop: 10 }}>
              <Text style={{ color: C.gold, fontWeight: '800', fontSize: 13 }}>Known data limitations (read these)</Text>
              {(A && A.dataCaveats ? A.dataCaveats : []).map((c, i) => (
                <Text key={i} style={[styles.hint, { marginTop: 5 }]}>• {c}</Text>
              ))}
              <Text style={[styles.hint, { marginTop: 5 }]}>• Walk-forward (in-sample vs out-of-sample) is shown so you can see whether an edge survives on data the levels weren’t drawn from. If it collapses out-of-sample, treat it as overfit.</Text>
            </View>
          </ScrollView>
          <TouchableOpacity style={[styles.btn, { marginTop: 10 }]} onPress={onClose}><Text style={styles.btnTxt}>Got it</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontSize: 18, fontWeight: '800', marginTop: 18 },
  small: { color: C.textFaint, fontSize: 11 },
  card: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, marginTop: 12 },
  cardTitle: { color: C.textDim, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  hint: { color: C.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 8 },
  input: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, color: C.text, paddingHorizontal: 14, paddingVertical: 10, marginTop: 10, fontSize: 14 },
  btn: { backgroundColor: C.accent, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 12 },
  btnTxt: { color: '#fff', fontWeight: '800' },
  errTxt: { color: C.bad, fontSize: 12.5, marginTop: 10, lineHeight: 18 },
  pickRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, marginTop: 8 },
  pickSym: { color: C.text, fontWeight: '800', width: 86 },
  pickName: { color: C.textDim, fontSize: 12, flex: 1 },
  sym: { color: C.text, fontSize: 20, fontWeight: '900' },
  price: { color: C.text, fontSize: 16, fontWeight: '700' },
  sigPill: { borderRadius: 6, paddingHorizontal: 9, paddingVertical: 3, marginLeft: 8 },
  sigTxt: { color: '#06121f', fontSize: 11, fontWeight: '800' },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  chartCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 8, marginTop: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  statCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 10, width: '31%' },
  statK: { color: C.textFaint, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '700' },
  statV: { fontSize: 14, fontWeight: '800', marginTop: 3 },
  lvl: { color: C.text, fontSize: 13, marginTop: 4 },
  disc: { color: C.textFaint, fontSize: 11, lineHeight: 16, marginTop: 16, fontStyle: 'italic' },
  scanBtn: { backgroundColor: C.accent, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 6 },
  scanBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 12 },
  setup: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 11, marginTop: 8 },
  setupLine: { color: C.text, fontSize: 12.5, marginTop: 3 },
  zoomBtn: { width: 34, height: 30, borderRadius: 8, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  zoomTxt: { color: C.text, fontSize: 18, fontWeight: '800', lineHeight: 20 },
  gradeBox: { width: 58, height: 58, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  gradeTxt: { fontSize: 24, fontWeight: '900' },
  biasTrack: { height: 10, borderRadius: 5, backgroundColor: C.border, marginTop: 4, position: 'relative', justifyContent: 'center' },
  biasMid: { position: 'absolute', left: '50%', width: 1, height: 10, backgroundColor: C.textFaint },
});
