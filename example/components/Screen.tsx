import React, { type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Backdrop } from './Backdrop';
import { useTheme } from '../theme';

export const TAB_BAR_SPACE = 96;

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
      {scroll ? (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 12, paddingBottom: insets.bottom + TAB_BAR_SPACE },
          ]}>
          {header}
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, { paddingTop: insets.top + 12 }]}>
          <View style={styles.pad}>{header}</View>
          {children}
        </View>
      )}
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
