import { GlassSurface } from 'expo-adaptive-glass';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Diagnostics } from '../components/Diagnostics';
import { Pills } from '../components/Pills';
import { Screen, Section } from '../components/Screen';
import { useTheme } from '../theme';

const COUNTS = [1, 4, 8, 16, 30] as const;

export function ManySurfacesScreen() {
  const [count, setCount] = useState<(typeof COUNTS)[number]>(4);
  const theme = useTheme();
  return (
    <Screen
      title="Many surfaces"
      subtitle="Watch live surfaces, tier and reason as the count grows.">
      <Pills options={COUNTS} value={count} onChange={setCount} label={(n) => `${n}`} />
      <Diagnostics />
      <Section title={`${count} surfaces`}>
        <View style={styles.grid}>
          {Array.from({ length: count }, (_, i) => (
            <GlassSurface
              key={i}
              cornerRadius={16}
              style={count <= 4 ? styles.large : styles.small}>
              <Text style={[styles.label, { color: theme.text }]}>{i + 1}</Text>
            </GlassSurface>
          ))}
        </View>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  large: { width: '47%', height: 140, alignItems: 'center', justifyContent: 'center' },
  small: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 16, fontWeight: '700' },
});
