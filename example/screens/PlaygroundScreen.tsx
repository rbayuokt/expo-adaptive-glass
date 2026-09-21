import { GlassSurface, type GlassPriority, type GlassQuality } from '@rbayuokt/expo-adaptive-glass';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Pills, Toggle } from '../components/Pills';
import { Screen, Section } from '../components/Screen';
import { useTheme } from '../theme';

const QUALITIES: readonly GlassQuality[] = ['auto', 'ultra', 'high', 'medium', 'low', 'minimal'];
const PRIORITIES: readonly GlassPriority[] = ['critical', 'high', 'normal', 'low', 'decorative'];
const INTENSITIES = [0.2, 0.4, 0.6, 0.8, 1] as const;
const RADII = [0, 12, 24, 40, 999] as const;
const TINTS = ['system', 'light', 'dark', '#ff375f', '#0a84ff', '#30d158'] as const;

export function PlaygroundScreen() {
  const theme = useTheme();
  const [quality, setQuality] = useState<GlassQuality>('auto');
  const [priority, setPriority] = useState<GlassPriority>('critical');
  const [intensity, setIntensity] = useState<(typeof INTENSITIES)[number]>(0.6);
  const [radius, setRadius] = useState<(typeof RADII)[number]>(24);
  const [tint, setTint] = useState<(typeof TINTS)[number]>('system');
  const [interactive, setInteractive] = useState(true);
  const [draggable, setDraggable] = useState(false);
  const [refraction, setRefraction] = useState(true);

  const props = [
    quality !== 'auto' && `quality="${quality}"`,
    priority !== 'normal' && `priority="${priority}"`,
    intensity !== 0.6 && `intensity={${intensity}}`,
    radius !== 24 && `cornerRadius={${radius}}`,
    tint !== 'system' && `tint="${tint}"`,
    interactive && 'interactive',
    draggable && 'draggable',
    !refraction && 'refraction={false}',
  ].filter(Boolean);
  const code = `<GlassSurface${props.length ? '\n  ' + props.join('\n  ') + '\n' : ''}>\n  ...\n</GlassSurface>`;

  return (
    <Screen title="Playground" subtitle="Change a prop and the surface updates live." animated>
      <View style={styles.stage}>
        <GlassSurface
          quality={quality}
          priority={priority}
          intensity={intensity}
          cornerRadius={radius}
          tint={tint}
          interactive={interactive}
          draggable={draggable}
          refraction={refraction}
          style={styles.preview}>
          <Text style={[styles.previewTitle, { color: theme.text }]}>Glass</Text>
          <Text style={{ color: theme.muted }}>
            {draggable ? 'Drag me' : interactive ? 'Press me' : 'Static'}
          </Text>
        </GlassSurface>
      </View>

      <View style={[styles.code, { backgroundColor: theme.dark ? '#1c1c22' : '#ffffffcc' }]}>
        <Text style={[styles.codeText, { color: theme.text }]}>{code}</Text>
      </View>

      <Section title="Quality">
        <Pills options={QUALITIES} value={quality} onChange={setQuality} />
      </Section>
      <Section title="Priority">
        <Pills options={PRIORITIES} value={priority} onChange={setPriority} />
      </Section>
      <Section title="Intensity">
        <Pills options={INTENSITIES} value={intensity} onChange={setIntensity} />
      </Section>
      <Section title="Corner radius">
        <Pills options={RADII} value={radius} onChange={setRadius} />
      </Section>
      <Section title="Tint">
        <Pills options={TINTS} value={tint} onChange={setTint} />
      </Section>
      <Section title="Behaviour">
        <Toggle label="interactive" value={interactive} onChange={setInteractive} />
        <Toggle label="draggable" value={draggable} onChange={setDraggable} />
        <Toggle label="refraction" value={refraction} onChange={setRefraction} />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stage: { height: 200, alignItems: 'center', justifyContent: 'center' },
  preview: { width: 240, height: 150, alignItems: 'center', justifyContent: 'center', gap: 4 },
  previewTitle: { fontSize: 24, fontWeight: '800' },
  code: { borderRadius: 14, padding: 14 },
  codeText: { fontFamily: 'Menlo', fontSize: 12, lineHeight: 18 },
});
