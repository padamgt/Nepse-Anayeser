import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C } from './theme';
import { SIGNAL_META, computeSignal } from './signals';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ---- BandGauge: the signature element ---------------------------------------
// A horizontal track. Support and resistance mark the band; the dot is the last
// price. Left of support = breakdown zone (red), inside = the band (gold), right
// of resistance = breakout zone (green).
export function BandGauge({ price, support, resistance, compact }) {
  const band = resistance - support || 1;
  const lo = support - band * 0.4;
  const hi = resistance + band * 0.4;
  const span = hi - lo;
  const pct = (v) => clamp01((v - lo) / span);

  const sP = pct(support);
  const rP = pct(resistance);
  const hasPrice = price != null && !isNaN(price);
  const pP = pct(price);
  const sig = computeSignal(price, support, resistance);
  const markerColor = SIGNAL_META[sig].color;

  const h = compact ? 8 : 12;
  const containerH = compact ? 16 : 22;
  const dot = compact ? 12 : 16;

  return (
    <View style={{ position: 'relative', height: containerH, justifyContent: 'center' }}>
      <View style={{ height: h, borderRadius: h / 2, backgroundColor: C.track, overflow: 'hidden' }}>
        <View style={[styles.zone, { left: 0, width: `${sP * 100}%`, backgroundColor: 'rgba(214,72,59,0.30)' }]} />
        <View style={[styles.zone, { left: `${sP * 100}%`, width: `${(rP - sP) * 100}%`, backgroundColor: 'rgba(201,154,58,0.22)' }]} />
        <View style={[styles.zone, { left: `${rP * 100}%`, right: 0, backgroundColor: 'rgba(31,181,122,0.28)' }]} />
      </View>

      {/* support / resistance ticks */}
      <View style={[styles.tick, { left: `${sP * 100}%` }]} />
      <View style={[styles.tick, { left: `${rP * 100}%` }]} />

      {/* last price marker */}
      {hasPrice && (
        <View
          style={{
            position: 'absolute',
            left: `${pP * 100}%`,
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            marginLeft: -dot / 2,
            backgroundColor: markerColor,
            borderWidth: 2,
            borderColor: C.bg,
          }}
        />
      )}
    </View>
  );
}

export function GaugeLabels({ price, support, resistance }) {
  return (
    <View style={styles.labelRow}>
      <Text style={styles.labelTxt}>S {fmt(support)}</Text>
      <Text style={[styles.labelTxt, { color: C.text }]}>LTP {fmt(price)}</Text>
      <Text style={styles.labelTxt}>R {fmt(resistance)}</Text>
    </View>
  );
}

// ---- SignalBadge ------------------------------------------------------------
export function SignalBadge({ signal, small }) {
  const m = SIGNAL_META[signal];
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: small ? 8 : 10,
        paddingVertical: small ? 3 : 5,
        borderRadius: 999,
        backgroundColor: m.color + '22',
        borderWidth: 1,
        borderColor: m.color + '66',
      }}
    >
      <Text style={{ color: m.color, fontWeight: '700', fontSize: small ? 10 : 12, letterSpacing: 0.4 }}>
        {m.label.toUpperCase()}
      </Text>
    </View>
  );
}

// ---- ScoreBar ---------------------------------------------------------------
export function ScoreBar({ label, value, color }) {
  return (
    <View style={{ marginVertical: 5 }}>
      <View style={styles.scoreHead}>
        <Text style={styles.scoreLabel}>{label}</Text>
        <Text style={[styles.scoreVal, { color: color || C.text }]}>{value}</Text>
      </View>
      <View style={styles.scoreTrack}>
        <View style={{ height: 6, borderRadius: 3, width: `${value}%`, backgroundColor: color || C.accent }} />
      </View>
    </View>
  );
}

export function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 });
}

const styles = StyleSheet.create({
  zone: { position: 'absolute', top: 0, bottom: 0 },
  tick: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: 'rgba(232,237,245,0.45)' },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  labelTxt: { color: C.textFaint, fontSize: 11, fontVariant: ['tabular-nums'] },
  scoreHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  scoreLabel: { color: C.textDim, fontSize: 12 },
  scoreVal: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  scoreTrack: { height: 6, borderRadius: 3, backgroundColor: C.track, overflow: 'hidden' },
});
