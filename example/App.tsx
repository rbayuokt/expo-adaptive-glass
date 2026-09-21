import { GlassProvider, GlassSurface, type GlassQuality } from 'expo-adaptive-glass';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { QualityControl } from './components/QualityControl';
import { AccessibilityScreen } from './screens/AccessibilityScreen';
import { BasicsScreen } from './screens/BasicsScreen';
import { BenchmarkScreen } from './screens/BenchmarkScreen';
import { InspectorScreen } from './screens/InspectorScreen';
import { ManySurfacesScreen } from './screens/ManySurfacesScreen';
import { MergeScreen } from './screens/MergeScreen';
import { QualityScreen } from './screens/QualityScreen';
import { ScrollingScreen } from './screens/ScrollingScreen';
import { StressScreen } from './screens/StressScreen';
import { useTheme } from './theme';

const SCREENS = {
  Basics: BasicsScreen,
  Merge: MergeScreen,
  Many: ManySurfacesScreen,
  Scroll: ScrollingScreen,
  Stress: StressScreen,
  Quality: QualityScreen,
  Inspect: InspectorScreen,
  A11y: AccessibilityScreen,
  Bench: BenchmarkScreen,
};
type Name = keyof typeof SCREENS;

function TabBar({ active, onChange }: { active: Name; onChange: (n: Name) => void }) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  return (
    <View style={[styles.tabWrap, { bottom: insets.bottom + 8 }]} pointerEvents="box-none">
      <GlassSurface priority="critical" cornerRadius={26} intensity={0.7} style={styles.tabBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}>
          {(Object.keys(SCREENS) as Name[]).map((n) => (
            <Pressable key={n} onPress={() => onChange(n)} style={styles.tab}>
              <Text style={[styles.tabText, { color: n === active ? theme.accent : theme.text }]}>
                {n}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </GlassSurface>
    </View>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Name>('Basics');
  const [quality, setQuality] = useState<GlassQuality>('auto');
  const Active = SCREENS[screen];
  return (
    <SafeAreaProvider>
      <GlassProvider quality={quality}>
        <QualityControl.Provider value={{ quality, setQuality }}>
          <StatusBar style="auto" />
          <View style={styles.fill}>
            <Active />
            <TabBar active={screen} onChange={setScreen} />
          </View>
        </QualityControl.Provider>
      </GlassProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  tabWrap: { position: 'absolute', left: 12, right: 12 },
  tabBar: { paddingVertical: 6 },
  tabs: { paddingHorizontal: 8 },
  tab: { paddingHorizontal: 12, paddingVertical: 10 },
  tabText: { fontSize: 14, fontWeight: '700' },
});
