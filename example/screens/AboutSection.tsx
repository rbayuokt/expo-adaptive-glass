import { GlassSurface, getGlassDeviceInfo, useGlassQuality } from '@rbayuokt/expo-adaptive-glass';
import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Section } from '../components/Screen';
import { useTheme } from '../theme';

const pkg = require('@rbayuokt/expo-adaptive-glass/package.json') as { version: string };

const FEATURES = [
  [
    'Adaptive quality',
    'Scales from system glass down to acrylic based on the device and live frame times.',
  ],
  ['Lens tab bar', 'GlassTabBar lifts into a magnifying lens while you hold it, like iOS 26.'],
  ['Liquid merge', 'GlassGroup melts nearby surfaces together and stretches them apart.'],
  ['Navigation', 'Drop-in tab bar for React Navigation and Expo Router.'],
  ['Controls', 'GlassSwitch, GlassLens and GlassMenu with native press, drag and morph.'],
] as const;

export function AboutSection() {
  const theme = useTheme();
  const quality = useGlassQuality();
  const device = getGlassDeviceInfo();
  const t = { color: theme.text };
  const muted = { color: theme.muted };

  return (
    <Section title="About">
      <GlassSurface priority="high" style={styles.card}>
        <Text style={[styles.name, t]}>expo-adaptive-glass</Text>
        <Text style={muted}>Version {pkg.version}</Text>
        <View style={styles.row}>
          <Text style={muted}>Running now</Text>
          <Text style={[styles.value, t]}>
            {quality.renderer} · {quality.quality}
          </Text>
        </View>
        {device && (
          <View style={styles.row}>
            <Text style={muted}>Device</Text>
            <Text style={[styles.value, t]}>
              {device.platform === 'ios' ? 'iOS' : 'Android'} {device.osVersion}
            </Text>
          </View>
        )}
      </GlassSurface>

      <Text style={[styles.heading, muted]}>WHAT'S INSIDE</Text>
      <View style={styles.list}>
        {FEATURES.map(([title, body]) => (
          <GlassSurface key={title} style={styles.card}>
            <Text style={[styles.feature, t]}>{title}</Text>
            <Text style={muted}>{body}</Text>
          </GlassSurface>
        ))}
      </View>

      <Pressable onPress={() => Linking.openURL('https://github.com/rbayuokt/expo-adaptive-glass')}>
        <GlassSurface interactive priority="high" tint={theme.accent} style={styles.button}>
          <Text style={styles.buttonText}>View on GitHub</Text>
        </GlassSurface>
      </Pressable>
      <Text style={[styles.footer, muted]}>Made by @rbayuokt</Text>
    </Section>
  );
}

const styles = StyleSheet.create({
  card: { padding: 18, gap: 6 },
  name: { fontSize: 20, fontWeight: '800' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  value: { fontWeight: '600' },
  feature: { fontSize: 16, fontWeight: '700' },
  button: { paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  footer: { textAlign: 'center', fontSize: 12 },
  heading: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, marginTop: 8 },
  list: { gap: 12 },
});
