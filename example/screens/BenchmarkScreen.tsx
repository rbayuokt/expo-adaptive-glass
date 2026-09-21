import {
  GlassSurface,
  getGlassDeviceInfo,
  useGlassPerformance,
  type GlassPerformanceMetrics,
  type GlassQuality,
} from 'expo-adaptive-glass';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Diagnostics } from '../components/Diagnostics';
import { Pills } from '../components/Pills';
import { Screen, Section } from '../components/Screen';
import { useTheme } from '../theme';

const COUNTS = [1, 5, 10, 20, 30] as const;
// ultra: best renderer, medium: plain native blur, low: acrylic
const MODES = { auto: 'auto', best: 'ultra', blur: 'medium', acrylic: 'low' } as const;
type Mode = keyof typeof MODES;
const DURATION_MS = 10_000;

interface Result {
  platform: string;
  os: string;
  mode: Mode;
  count: number;
  renderer: string;
  quality: string;
  avgFps: number;
  avgFrameMs: number;
  worstFrameMs: number;
  droppedPct: number;
  glassArea: number;
  downgradeReason: string | null;
}

export function BenchmarkScreen() {
  const theme = useTheme();
  const [count, setCount] = useState<(typeof COUNTS)[number]>(10);
  const [mode, setMode] = useState<Mode>('auto');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const samples = useRef<GlassPerformanceMetrics[]>([]);
  const m = useGlassPerformance();

  useEffect(() => {
    if (running && m.averageFrameTimeMs > 0) samples.current.push(m);
  }, [m, running]);

  const start = () => {
    samples.current = [];
    setRunning(true);
    setTimeout(() => {
      setRunning(false);
      const s = samples.current;
      if (!s.length) return;
      const avg = (f: (x: GlassPerformanceMetrics) => number) =>
        s.reduce((a, x) => a + f(x), 0) / s.length;
      const last = s[s.length - 1];
      const d = getGlassDeviceInfo();
      const r: Result = {
        platform: Platform.OS,
        os: d?.osVersion ?? String(Platform.Version),
        mode,
        count,
        renderer: last.renderer,
        quality: last.quality,
        avgFps: Math.round(avg((x) => x.approximateFps)),
        avgFrameMs: Math.round(avg((x) => x.averageFrameTimeMs) * 100) / 100,
        worstFrameMs: Math.max(...s.map((x) => x.worstRecentFrameTimeMs)),
        droppedPct: Math.round(avg((x) => x.droppedFrameRatio) * 1000) / 10,
        glassArea: Math.round(avg((x) => x.visibleGlassArea)),
        downgradeReason: last.downgradeReason,
      };
      // paste these rows into the README benchmark table
      console.log('[benchmark]', JSON.stringify(r));
      setResults((rs) => [r, ...rs]);
    }, DURATION_MS);
  };

  const quality: GlassQuality = MODES[mode];
  return (
    <Screen
      title="Benchmark"
      subtitle="Runs 10 s over the animated backdrop. Results are logged as JSON for the README table."
      animated>
      <Section title="Surfaces">
        <Pills options={COUNTS} value={count} onChange={setCount} />
      </Section>
      <Section title="Renderer">
        <Pills options={Object.keys(MODES) as Mode[]} value={mode} onChange={setMode} />
      </Section>
      <Pressable disabled={running} onPress={start}>
        <GlassSurface priority="critical" interactive tint={theme.accent} style={styles.run}>
          <Text style={styles.runText}>{running ? 'Running…' : 'Run 10 s'}</Text>
        </GlassSurface>
      </Pressable>
      <Diagnostics />
      <View style={styles.grid}>
        {Array.from({ length: count }, (_, i) => (
          <GlassSurface
            key={i}
            quality={quality}
            interactive
            cornerRadius={14}
            style={styles.tile}
          />
        ))}
      </View>
      {results.length > 0 && (
        <Section title="Results">
          <GlassSurface priority="high" style={styles.results}>
            {results.map((r, i) => (
              <Text key={i} style={[styles.result, { color: theme.text }]}>
                {r.count}× {r.mode} → {r.renderer}/{r.quality} · {r.avgFps} fps · {r.avgFrameMs} ms
                · {r.droppedPct}% dropped
              </Text>
            ))}
          </GlassSurface>
        </Section>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  run: { paddingVertical: 14, alignItems: 'center' },
  runText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: 60, height: 60 },
  results: { padding: 14, gap: 6 },
  result: { fontSize: 12, fontVariant: ['tabular-nums'] },
});
