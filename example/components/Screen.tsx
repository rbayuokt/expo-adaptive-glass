import { GlassBackdrop } from '@rbayuokt/expo-adaptive-glass';
import React, { type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Backdrop } from './Backdrop';
import { useTopSpace } from './Layout';
import { useTheme } from '../theme';

export const TAB_BAR_SPACE = 110;

export function Screen({
  title,
  subtitle,
  children,
  scroll = true,
  animated = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  scroll?: boolean;
  animated?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const top = insets.top + 12 + useTopSpace();
  const theme = useTheme();
  const header = (
    <View style={styles.header}>
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      {subtitle ? <Text style={[styles.subtitle, { color: theme.muted }]}>{subtitle}</Text> : null}
    </View>
  );
  return (
    <View style={styles.fill}>
      <Backdrop animated={animated} />
      {/* the tab bar blurs this one, glass in here skips it as an ancestor and uses the outer */}
      <GlassBackdrop style={StyleSheet.absoluteFill}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={[
              styles.content,
              { paddingTop: top, paddingBottom: insets.bottom + TAB_BAR_SPACE },
            ]}>
            {header}
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.fill, { paddingTop: top }]}>
            <View style={styles.pad}>{header}</View>
            {children}
          </View>
        )}
      </GlassBackdrop>
    </View>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.muted }]}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 20 },
  pad: { paddingHorizontal: 16 },
  header: { gap: 4, marginBottom: 4 },
  title: { fontSize: 30, fontWeight: '800' },
  subtitle: { fontSize: 14, lineHeight: 20 },
  section: { gap: 10 },
  sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6 },
});
