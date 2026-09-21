import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { GlassSurface, GlassTabBar } from 'expo-adaptive-glass';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Diagnostics } from '../components/Diagnostics';
import { Screen, Section } from '../components/Screen';
import { useTheme } from '../theme';

export function BasicsScreen() {
  const theme = useTheme();
  const [presses, setPresses] = useState(0);
  const [touching, setTouching] = useState(false);
  const [tab, setTab] = useState(0);
  const t = { color: theme.text };

  return (
    <Screen title="Basics" subtitle="Default surfaces, no configuration beyond priority and tint.">
      <Section title="Card">
        <GlassSurface priority="high" style={styles.card}>
          <Text style={[styles.h, t]}>Hello Glass</Text>
          <Text style={[styles.p, { color: theme.muted }]}>
            A GlassSurface with default intensity, radius and system tint. Children are ordinary
            React Native views.
          </Text>
          <View style={styles.row}>
            <Image source={{ uri: 'https://picsum.photos/id/1025/200' }} style={styles.avatar} />
            <Text style={[styles.p, t]}>expo-image inside glass</Text>
          </View>
        </GlassSurface>
      </Section>

      <Section title="Button">
        <Pressable onPress={() => setPresses((n) => n + 1)}>
          <GlassSurface priority="high" interactive cornerRadius={22} style={styles.button}>
            <Text style={[styles.buttonText, t]}>Pressed {presses}×</Text>
          </GlassSurface>
        </Pressable>
      </Section>

      <Section title="Tab bar">
        <GlassTabBar selectedIndex={tab} onSelect={setTab}>
          {TABS.map(([icon, label], i) => {
            const color = i === tab ? theme.accent : theme.text;
            return (
              <View key={label} style={styles.tabItem}>
                <Ionicons name={icon} size={22} color={color} />
                <Text style={[styles.tabLabel, { color }]}>{label}</Text>
              </View>
            );
          })}
        </GlassTabBar>
        <Text style={[styles.p, { color: theme.muted }]}>
          Hold a tab to lift the lens, drag it across, let go on another tab.
        </Text>
      </Section>

      <Section title="Custom tint">
        <View style={styles.row}>
          {['#ff375f', '#30d158', '#0a84ff', '#ffd60a'].map((c) => (
            <GlassSurface key={c} tint={c} intensity={0.5} cornerRadius={20} style={styles.swatch}>
              <Text style={[styles.swatchText, t]}>{c}</Text>
            </GlassSurface>
          ))}
        </View>
        <View style={styles.row}>
          <GlassSurface tint="light" style={styles.half}>
            <Text style={styles.darkText}>tint="light"</Text>
          </GlassSurface>
          <GlassSurface tint="dark" style={styles.half}>
            <Text style={styles.lightText}>tint="dark"</Text>
          </GlassSurface>
        </View>
      </Section>

      <Section title="Interactive surface">
        <GlassSurface
          interactive
          priority="high"
          intensity={0.4}
          cornerRadius={32}
          onInteractionStart={() => setTouching(true)}
          onInteractionEnd={() => setTouching(false)}
          style={styles.interactive}>
          <Text style={[styles.h, t]}>{touching ? 'Touching' : 'Touch and drag'}</Text>
          <Text style={[styles.p, { color: theme.muted }]}>
            The highlight follows your finger natively. JS only hears start and end.
          </Text>
        </GlassSurface>
      </Section>

      <Diagnostics compact />
    </Screen>
  );
}

const TABS = [
  ['home', 'Home'],
  ['search', 'Search'],
  ['library', 'Library'],
  ['person', 'Profile'],
] as const;

const styles = StyleSheet.create({
  card: { padding: 20, gap: 10 },
  h: { fontSize: 20, fontWeight: '700' },
  p: { fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  button: { paddingVertical: 16, alignItems: 'center' },
  buttonText: { fontSize: 17, fontWeight: '700' },
  tabItem: { alignItems: 'center', gap: 2 },
  tabLabel: { fontSize: 11, fontWeight: '600' },
  swatch: { width: 76, height: 76, alignItems: 'center', justifyContent: 'center' },
  swatchText: { fontSize: 11, fontWeight: '600' },
  half: { flex: 1, padding: 18, alignItems: 'center' },
  darkText: { color: '#111', fontWeight: '600' },
  lightText: { color: '#fff', fontWeight: '600' },
  interactive: { height: 160, padding: 20, justifyContent: 'flex-end', gap: 6 },
});
