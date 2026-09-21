import {
  GlassSurface,
  useGlassCapabilities,
  useGlassQuality,
  type GlassQuality,
} from '@rbayuokt/expo-adaptive-glass';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Pills } from '../components/Pills';
import { useGlassSettings } from '../components/GlassSettings';
import { Screen, Section } from '../components/Screen';
import { useTheme } from '../theme';

const OPTIONS: readonly GlassQuality[] = ['auto', 'ultra', 'high', 'medium', 'low', 'minimal'];

export function QualityScreen() {
  const { settings, update } = useGlassSettings();
  const { quality } = settings;
  const setQuality = (q: GlassQuality) => update({ quality: q });
  const state = useGlassQuality();
  const caps = useGlassCapabilities();
  const theme = useTheme();
  const t = { color: theme.text };
  return (
    <Screen
      title="Quality"
      subtitle="Pins the provider to a tier. Platform limits still apply, so ultra never runs AGSL where it is unavailable.">
      <Pills options={OPTIONS} value={quality} onChange={setQuality} />
      <GlassSurface interactive priority="critical" style={styles.hero}>
        <Text style={[styles.big, t]}>{state.quality}</Text>
        <Text style={[styles.renderer, t]}>renderer: {state.renderer}</Text>
      </GlassSurface>
      <Section title="Capabilities">
        <GlassSurface style={styles.table}>
          {Object.entries(caps).map(([k, v]) => (
            <View key={k} style={styles.row}>
              <Text style={{ color: theme.muted }}>{k}</Text>
              <Text style={[styles.value, t]}>{String(v)}</Text>
            </View>
          ))}
        </GlassSurface>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { height: 200, alignItems: 'center', justifyContent: 'center', gap: 6 },
  big: { fontSize: 40, fontWeight: '800' },
  renderer: { fontSize: 16, fontWeight: '600' },
  table: { padding: 16, gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  value: { fontWeight: '600' },
});
