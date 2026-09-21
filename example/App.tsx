import { Ionicons } from '@expo/vector-icons';
import { GlassProvider, GlassSurface, GlassTabBar } from '@rbayuokt/expo-adaptive-glass';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { TopSpace } from './components/Layout';
import {
  DEFAULT_SETTINGS,
  GlassSettings,
  type GlassSettingsValue,
} from './components/GlassSettings';
import { AccessibilityScreen } from './screens/AccessibilityScreen';
import { BasicsScreen } from './screens/BasicsScreen';
import { BenchmarkScreen } from './screens/BenchmarkScreen';
import { InspectorScreen } from './screens/InspectorScreen';
import { ManySurfacesScreen } from './screens/ManySurfacesScreen';
import { MergeScreen } from './screens/MergeScreen';
import { NavigationScreen } from './screens/NavigationScreen';
import { PlaygroundScreen } from './screens/PlaygroundScreen';
import { QualityScreen } from './screens/QualityScreen';
import { ScrollingScreen } from './screens/ScrollingScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { StressScreen } from './screens/StressScreen';
import { useTheme } from './theme';

const DEMOS = {
  Basics: BasicsScreen,
  Merge: MergeScreen,
  Nav: NavigationScreen,
  Many: ManySurfacesScreen,
  Scroll: ScrollingScreen,
  Stress: StressScreen,
  Quality: QualityScreen,
  A11y: AccessibilityScreen,
};
type Demo = keyof typeof DEMOS;

const TABS = [
  { name: 'Home', icon: 'home' },
  { name: 'Playground', icon: 'color-wand' },
  { name: 'Benchmark', icon: 'speedometer' },
  { name: 'Inspect', icon: 'hardware-chip' },
  { name: 'Settings', icon: 'settings' },
] as const;

const TOP_BAR_SPACE = 58;

function DemoBar({ active, onChange }: { active: Demo; onChange: (d: Demo) => void }) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  return (
    <View style={[styles.topWrap, { top: insets.top + 4 }]} pointerEvents="box-none">
      <GlassSurface priority="critical" cornerRadius={24} intensity={0.7} style={styles.topBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}>
          {(Object.keys(DEMOS) as Demo[]).map((d) => (
            <Pressable key={d} onPress={() => onChange(d)} style={styles.chip}>
              <Text style={[styles.chipText, { color: d === active ? theme.accent : theme.text }]}>
                {d}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </GlassSurface>
    </View>
  );
}

function Home() {
  const [demo, setDemo] = useState<Demo>('Basics');
  const Active = DEMOS[demo];
  return (
    <TopSpace.Provider value={TOP_BAR_SPACE}>
      <Active />
      <DemoBar active={demo} onChange={setDemo} />
    </TopSpace.Provider>
  );
}

function Shell() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [tab, setTab] = useState(0);
  const name = TABS[tab].name;
  return (
    <View style={styles.fill}>
      {name === 'Home' && <Home />}
      {name === 'Playground' && <PlaygroundScreen />}
      {name === 'Benchmark' && <BenchmarkScreen />}
      {name === 'Inspect' && <InspectorScreen />}
      {name === 'Settings' && <SettingsScreen />}
      <View style={[styles.bottomWrap, { bottom: insets.bottom + 8 }]} pointerEvents="box-none">
        <GlassTabBar selectedIndex={tab} onSelect={setTab}>
          {TABS.map((t, i) => {
            const color = i === tab ? theme.accent : theme.text;
            return (
              <View key={t.name} style={styles.tabItem}>
                <Ionicons name={t.icon} size={22} color={color} />
                <Text style={[styles.tabLabel, { color }]}>{t.name}</Text>
              </View>
            );
          })}
        </GlassTabBar>
      </View>
    </View>
  );
}

export default function App() {
  const [settings, setSettings] = useState<GlassSettingsValue>(DEFAULT_SETTINGS);
  const update = useCallback(
    (patch: Partial<GlassSettingsValue>) => setSettings((s) => ({ ...s, ...patch })),
    []
  );
  const value = useMemo(() => ({ settings, update }), [settings, update]);
  return (
    <SafeAreaProvider>
      <GlassProvider {...settings}>
        <GlassSettings.Provider value={value}>
          <StatusBar style="auto" />
          <Shell />
        </GlassSettings.Provider>
      </GlassProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  topWrap: { position: 'absolute', left: 12, right: 12 },
  topBar: { paddingVertical: 4 },
  chips: { paddingHorizontal: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 10 },
  chipText: { fontSize: 14, fontWeight: '700' },
  bottomWrap: { position: 'absolute', left: 16, right: 16 },
  tabItem: { alignItems: 'center', gap: 2 },
  tabLabel: { fontSize: 11, fontWeight: '600', lineHeight: 14 },
});
