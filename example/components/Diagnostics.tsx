import { GlassSurface, useGlassPerformance } from '@rbayuokt/expo-adaptive-glass';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme';

export function Diagnostics({ compact = false }: { compact?: boolean }) {
  const m = useGlassPerformance();
  const theme = useTheme();
  const rows: [string, string][] = [
    ['quality', m.quality],
    ['renderer', m.renderer],
    ['surfaces', `${m.visibleSurfaceCount} (${m.liveSurfaceCount} live)`],
    [
      'glass area',
      `${m.visibleGlassArea.toLocaleString()} pt² · ${(m.surfaceCoverage * 100).toFixed(0)}%`,
    ],
    ['fps', `~${m.approximateFps} / ${m.refreshRate} Hz`],
    [
      'frame',
      `${m.averageFrameTimeMs} ms avg · ${m.worstRecentFrameTimeMs} worst · ${m.targetFrameTimeMs} budget`,
    ],
    ['dropped', `${(m.droppedFrameRatio * 100).toFixed(1)}%`],
    ['scroll', m.scrollState],
    ['reason', m.downgradeReason ?? '—'],
  ];
  const shown = compact
    ? rows.filter(([k]) => ['quality', 'renderer', 'surfaces', 'fps', 'reason'].includes(k))
    : rows;
  return (
    <GlassSurface priority="critical" cornerRadius={18} style={styles.panel}>
      {!m.nativeAvailable && (
        <Text style={[styles.warn]}>Native module missing: use a development build.</Text>
      )}
      {shown.map(([k, v]) => (
        <View key={k} style={styles.row}>
          <Text style={[styles.key, { color: theme.muted }]}>{k}</Text>
          <Text style={[styles.value, { color: theme.text }]} numberOfLines={1}>
            {v}
          </Text>
        </View>
      ))}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  panel: { padding: 12, gap: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  // fixed line height: if the panel's height wobbles per update, Fabric blanks the FlatList
  // below it for a frame on iOS
  key: { fontSize: 12, lineHeight: 16, fontVariant: ['tabular-nums'] },
  value: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  warn: { color: '#ff453a', fontSize: 12, marginBottom: 4 },
});
