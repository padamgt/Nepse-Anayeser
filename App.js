import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { C } from './src/theme';
import {
  loadData,
  fetchMovers,
  getWatchlist,
  saveWatchlist,
  getApiUrl,
  setApiUrl,
  getIndexBand,
  saveIndexBand,
  pingApi,
  DEFAULT_API,
} from './src/data';
import { rankStocks, compositeScore, computeSignal, SIGNAL_META } from './src/signals';
import { BandGauge, GaugeLabels, SignalBadge, ScoreBar, fmt } from './src/components';

export default function App() {
  const [tab, setTab] = useState('picks'); // picks | watch | market | settings
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null); // holding being added/edited
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);
  const [movers, setMovers] = useState({ gainers: [], losers: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    const d = await loadData();
    setData(d);
    if (d.live) fetchMovers(d.api).then(setMovers).catch(() => {});
    return d;
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const ranked = useMemo(() => (data ? rankStocks(data.stocks) : []), [data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ranked;
    return ranked.filter(
      (s) =>
        s.symbol.toLowerCase().includes(q) ||
        (s.name || '').toLowerCase().includes(q) ||
        (s.sector || '').toLowerCase().includes(q)
    );
  }, [ranked, query]);

  // ---- watchlist mutations --------------------------------------------------
  const persistAndReload = useCallback(
    async (list) => {
      await saveWatchlist(list);
      await refresh();
    },
    [refresh]
  );

  const upsertHolding = useCallback(
    async (h) => {
      const list = await getWatchlist();
      const i = list.findIndex((x) => x.symbol.toUpperCase() === h.symbol.toUpperCase());
      const entry = {
        symbol: h.symbol.toUpperCase(),
        name: h.name || h.symbol.toUpperCase(),
        sector: h.sector || '—',
        support: Number(h.support) || 0,
        resistance: Number(h.resistance) || 0,
        fundamentals: {
          eps: Number(h.eps) || 0,
          pe: Number(h.pe) || 0,
          pb: Number(h.pb) || 0,
          roe: Number(h.roe) || 0,
        },
        alert: {
          cost: h.cost ? Number(h.cost) : undefined,
          above: Number(h.resistance) || undefined,
          below: Number(h.support) || undefined,
        },
        manualPrice: h.manualPrice != null && h.manualPrice !== '' ? String(h.manualPrice) : '',
      };
      if (i >= 0) list[i] = entry;
      else list.push(entry);
      setEditing(null);
      await persistAndReload(list);
    },
    [persistAndReload]
  );

  const removeHolding = useCallback(
    (symbol) => {
      Alert.alert('Remove holding', `Remove ${symbol} from your watchlist?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const list = (await getWatchlist()).filter((x) => x.symbol !== symbol);
            setSelected(null);
            await persistAndReload(list);
          },
        },
      ]);
    },
    [persistAndReload]
  );

  if (loading || !data) {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={styles.center}>
          <ActivityIndicator color={C.accent} size="large" />
          <Text style={{ color: C.textDim, marginTop: 12 }}>Connecting to NEPSE feed…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <Header index={data.index} live={data.live} />

      {selected ? (
        <Detail stock={selected} onBack={() => setSelected(null)} onEdit={() => setEditing(toForm(selected))} onRemove={removeHolding} />
      ) : (
        <>
          {tab === 'picks' && (
            <BestPicks
              list={filtered}
              query={query}
              setQuery={setQuery}
              onOpen={setSelected}
              refreshing={refreshing}
              onRefresh={onRefresh}
              error={data.error}
              live={data.live}
            />
          )}
          {tab === 'watch' && (
            <Watchlist
              list={ranked}
              index={data.index}
              onOpen={setSelected}
              onAdd={() => setEditing(blankForm())}
              onEdit={(s) => setEditing(toForm(s))}
              refreshing={refreshing}
              onRefresh={onRefresh}
            />
          )}
          {tab === 'market' && (
            <Market movers={movers} live={data.live} refreshing={refreshing} onRefresh={onRefresh} />
          )}
          {tab === 'settings' && <Settings data={data} onSaved={refresh} />}
          <TabBar tab={tab} setTab={setTab} watchCount={ranked.length} />
        </>
      )}

      <EditModal form={editing} onClose={() => setEditing(null)} onSave={upsertHolding} />
    </SafeAreaView>
  );
}

const blankForm = () => ({ symbol: '', name: '', sector: '', support: '', resistance: '', cost: '', manualPrice: '', eps: '', pe: '', pb: '', roe: '' });
const toForm = (s) => ({
  symbol: s.symbol,
  name: s.name,
  sector: s.sector,
  support: String(s.support ?? ''),
  resistance: String(s.resistance ?? ''),
  cost: s.watchlist && s.watchlist.cost ? String(s.watchlist.cost) : '',
  manualPrice: s.manualPrice != null ? String(s.manualPrice) : '',
  eps: s.fundamentals ? String(s.fundamentals.eps ?? '') : '',
  pe: s.fundamentals ? String(s.fundamentals.pe ?? '') : '',
  pb: s.fundamentals ? String(s.fundamentals.pb ?? '') : '',
  roe: s.fundamentals ? String(s.fundamentals.roe ?? '') : '',
});

// ---- Header -----------------------------------------------------------------
function Header({ index, live }) {
  const up = (index.changePct || 0) >= 0;
  return (
    <View style={styles.header}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <Text style={styles.brand}>NEPSE</Text>
          <Text style={styles.brandLight}> Analyzer</Text>
        </View>
        <View style={[styles.livePill, { borderColor: (live ? C.good : C.bad) + '66' }]}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: live ? C.good : C.bad, marginRight: 6 }} />
          <Text style={{ color: live ? C.good : C.bad, fontSize: 10, fontWeight: '700' }}>{live ? 'LIVE' : 'OFFLINE'}</Text>
        </View>
      </View>

      <View style={styles.indexRow}>
        <View>
          <Text style={styles.indexValue}>{fmt(index.value)}</Text>
          <Text style={[styles.indexChange, { color: up ? C.good : C.bad }]}>
            {index.value == null ? 'no data' : `${up ? '▲' : '▼'} ${Math.abs(index.changePct || 0).toFixed(2)}%`}
          </Text>
        </View>
        <View style={{ flex: 1, marginLeft: 18 }}>
          <BandGauge price={index.value} support={index.support} resistance={index.resistance} compact />
          <GaugeLabels price={index.value} support={index.support} resistance={index.resistance} />
        </View>
      </View>
    </View>
  );
}

// ---- Best Picks -------------------------------------------------------------
function BestPicks({ list, query, setQuery, onOpen, refreshing, onRefresh, error, live }) {
  return (
    <ScrollView
      style={styles.body}
      contentContainerStyle={{ paddingBottom: 96 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
    >
      <Text style={styles.sectionTitle}>Best picks</Text>
      <Text style={styles.sectionSub}>
        Your watchlist ranked by a 50 / 50 blend of fundamentals (accounting) and where the live price sits in its
        support–resistance band. Pull down to refresh.
      </Text>

      {!live && (
        <View style={styles.banner}>
          <Text style={styles.bannerTxt}>
            Feed offline{error ? ` — ${error}` : ''}. Prices show “—”. Check the API URL in Settings.
          </Text>
        </View>
      )}

      <TextInput
        style={styles.search}
        placeholder="Search symbol, name or sector…"
        placeholderTextColor={C.textFaint}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="characters"
        autoCorrect={false}
      />

      {list.map((s, i) => (
        <StockRow key={s.symbol} stock={s} rank={query ? null : i + 1} onPress={() => onOpen(s)} />
      ))}
      {list.length === 0 && <Text style={styles.empty}>No stocks match “{query}”.</Text>}
    </ScrollView>
  );
}

function StockRow({ stock, rank, onPress }) {
  const { score, signal } = stock;
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        {rank != null && (
          <View style={styles.rankBadge}>
            <Text style={styles.rankTxt}>{rank}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.symbol}>{stock.symbol}</Text>
          <Text style={styles.sub}>{stock.name} · {stock.sector}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.price}>Rs {fmt(stock.price)}</Text>
          <Text style={styles.scoreTag}>Score {score.total}</Text>
        </View>
      </View>
      <BandGauge price={stock.price} support={stock.support} resistance={stock.resistance} compact />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
        <SignalBadge signal={signal} small />
        <Text style={styles.miniStats}>
          P/E {fmt(stock.fundamentals.pe)}  ·  ROE {fmt(stock.fundamentals.roe)}%  ·  EPS {fmt(stock.fundamentals.eps)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ---- Watchlist --------------------------------------------------------------
function Watchlist({ list, index, onOpen, onAdd, onEdit, refreshing, onRefresh }) {
  return (
    <ScrollView
      style={styles.body}
      contentContainerStyle={{ paddingBottom: 96 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 }}>
        <Text style={[styles.sectionTitle, { marginTop: 0 }]}>Watchlist</Text>
        <TouchableOpacity style={styles.addBtn} onPress={onAdd} activeOpacity={0.8}>
          <Text style={styles.addBtnTxt}>+ Add</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.sectionSub}>Live prices vs your bands and alert thresholds. Tap a card to open, long-press “Edit” to tune.</Text>

      <IndexWatchCard index={index} />

      {list.map((s) => (
        <WatchRow key={s.symbol} stock={s} onPress={() => onOpen(s)} onEdit={() => onEdit(s)} />
      ))}
      {list.length === 0 && <Text style={styles.empty}>No watchlist items yet. Tap “+ Add”.</Text>}
    </ScrollView>
  );
}

function IndexWatchCard({ index }) {
  const hitAbove = index.value != null && index.value >= index.resistance;
  const hitBelow = index.value != null && index.value <= index.support;
  return (
    <View style={styles.row}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={styles.symbol}>NEPSE Index</Text>
        <Text style={styles.price}>{fmt(index.value)}</Text>
      </View>
      <Text style={styles.sub}>Alert above {fmt(index.resistance)} · below {fmt(index.support)}</Text>
      <View style={{ marginTop: 8 }}>
        <BandGauge price={index.value} support={index.support} resistance={index.resistance} compact />
      </View>
      {(hitAbove || hitBelow) && (
        <Text style={{ color: hitAbove ? C.good : C.bad, marginTop: 8, fontWeight: '700', fontSize: 12 }}>
          {hitAbove ? '▲ Above resistance — alert triggered' : '▼ Below support — alert triggered'}
        </Text>
      )}
    </View>
  );
}

function WatchRow({ stock, onPress, onEdit }) {
  const w = stock.watchlist || {};
  const pl = w.cost && stock.price != null ? ((stock.price - w.cost) / w.cost) * 100 : null;
  const hitAbove = w.above && stock.price != null && stock.price >= w.above;
  const hitBelow = w.below && stock.price != null && stock.price <= w.below;
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.symbol}>{stock.symbol}</Text>
          <Text style={styles.sub}>{stock.name}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.price}>Rs {fmt(stock.price)}</Text>
          {pl != null && (
            <Text style={{ color: pl >= 0 ? C.good : C.bad, fontSize: 12, fontWeight: '700' }}>
              {pl >= 0 ? '+' : ''}{pl.toFixed(1)}% vs cost
            </Text>
          )}
          <TouchableOpacity onPress={onEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ color: C.accent, fontSize: 12, fontWeight: '700', marginTop: 3 }}>Edit</Text>
          </TouchableOpacity>
        </View>
      </View>
      <BandGauge price={stock.price} support={stock.support} resistance={stock.resistance} compact />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <SignalBadge signal={stock.signal} small />
        <Text style={styles.miniStats}>
          {w.cost ? `Cost ${fmt(w.cost)} · ` : ''}Alert ▲{fmt(w.above)} ▼{fmt(w.below)}
        </Text>
      </View>
      {(hitAbove || hitBelow) && (
        <Text style={{ color: hitAbove ? C.good : C.bad, marginTop: 8, fontWeight: '700', fontSize: 12 }}>
          {hitAbove ? '▲ Alert: crossed above target' : '▼ Alert: dropped below target'}
        </Text>
      )}
    </TouchableOpacity>
  );
}

// ---- Market (live top movers) ----------------------------------------------
function Market({ movers, live, refreshing, onRefresh }) {
  return (
    <ScrollView
      style={styles.body}
      contentContainerStyle={{ paddingBottom: 96 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
    >
      <Text style={styles.sectionTitle}>Market movers</Text>
      <Text style={styles.sectionSub}>Live top gainers and losers from the feed — a discovery list for new band candidates.</Text>
      {!live && <View style={styles.banner}><Text style={styles.bannerTxt}>Feed offline. Connect in Settings to load movers.</Text></View>}

      <Text style={styles.moverHead}>Top gainers</Text>
      {movers.gainers.map((m) => <MoverRow key={'g' + m.symbol} m={m} positive />)}
      {movers.gainers.length === 0 && <Text style={styles.empty}>No data.</Text>}

      <Text style={[styles.moverHead, { marginTop: 18 }]}>Top losers</Text>
      {movers.losers.map((m) => <MoverRow key={'l' + m.symbol} m={m} />)}
      {movers.losers.length === 0 && <Text style={styles.empty}>No data.</Text>}
    </ScrollView>
  );
}

function MoverRow({ m, positive }) {
  return (
    <View style={styles.moverRow}>
      <Text style={[styles.symbol, { fontSize: 14 }]}>{m.symbol}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={[styles.price, { fontSize: 14, marginRight: 10 }]}>Rs {fmt(m.ltp)}</Text>
        <Text style={{ color: positive ? C.good : C.bad, fontWeight: '700', fontSize: 13, width: 64, textAlign: 'right' }}>
          {m.percentChange != null ? `${positive ? '+' : ''}${fmt(m.percentChange)}%` : '—'}
        </Text>
      </View>
    </View>
  );
}

// ---- Settings ---------------------------------------------------------------
function Settings({ data, onSaved }) {
  const [url, setUrl] = useState(data.api);
  const [sup, setSup] = useState(String(data.indexBand.support));
  const [res, setRes] = useState(String(data.indexBand.resistance));
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const test = async () => {
    setBusy(true);
    setStatus('Testing…');
    try {
      await setApiUrl(url);
      await pingApi(url.trim().replace(/\/+$/, ''));
      setStatus('✓ Connected — health check passed.');
    } catch (e) {
      setStatus('✗ ' + String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    await setApiUrl(url);
    await saveIndexBand({ support: Number(sup) || 0, resistance: Number(res) || 0 });
    await onSaved();
    setStatus('Saved.');
  };

  return (
    <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 96 }} keyboardShouldPersistTaps="handled">
      <Text style={styles.sectionTitle}>Settings</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>NEPSE API endpoint</Text>
        <TextInput style={styles.input} value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} placeholder={DEFAULT_API} placeholderTextColor={C.textFaint} />
        <Text style={styles.hint}>
          Base URL only (the app adds the rest). Default: {DEFAULT_API} — the app queries
          /api?symbol= for each stock in your watchlist. If the feed is down, set a Manual price per stock when you edit it.
        </Text>
        <View style={{ flexDirection: 'row', marginTop: 12 }}>
          <TouchableOpacity style={[styles.primaryBtn, { flex: 1, marginRight: 8, opacity: busy ? 0.6 : 1 }]} onPress={test} disabled={busy}>
            <Text style={styles.primaryBtnTxt}>Test connection</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.primaryBtn, { flex: 1, backgroundColor: C.good }]} onPress={save}>
            <Text style={styles.primaryBtnTxt}>Save</Text>
          </TouchableOpacity>
        </View>
        {status && <Text style={[styles.hint, { marginTop: 10, color: status.startsWith('✓') ? C.good : status.startsWith('✗') ? C.bad : C.textDim }]}>{status}</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>NEPSE index band</Text>
        <View style={{ flexDirection: 'row' }}>
          <Field label="Support" value={sup} onChange={setSup} />
          <View style={{ width: 12 }} />
          <Field label="Resistance" value={res} onChange={setRes} />
        </View>
        <Text style={styles.hint}>Used for the index gauge and the above/below alerts in your header.</Text>
      </View>

      <Text style={styles.disclaimer}>
        Data via the unofficial NepseAPI (educational / personal use only). Prices may be delayed or wrong. This is
        analysis tooling, not investment advice — verify against official NEPSE and company disclosures before trading.
      </Text>
    </ScrollView>
  );
}

// ---- Detail -----------------------------------------------------------------
function Detail({ stock, onBack, onEdit, onRemove }) {
  const score = compositeScore(stock);
  const signal = computeSignal(stock.price, stock.support, stock.resistance);
  const meta = SIGNAL_META[signal];
  const f = stock.fundamentals || {};
  const bandPos = stock.price != null ? ((stock.price - stock.support) / (stock.resistance - stock.support)) * 100 : null;

  return (
    <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, marginBottom: 8 }}>
        <TouchableOpacity onPress={onBack} activeOpacity={0.7}>
          <Text style={{ color: C.accent, fontWeight: '700' }}>‹ Back</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row' }}>
          <TouchableOpacity onPress={onEdit} style={{ marginRight: 16 }}><Text style={{ color: C.accent, fontWeight: '700' }}>Edit</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => onRemove(stock.symbol)}><Text style={{ color: C.bad, fontWeight: '700' }}>Remove</Text></TouchableOpacity>
        </View>
      </View>

      <Text style={styles.detailSymbol}>{stock.symbol}</Text>
      <Text style={styles.sub}>{stock.name} · {stock.sector}</Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14, marginBottom: 6 }}>
        <Text style={styles.detailPrice}>Rs {fmt(stock.price)}</Text>
        {stock.percentChange != null && (
          <Text style={{ color: stock.percentChange >= 0 ? C.good : C.bad, marginLeft: 10, fontWeight: '700' }}>
            {stock.percentChange >= 0 ? '▲' : '▼'} {fmt(Math.abs(stock.percentChange))}%
          </Text>
        )}
        <View style={{ marginLeft: 12 }}>
          <SignalBadge signal={signal} />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Support / resistance band</Text>
        <BandGauge price={stock.price} support={stock.support} resistance={stock.resistance} />
        <GaugeLabels price={stock.price} support={stock.support} resistance={stock.resistance} />
        <Text style={[styles.hint, { marginTop: 10 }]}>{meta.hint}</Text>
        {bandPos != null && bandPos >= 0 && bandPos <= 100 && (
          <Text style={styles.bandPos}>Price is {bandPos.toFixed(0)}% of the way from support to resistance.</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Scores</Text>
        <ScoreBar label="Composite" value={score.total} color={C.accent} />
        <ScoreBar label="Fundamentals (accounting)" value={score.quality} color={C.good} />
        <ScoreBar label="Technical (band position)" value={score.technical} color={C.gold} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Accounting snapshot</Text>
        <FundRow label="EPS" value={f.eps ? `Rs ${fmt(f.eps)}` : '—'} />
        <FundRow label="P/E ratio" value={f.pe ? fmt(f.pe) : '—'} />
        <FundRow label="P/B ratio" value={f.pb ? fmt(f.pb) : '—'} />
        <FundRow label="Return on equity" value={f.roe ? `${fmt(f.roe)}%` : '—'} />
        <Text style={styles.hint}>These are entered by you per holding (the feed carries price, not fundamentals). Tap Edit to update.</Text>
      </View>

      <Text style={styles.disclaimer}>
        Analysis tooling, not investment advice. Verify figures against official NEPSE and company disclosures before trading.
      </Text>
    </ScrollView>
  );
}

function FundRow({ label, value }) {
  return (
    <View style={styles.fundRow}>
      <Text style={styles.fundLabel}>{label}</Text>
      <Text style={styles.fundValue}>{value}</Text>
    </View>
  );
}

// ---- Edit / Add modal -------------------------------------------------------
function EditModal({ form, onClose, onSave }) {
  const [f, setF] = useState(form || {});
  useEffect(() => setF(form || {}), [form]);
  if (!form) return null;
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const canSave = (f.symbol || '').trim() && Number(f.support) > 0 && Number(f.resistance) > Number(f.support);

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <View style={styles.sheet}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <Text style={styles.sheetTitle}>{form.symbol ? `Edit ${form.symbol}` : 'Add holding'}</Text>
            <TouchableOpacity onPress={onClose}><Text style={{ color: C.textDim, fontSize: 16 }}>✕</Text></TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 440 }}>
            <View style={{ flexDirection: 'row' }}>
              <Field label="Symbol *" value={f.symbol} onChange={set('symbol')} caps />
              <View style={{ width: 12 }} />
              <Field label="Sector" value={f.sector} onChange={set('sector')} />
            </View>
            <Field label="Company name" value={f.name} onChange={set('name')} />
            <View style={{ flexDirection: 'row' }}>
              <Field label="Support *" value={f.support} onChange={set('support')} numeric />
              <View style={{ width: 12 }} />
              <Field label="Resistance *" value={f.resistance} onChange={set('resistance')} numeric />
            </View>
            <View style={{ flexDirection: 'row' }}>
              <Field label="Buy / cost price (optional)" value={f.cost} onChange={set('cost')} numeric />
              <View style={{ width: 12 }} />
              <Field label="Manual price (if feed down)" value={f.manualPrice} onChange={set('manualPrice')} numeric />
            </View>
            <Text style={[styles.cardTitle, { marginTop: 8 }]}>Accounting (optional)</Text>
            <View style={{ flexDirection: 'row' }}>
              <Field label="EPS" value={f.eps} onChange={set('eps')} numeric />
              <View style={{ width: 12 }} />
              <Field label="P/E" value={f.pe} onChange={set('pe')} numeric />
            </View>
            <View style={{ flexDirection: 'row' }}>
              <Field label="P/B" value={f.pb} onChange={set('pb')} numeric />
              <View style={{ width: 12 }} />
              <Field label="ROE %" value={f.roe} onChange={set('roe')} numeric />
            </View>
          </ScrollView>
          <TouchableOpacity
            style={[styles.primaryBtn, { marginTop: 14, opacity: canSave ? 1 : 0.5 }]}
            disabled={!canSave}
            onPress={() => onSave(f)}
          >
            <Text style={styles.primaryBtnTxt}>{form.symbol ? 'Save changes' : 'Add to watchlist'}</Text>
          </TouchableOpacity>
          {!canSave && <Text style={[styles.hint, { textAlign: 'center' }]}>Symbol, support and resistance (resistance &gt; support) are required.</Text>}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({ label, value, onChange, numeric, caps }) {
  return (
    <View style={{ flex: 1, marginBottom: 10 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value == null ? '' : String(value)}
        onChangeText={onChange}
        keyboardType={numeric ? 'numeric' : 'default'}
        autoCapitalize={caps ? 'characters' : 'none'}
        autoCorrect={false}
        placeholderTextColor={C.textFaint}
      />
    </View>
  );
}

// ---- Tab bar ----------------------------------------------------------------
function TabBar({ tab, setTab, watchCount }) {
  return (
    <View style={styles.tabBar}>
      <TabButton active={tab === 'picks'} label="Picks" onPress={() => setTab('picks')} />
      <TabButton active={tab === 'watch'} label={`Watch (${watchCount})`} onPress={() => setTab('watch')} />
      <TabButton active={tab === 'market'} label="Market" onPress={() => setTab('market')} />
      <TabButton active={tab === 'settings'} label="Settings" onPress={() => setTab('settings')} />
    </View>
  );
}

function TabButton({ active, label, onPress }) {
  return (
    <TouchableOpacity style={styles.tabBtn} onPress={onPress} activeOpacity={0.7}>
      <Text style={{ color: active ? C.text : C.textFaint, fontWeight: active ? '800' : '600', fontSize: 12.5 }}>{label}</Text>
      {active && <View style={styles.tabUnderline} />}
    </TouchableOpacity>
  );
}

// ---- Styles -----------------------------------------------------------------
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bgGrad },
  brand: { color: C.text, fontSize: 20, fontWeight: '900', letterSpacing: 1 },
  brandLight: { color: C.accent, fontSize: 20, fontWeight: '300', letterSpacing: 1 },
  livePill: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  indexRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  indexValue: { color: C.text, fontSize: 26, fontWeight: '800', fontVariant: ['tabular-nums'] },
  indexChange: { fontSize: 13, fontWeight: '700', marginTop: 2 },

  body: { flex: 1, paddingHorizontal: 16 },
  sectionTitle: { color: C.text, fontSize: 18, fontWeight: '800', marginTop: 18 },
  sectionSub: { color: C.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 4, marginBottom: 12 },
  search: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, color: C.text, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 14, fontSize: 14 },
  banner: { backgroundColor: C.bad + '1A', borderWidth: 1, borderColor: C.bad + '55', borderRadius: 12, padding: 10, marginBottom: 12 },
  bannerTxt: { color: C.bad, fontSize: 12, lineHeight: 17 },

  row: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14, marginBottom: 12 },
  rankBadge: { width: 24, height: 24, borderRadius: 12, backgroundColor: C.cardAlt, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  rankTxt: { color: C.textDim, fontWeight: '800', fontSize: 12 },
  symbol: { color: C.text, fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  sub: { color: C.textDim, fontSize: 12, marginTop: 2 },
  price: { color: C.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  scoreTag: { color: C.textFaint, fontSize: 11, marginTop: 2 },
  miniStats: { color: C.textFaint, fontSize: 11, fontVariant: ['tabular-nums'] },
  empty: { color: C.textFaint, textAlign: 'center', marginTop: 24 },
  addBtn: { backgroundColor: C.accent, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  addBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },

  moverHead: { color: C.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8, marginTop: 4 },
  moverRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 8 },

  back: { marginTop: 14, marginBottom: 8 },
  detailSymbol: { color: C.text, fontSize: 26, fontWeight: '900', letterSpacing: 0.5 },
  detailPrice: { color: C.text, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
  card: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 16, marginTop: 14 },
  cardTitle: { color: C.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 },
  hint: { color: C.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 8 },
  bandPos: { color: C.textFaint, fontSize: 12, marginTop: 6 },
  fundRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.border },
  fundLabel: { color: C.textDim, fontSize: 13 },
  fundValue: { color: C.text, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  disclaimer: { color: C.textFaint, fontSize: 11, lineHeight: 16, marginTop: 18, fontStyle: 'italic' },

  input: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10, color: C.text, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
  fieldLabel: { color: C.textDim, fontSize: 11, marginBottom: 5, fontWeight: '600' },
  primaryBtn: { backgroundColor: C.accent, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  primaryBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },

  sheet: { backgroundColor: C.bgGrad, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, borderTopWidth: 1, borderColor: C.border },
  sheetTitle: { color: C.text, fontSize: 17, fontWeight: '800' },

  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bgGrad, position: 'absolute', left: 0, right: 0, bottom: 0 },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 13 },
  tabUnderline: { height: 3, width: 26, borderRadius: 2, backgroundColor: C.accent, marginTop: 5 },
});
