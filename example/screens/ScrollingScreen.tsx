import { GlassSurface } from '@rbayuokt/expo-adaptive-glass';
import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Diagnostics } from '../components/Diagnostics';
import { Screen, TAB_BAR_SPACE } from '../components/Screen';
import { useTheme } from '../theme';

const DATA = Array.from({ length: 200 }, (_, i) => ({ id: String(i), title: `Card ${i + 1}` }));

function Card({ title }: { title: string }) {
  const theme = useTheme();
  return (
    <GlassSurface style={styles.card} cornerRadius={20}>
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      <Text style={{ color: theme.muted }}>Slow scroll, fling, then let it rest.</Text>
    </GlassSurface>
  );
}

export function ScrollingScreen() {
  const insets = useSafeAreaInsets();
  return (
    <Screen
      title="Scrolling"
      subtitle="Refraction and moving highlights drop while flinging."
      scroll={false}>
      <View style={styles.diag}>
        <Diagnostics compact />
      </View>
      <FlatList
        data={DATA}
        keyExtractor={(d) => d.id}
        renderItem={({ item }) => <Card title={item.title} />}
        contentContainerStyle={{
          padding: 16,
          gap: 12,
          paddingBottom: insets.bottom + TAB_BAR_SPACE,
        }}
        windowSize={7}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  diag: { paddingHorizontal: 16, paddingTop: 8 },
  card: { padding: 18, gap: 6, height: 110 },
  title: { fontSize: 17, fontWeight: '700' },
});
