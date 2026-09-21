import { Image } from 'expo-image';
import { GlassSurface } from 'expo-adaptive-glass';
import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Diagnostics } from '../components/Diagnostics';
import { Toggle } from '../components/Pills';
import { Screen, TAB_BAR_SPACE } from '../components/Screen';
import { useTheme } from '../theme';

const ROWS = Array.from({ length: 120 }, (_, i) => String(i));

export function StressScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [refraction, setRefraction] = useState(true);
  const [highlights, setHighlights] = useState(true);
  const [blur, setBlur] = useState(true);
  const quality = blur ? 'auto' : 'low';

  const header = (
    <View style={styles.header}>
      <Toggle label="refraction" value={refraction} onChange={setRefraction} />
      <Toggle label="dynamic highlights" value={highlights} onChange={setHighlights} />
      <Toggle label="native blur" value={blur} onChange={setBlur} />
      <Diagnostics />
    </View>
  );

  return (
    <Screen
      title="Stress test"
      subtitle="Animated backdrop, images, a grid of interactive glass, scrolling."
      scroll={false}
      animated>
      <FlatList
        data={ROWS}
        numColumns={2}
        keyExtractor={(r) => r}
        ListHeaderComponent={header}
        columnWrapperStyle={styles.column}
        contentContainerStyle={{
          padding: 16,
          gap: 10,
          paddingBottom: insets.bottom + TAB_BAR_SPACE,
        }}
        renderItem={({ item }) => (
          <Pressable style={styles.cell}>
            <GlassSurface
              quality={quality}
              refraction={refraction}
              interactive={highlights}
              cornerRadius={18}
              style={styles.tile}>
              <Image
                source={{ uri: `https://picsum.photos/id/${(Number(item) % 80) + 10}/120` }}
                style={styles.thumb}
              />
              <Text style={[styles.label, { color: theme.text }]}>Tile {Number(item) + 1}</Text>
            </GlassSurface>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 10, marginBottom: 6 },
  column: { gap: 10 },
  cell: { flex: 1 },
  tile: { padding: 10, gap: 8, alignItems: 'center' },
  thumb: { width: '100%', aspectRatio: 1.6, borderRadius: 10 },
  label: { fontWeight: '600' },
});
