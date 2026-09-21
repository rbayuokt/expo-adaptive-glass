import { GlassSurface } from 'expo-adaptive-glass';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme';

export function Pills<T extends string | number>({
  options,
  value,
  onChange,
  label = (v: T) => String(v),
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label?: (v: T) => string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      {options.map((o) => {
        const active = o === value;
        return (
          <Pressable key={String(o)} onPress={() => onChange(o)}>
            <GlassSurface
              priority="high"
              cornerRadius={14}
              intensity={active ? 0.9 : 0.4}
              tint={active ? theme.accent : 'system'}
              style={styles.pill}>
              <Text style={[styles.text, { color: active ? '#fff' : theme.text }]}>{label(o)}</Text>
            </GlassSurface>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <Pills options={[`${label}: on`, `${label}: off`]} value={value ? `${label}: on` : `${label}: off`} onChange={(v) => onChange(v.endsWith('on'))} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { paddingHorizontal: 12, paddingVertical: 7 },
  text: { fontSize: 13, fontWeight: '600' },
});
