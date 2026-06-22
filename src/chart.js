import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, FlatList,
  ActivityIndicator, StyleSheet, Dimensions, Keyboard,
} from 'react-native';
import Svg, { Rect, Line, Path, G, Text as SvgText } from 'react-native-svg';
import { C } from './theme';
import { analyze } from './analysis';
import { getCookie, setCookie, fetchStockList, fetchCandles } from './chukul';
import { getWatchlist } from './data';

const fmt = (n) => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 }));
const SIGNAL_COLOR = { BREAKOUT: C.good, ACCUMULATE: '#2E9E6B', HOLD: C.gold, TRIM: '#E5A23A', BREAKDOWN: C.bad };

// ---- SVG chart ----
function ChartView({ data, A, show }) {
  const W = Math.round(Dimensions.get('window').width) - 32;
  const padL = 4, padR = 64;
  const priceTop = 8, priceH = 230, volTop = 246, volH = 34, rsiTop = 292, rsiH = 64;
  const H = rsiTop + rsiH + 16;
  const n = data.length;
  const xStep = (W - padL - padR) / n;
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
export default function ChartScreen() {
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

  useEffect(() => { getCookie().then((c) => { setCk(c); setCookieInput(c); }); }, []);

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
      const candles = await fetchCandles(symbol, cookie);
      if (candles.length < 20) throw new Error('Not enough candle history returned for analysis.');
      setData(candles);
    } catch (e) { setErr(String(e.message || e)); }
    finally { setLoading(false); }
  };

  const A = useMemo(() => (data ? analyze(data) : null), [data]);

  const scanWatch = useCallback(async () => {
    setScan({ loading: true, results: null, err: '' });
    try {
      const wl = await getWatchlist();
      const out = [];
      for (const w of wl) {
        try {
          const candles = await fetchCandles(w.symbol, cookie);
          if (candles.length >= 20) {
            const a = analyze(candles);
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
          {scan.results && scan.results.map(({ symbol, a }) => (
            <TouchableOpacity key={symbol} style={styles.setup} onPress={() => pick(symbol)}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.pickSym}>{symbol}</Text>
                <Text style={{ color: '#2E9E6B', fontWeight: '800', fontSize: 12 }}>ACCUMULATE · R:R 1:{a.rr.toFixed(1)}</Text>
              </View>
              <Text style={styles.setupLine}><Text style={{ color: C.gold, fontWeight: '800' }}>Entry</Text> {fmt(a.entry)}   <Text style={{ color: C.bad, fontWeight: '800' }}>SL</Text> {fmt(a.stop)}</Text>
              <Text style={styles.setupLine}>S1 {fmt(a.S1)}   S2 {fmt(a.S2)}</Text>
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

          <View style={{ flexDirection: 'row', gap: 6, marginTop: 10 }}>
            {['ema', 'smc', 'tgt'].map((k) => (
              <TouchableOpacity key={k} onPress={() => setShow((s) => ({ ...s, [k]: !s[k] }))}
                style={[styles.chip, { backgroundColor: show[k] ? C.accent : 'transparent', borderColor: show[k] ? C.accent : C.border }]}>
                <Text style={{ color: show[k] ? '#fff' : C.textDim, fontSize: 12, fontWeight: '700' }}>{k === 'ema' ? 'EMA' : k === 'smc' ? 'SMC' : 'Targets'}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.chartCard}><ChartView data={data} A={A} show={show} /></View>

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
            <Text style={styles.cardTitle}>Levels &amp; targets</Text>
            <Text style={styles.lvl}><Text style={{ color: C.bad, fontWeight: '800' }}>Stop</Text> {fmt(A.stop)}   <Text style={{ color: C.gold, fontWeight: '800' }}>Entry</Text> {fmt(A.entry)}</Text>
            <Text style={styles.lvl}><Text style={{ color: C.good, fontWeight: '800' }}>T1</Text> {fmt(A.t1)} (+{(((A.t1 - A.entry) / A.entry) * 100).toFixed(1)}%)   <Text style={{ color: '#13855F', fontWeight: '800' }}>T2</Text> {fmt(A.t2)} (+{(((A.t2 - A.entry) / A.entry) * 100).toFixed(1)}%)</Text>
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
    </ScrollView>
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
});
