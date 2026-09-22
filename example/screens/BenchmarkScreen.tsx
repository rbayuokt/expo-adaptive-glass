import {
  GlassSurface,
  getGlassDeviceInfo,
  useGlassPerformance,
  type GlassPerformanceMetrics,
  type GlassQuality,
} from '@rbayuokt/expo-adaptive-glass';
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
// lets the tier settle after the surfaces change before sampling
const WARMUP_MS = 2_000;

interface Result {
  platform: string;
  os: string;
  mode: Mode;
  count: number;
  // counted from native, the tiles' own quality prop doesn't show in the app-wide state
  liveSurfaces: number;
  visibleSurfaces: number;
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
  const [queue, setQueue] = useState<[Mode, (typeof COUNTS)[number]][]>([]);
  const samples = useRef<GlassPerformanceMetrics[]>([]);
  const sampling = useRef(false);
  const m = useGlassPerformance();

  useEffect(() => {
    if (sampling.current && m.averageFrameTimeMs > 0) samples.current.push(m);
  }, [m]);

  // runs the queued configurations one after another
  useEffect(() => {
    if (running || queue.length === 0) return;
    const [[nextMode, nextCount], ...rest] = queue;
    setMode(nextMode);
    setCount(nextCount);
    setQueue(rest);
    start(nextMode, nextCount);
  }, [queue, running]);

  const runAll = () => {
    const all: [Mode, (typeof COUNTS)[number]][] = [];
    for (const md of Object.keys(MODES) as Mode[]) for (const c of COUNTS) all.push([md, c]);
    setResults([]);
    setQueue(all);
  };

  const start = (mode: Mode, count: number) => {
    samples.current = [];
    setRunning(true);
    setTimeout(() => {
      sampling.current = true;
    }, WARMUP_MS);
    setTimeout(() => {
      sampling.current = false;
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
        liveSurfaces: Math.round(avg((x) => x.liveSurfaceCount)),
        visibleSurfaces: Math.round(avg((x) => x.visibleSurfaceCount)),
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
    }, WARMUP_MS + DURATION_MS);
  };

  const quality: GlassQuality = MODES[mode];
  return (
    <Screen
      title="Benchmark"
      subtitle="Runs 10 s over the animated backdrop after a 2 s warm-up. Run all walks every renderer and count. Results are logged as JSON."
      animated>
      <Section title="Surfaces">
        <Pills options={COUNTS} value={count} onChange={setCount} />
      </Section>
      <Section title="Renderer">
        <Pills options={Object.keys(MODES) as Mode[]} value={mode} onChange={setMode} />
      </Section>
      <View style={styles.buttons}>
        <Pressable style={styles.button} disabled={running} onPress={() => start(mode, count)}>
          <GlassSurface priority="critical" interactive tint={theme.accent} style={styles.run}>
            <Text style={styles.runText}>{running ? 'Running…' : 'Run 10 s'}</Text>
          </GlassSurface>
        </Pressable>
        <Pressable style={styles.button} disabled={running || queue.length > 0} onPress={runAll}>
          <GlassSurface priority="critical" interactive tint={theme.accent} style={styles.run}>
            <Text style={styles.runText}>
              {queue.length > 0 || running ? `${queue.length} left` : 'Run all'}
            </Text>
          </GlassSurface>
        </Pressable>
      </View>
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
                {r.count}× {r.mode} → {r.liveSurfaces}/{r.visibleSurfaces} live · {r.avgFps} fps ·{' '}
                {r.avgFrameMs} ms · {r.droppedPct}% dropped
              </Text>
            ))}
          </GlassSurface>
        </Section>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  buttons: { flexDirection: 'row', gap: 10 },
  button: { flex: 1 },
  run: { paddingVertical: 14, alignItems: 'center' },
  runText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: 60, height: 60 },
  results: { padding: 14, gap: 6 },
  result: { fontSize: 12, fontVariant: ['tabular-nums'] },
});
