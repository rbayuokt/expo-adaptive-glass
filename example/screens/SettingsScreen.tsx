import {
  GlassSlider,
  GlassSurface,
  GlassSwitch,
  type GlassQuality,
} from '@rbayuokt/expo-adaptive-glass';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useGlassSettings, type ThemeChoice } from '../components/GlassSettings';
import { Pills } from '../components/Pills';
import { Screen, Section } from '../components/Screen';
import { useTheme } from '../theme';
import { AboutSection } from './AboutSection';

const THEMES: readonly ThemeChoice[] = ['system', 'light', 'dark'];
const QUALITIES: readonly GlassQuality[] = ['auto', 'ultra', 'high', 'medium', 'low', 'minimal'];

export function SettingsScreen() {
  const theme = useTheme();
  const { settings, update } = useGlassSettings();
  const t = { color: theme.text };
  const muted = { color: theme.muted };
  const clear = settings.clarity >= 0.5;

  return (
    <Screen
      title="Settings"
      subtitle="Everything here goes to GlassProvider and applies to the whole app.">
      <Section title="Glass">
        <GlassSurface priority="high" style={styles.card}>
          <Text style={[styles.label, t]}>Theme</Text>
          <Pills
            options={THEMES}
            value={settings.theme}
            onChange={(theme) => update({ theme })}
            label={(v) => v[0].toUpperCase() + v.slice(1)}
          />
          <Text style={[styles.label, t]}>Appearance</Text>
          <View style={styles.presets}>
            {(['Tinted', 'Clear'] as const).map((name) => {
              const active = (name === 'Clear') === clear;
              return (
                <Pressable
                  key={name}
                  style={styles.preset}
                  onPress={() => update({ clarity: name === 'Clear' ? 1 : 0 })}>
                  <GlassSurface
                    priority="high"
                    cornerRadius={16}
                    tint={active ? theme.accent : 'system'}
                    intensity={active ? 0.9 : 0.4}
                    style={styles.presetGlass}>
                    <Text style={[styles.presetText, { color: active ? '#fff' : theme.text }]}>
                      {name}
                    </Text>
                  </GlassSurface>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.row}>
            <Text style={[styles.label, t]}>Clarity</Text>
            <Text style={[styles.value, t]}>{Math.round(settings.clarity * 100)}%</Text>
          </View>
          <GlassSlider
            value={settings.clarity}
            step={0.05}
            fillColor={theme.accent}
            onValueChange={(clarity) => update({ clarity })}
          />
          <View style={styles.row}>
            <Text style={[styles.hint, muted]}>Frosted</Text>
            <Text style={[styles.hint, muted]}>Clear</Text>
          </View>
          <Text style={[styles.hint, muted]}>
            Less tint and blur as it goes up. From 50% iOS 26 uses Apple's clear glass.
          </Text>
        </GlassSurface>
      </Section>

      <Section title="Quality">
        <Pills
          options={QUALITIES}
          value={settings.quality}
          onChange={(quality) => update({ quality })}
        />
      </Section>

      <Section title="Performance">
        <GlassSurface priority="high" style={styles.card}>
          <Toggle
            label="Adapt to frame rate"
            hint="Drops a tier when frames get slow, climbs back when they recover."
            value={settings.adaptivePerformance}
            onChange={(adaptivePerformance) => update({ adaptivePerformance })}
          />
          <Toggle
            label="Respect Low Power Mode"
            hint="Uses cheaper glass while the battery saver is on."
            value={settings.respectLowPowerMode}
            onChange={(respectLowPowerMode) => update({ respectLowPowerMode })}
          />
          <Toggle
            label="Respect Reduce Transparency"
            hint="Opaque surfaces when the accessibility setting is on."
            value={settings.respectReduceTransparency}
            onChange={(respectReduceTransparency) => update({ respectReduceTransparency })}
          />
        </GlassSurface>
      </Section>

      <AboutSection />
    </Screen>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.toggle}>
      <View style={styles.toggleText}>
        <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
        <Text style={[styles.hint, { color: theme.muted }]}>{hint}</Text>
      </View>
      <GlassSwitch value={value} onValueChange={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 18, gap: 10 },
  label: { fontSize: 16, fontWeight: '600' },
  value: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  hint: { fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  presets: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  preset: { flex: 1 },
  presetGlass: { paddingVertical: 12, alignItems: 'center' },
  presetText: { fontSize: 15, fontWeight: '700' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  toggleText: { flex: 1, gap: 2 },
});
