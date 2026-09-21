import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import {
  GlassLens,
  GlassMenu,
  GlassSurface,
  GlassSwitch,
  GlassTabBar,
} from '@rbayuokt/expo-adaptive-glass';
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
  const [airplane, setAirplane] = useState(true);
  const [wifi, setWifi] = useState(false);
  const [menuPick, setMenuPick] = useState('nothing yet');
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

      <Section title="Switch">
        <GlassSurface style={styles.switches}>
          <View style={styles.switchRow}>
            <Text style={[styles.p, t]}>Airplane Mode</Text>
            <GlassSwitch value={airplane} onValueChange={setAirplane} />
          </View>
          <View style={styles.switchRow}>
            <Text style={[styles.p, t]}>Wi-Fi</Text>
            <GlassSwitch value={wifi} onValueChange={setWifi} onColor="#0a84ff" />
          </View>
          <View style={styles.switchRow}>
            <Text style={[styles.p, { color: theme.muted }]}>Disabled</Text>
            <GlassSwitch value disabled />
          </View>
        </GlassSurface>
        <Text style={[styles.p, { color: theme.muted }]}>
          Press and hold a switch, then drag the thumb across.
        </Text>
      </Section>

      <Section title="Menu">
        <View style={styles.menuRow}>
          <GlassMenu
            accessibilityLabel="More"
            trigger={<Ionicons name="ellipsis-horizontal" size={20} color={theme.text} />}
            items={[
              {
                label: 'Select chats',
                icon: <Ionicons name="checkmark-circle-outline" size={20} color={theme.text} />,
                onPress: () => setMenuPick('Select chats'),
              },
              {
                label: 'Read all',
                icon: <Ionicons name="chatbubble-outline" size={20} color={theme.text} />,
                onPress: () => setMenuPick('Read all'),
              },
              {
                label: 'Sort by',
                icon: <Ionicons name="swap-vertical" size={20} color={theme.text} />,
                items: [
                  { label: 'Newest', onPress: () => setMenuPick('Newest') },
                  { label: 'Unread first', onPress: () => setMenuPick('Unread first') },
                  {
                    label: 'More',
                    items: [
                      { label: 'Name', onPress: () => setMenuPick('Name') },
                      { label: 'Size', onPress: () => setMenuPick('Size') },
                    ],
                  },
                ],
              },
              {
                label: 'Delete all',
                destructive: true,
                icon: <Ionicons name="trash-outline" size={20} color="#ff3b30" />,
                onPress: () => setMenuPick('Delete all'),
              },
            ]}
          />
          <Text style={[styles.p, styles.menuPick, { color: theme.muted }]}>
            Picked: {menuPick}
          </Text>
          <GlassMenu
            accessibilityLabel="Add"
            trigger={<Ionicons name="add" size={22} color={theme.text} />}
            items={[
              {
                label: 'New chat',
                icon: <Ionicons name="chatbubble-outline" size={20} color={theme.text} />,
                onPress: () => setMenuPick('New chat'),
              },
              {
                label: 'New group',
                icon: <Ionicons name="people-outline" size={20} color={theme.text} />,
                onPress: () => setMenuPick('New group'),
              },
            ]}
          />
        </View>
      </Section>

      <Section title="Lens">
        <GlassLens style={styles.lensStage}>
          <Image
            source={{ uri: 'https://picsum.photos/id/1043/800/400' }}
            style={styles.lensImage}
          />
          <Text style={[styles.p, t]}>
            Small print reads better through glass. Hold anywhere on this card and drag the lens
            around.
          </Text>
        </GlassLens>
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
  switches: { paddingHorizontal: 18, paddingVertical: 8 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  menuPick: { flex: 1 },
  lensStage: { gap: 10 },
  lensImage: { height: 160, borderRadius: 16 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
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
