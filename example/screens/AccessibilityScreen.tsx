import { GlassSurface, useGlassPerformance } from '@rbayuokt/expo-adaptive-glass';
import React from 'react';
import { Platform, StyleSheet, Text } from 'react-native';

import { Screen, Section } from '../components/Screen';
import { useTheme } from '../theme';

export function AccessibilityScreen() {
  const m = useGlassPerformance();
  const theme = useTheme();
  const t = { color: theme.text };
  const muted = { color: theme.muted };
  const settings =
    Platform.OS === 'ios'
      ? 'Settings → Accessibility → Display & Text Size → Reduce Transparency, and Accessibility → Motion → Reduce Motion.'
      : 'Settings → Accessibility → Remove animations. Android has no system-wide Reduce Transparency setting.';

  return (
    <Screen
      title="Accessibility"
      subtitle="System settings override the glass look. Apps cannot toggle them, change them in device settings.">
      <GlassSurface priority="high" style={styles.card}>
        <Text style={[styles.h, t]}>Current state</Text>
        <Text style={t}>Reduce Transparency: {m.reduceTransparency ? 'on' : 'off'}</Text>
        <Text style={t}>Reduce Motion: {m.reduceMotion ? 'on' : 'off'}</Text>
        <Text style={t}>Renderer: {m.renderer}</Text>
        <Text style={[styles.small, muted]}>{settings}</Text>
      </GlassSurface>

      <Section title="What changes">
        <GlassSurface style={styles.card}>
          <Text style={t}>
            • Reduce Transparency: every surface becomes a near-opaque material with a stronger
            border.
          </Text>
          <Text style={t}>
            • Reduce Motion: the touch highlight stops following the finger and the press spring is
            disabled.
          </Text>
        </GlassSurface>
      </Section>

      <Section title="High-contrast content">
        <GlassSurface interactive tint="dark" intensity={0.9} style={styles.card}>
          <Text style={styles.contrast}>
            White on a dark, high-intensity tint stays legible over any backdrop.
          </Text>
        </GlassSurface>
        <GlassSurface interactive tint="light" intensity={0.9} style={styles.card}>
          <Text style={styles.contrastDark}>Black on a light, high-intensity tint.</Text>
        </GlassSurface>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: 18, gap: 8 },
  h: { fontSize: 18, fontWeight: '700' },
  small: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  contrast: { color: '#fff', fontSize: 17, fontWeight: '700' },
  contrastDark: { color: '#000', fontSize: 17, fontWeight: '700' },
});
