import { GlassSurface, getGlassDeviceInfo, useGlassPerformance } from '@rbayuokt/expo-adaptive-glass';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Screen, Section } from '../components/Screen';
import { useTheme } from '../theme';

export function InspectorScreen() {
  const d = getGlassDeviceInfo();
  const m = useGlassPerformance();
  const theme = useTheme();

  const device: [string, string][] = d
    ? [
        ['platform', d.platform],
        [
          'OS version',
          `${d.osVersion} (${d.platform === 'android' ? `API ${d.apiLevel}` : `iOS ${d.apiLevel}`})`,
        ],
        ['RAM', `${(d.totalMemoryMB / 1024).toFixed(1)} GB`],
        ['low-RAM device', String(d.lowRamDevice)],
        ['CPU cores', String(d.cpuCores)],
        ['performance class', d.performanceClass ? String(d.performanceClass) : 'not declared'],
        [
          'screen',
          `${Math.round(d.screenWidth)} × ${Math.round(d.screenHeight)} @${d.screenScale}x`,
        ],
        ['max refresh', `${d.maxRefreshRate} Hz`],
        ['system glass', String(d.supportsSystemGlass)],
        ['live blur', String(d.supportsLiveBlur)],
        ['AGSL shader', String(d.supportsShader)],
      ]
    : [['native module', 'missing (Expo Go or web)']];

  const runtime: [string, string][] = [
    ['device score', String(m.deviceScore)],
    ['renderer', m.renderer],
    ['quality', `${m.quality} (requested ${m.requestedQuality})`],
    ['thermal state', m.thermalState],
    ['power saving', String(m.lowPowerMode)],
    ['low memory', String(m.lowMemory)],
    ['visible surfaces', `${m.visibleSurfaceCount} (${m.liveSurfaceCount} live)`],
    ['glass area', `${m.visibleGlassArea} pt² (${(m.surfaceCoverage * 100).toFixed(0)}%)`],
    ['refresh now', `${m.refreshRate} Hz`],
    ['frame', `${m.averageFrameTimeMs} ms avg / ${m.targetFrameTimeMs} ms budget`],
    ['dropped', `${(m.droppedFrameRatio * 100).toFixed(1)}%`],
    ['downgrade', m.downgradeReason ?? 'none'],
  ];

  const table = (rows: [string, string][]) => (
    <GlassSurface priority="high" style={styles.table}>
      {rows.map(([k, v]) => (
        <View key={k} style={styles.row}>
          <Text style={{ color: theme.muted }}>{k}</Text>
          <Text style={[styles.value, { color: theme.text }]}>{v}</Text>
        </View>
      ))}
    </GlassSurface>
  );

  return (
    <Screen title="Inspector" subtitle="What the quality manager sees.">
      <Section title="Device">{table(device)}</Section>
      <Section title="Runtime">{table(runtime)}</Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  table: { padding: 16, gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  value: { fontWeight: '600', flexShrink: 1, textAlign: 'right' },
});
