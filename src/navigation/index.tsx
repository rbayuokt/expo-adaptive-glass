import React, { type ReactNode } from 'react';
import {
  StyleSheet,
  Text,
  View,
  useColorScheme,
  type ColorValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { GlassBackdrop } from '../GlassBackdrop';
import { GlassTabBar } from '../GlassTabBar';
import type { GlassTint } from '../types';

// Structural copies of the React Navigation types we read, so this entry point has no
// dependency on @react-navigation. BottomTabBarProps from v7 fits them.
interface Route {
  key: string;
  name: string;
  params?: object;
}

interface TabOptions {
  title?: string;
  tabBarLabel?:
    | string
    | ((props: {
        focused: boolean;
        color: string;
        position: 'below-icon' | 'beside-icon';
        children: string;
      }) => ReactNode);
  tabBarIcon?: (props: { focused: boolean; color: string; size: number }) => ReactNode;
  tabBarBadge?: string | number;
  tabBarShowLabel?: boolean;
  tabBarActiveTintColor?: string;
  tabBarInactiveTintColor?: string;
  tabBarAccessibilityLabel?: string;
  tabBarButtonTestID?: string;
}

export interface GlassNavigationTabBarProps {
  state: { index: number; routes: Route[] };
  descriptors: Record<string, { options: TabOptions }>;
  navigation: {
    emit(event: { type: any; target?: string; canPreventDefault?: boolean }): unknown;
    navigate(...args: any[]): void;
  };
  insets?: { top: number; right: number; bottom: number; left: number };
  /** Outer style of the floating bar, e.g. to change its margins. */
  style?: StyleProp<ViewStyle>;
  tint?: GlassTint;
  intensity?: number;
  /** false skips the magnifying lens, the selected tab is only marked by `selection` */
  lens?: boolean;
  /** what marks the selected tab while nothing is held */
  selection?: 'pill' | 'none';
  /** colour of that mark, used as given */
  selectionColor?: ColorValue;
}

/**
 * GlassTabBar for React Navigation bottom tabs and Expo Router `<Tabs>`:
 * `tabBar={(props) => <GlassNavigationTabBar {...props} />}`.
 */
export function GlassNavigationTabBar({
  state,
  descriptors,
  navigation,
  insets,
  style,
  tint,
  intensity,
  lens,
  selection,
  selectionColor,
}: GlassNavigationTabBarProps) {
  const dark = useColorScheme() === 'dark';

  const select = (index: number) => {
    const route = state.routes[index];
    if (!route) return;
    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    }) as {
      defaultPrevented?: boolean;
    };
    // a tap on the current tab still sends tabPress, so screens can scroll to top
    if (index !== state.index && !event.defaultPrevented) {
      navigation.navigate(route.name, route.params);
    }
  };

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: (insets?.bottom ?? 0) + 8 }, style]}>
      <GlassTabBar
        selectedIndex={state.index}
        onSelect={select}
        tint={tint}
        intensity={intensity}
        lens={lens}
        selection={selection}
        selectionColor={selectionColor}>
        {state.routes.map((route, i) => {
          const { options } = descriptors[route.key] ?? { options: {} };
          const focused = i === state.index;
          const color = focused
            ? (options.tabBarActiveTintColor ?? (dark ? '#8a8aff' : '#4f4fe8'))
            : (options.tabBarInactiveTintColor ?? (dark ? '#f5f5f7' : '#1c1c1e'));
          const title = options.title ?? route.name;
          const label = options.tabBarLabel ?? title;
          return (
            <View
              key={route.key}
              style={styles.item}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? title}
              testID={options.tabBarButtonTestID}>
              <View>
                {options.tabBarIcon?.({ focused, color, size: 22 })}
                {options.tabBarBadge != null && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{String(options.tabBarBadge)}</Text>
                  </View>
                )}
              </View>
              {options.tabBarShowLabel !== false &&
                (typeof label === 'function' ? (
                  label({ focused, color, position: 'below-icon', children: title })
                ) : (
                  <Text numberOfLines={1} style={[styles.label, { color }]}>
                    {label}
                  </Text>
                ))}
            </View>
          );
        })}
      </GlassTabBar>
    </View>
  );
}

/**
 * Blur source for the screens behind a GlassNavigationTabBar. Android only blurs what sits
 * inside a GlassBackdrop, so wrap every screen with it, e.g. through the navigator's
 * `screenLayout` prop. On iOS it's a plain View.
 */
export function GlassScreenBackdrop({ children }: { children?: ReactNode }) {
  return <GlassBackdrop style={styles.fill}>{children}</GlassBackdrop>;
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16 },
  fill: { flex: 1 },
  item: { alignItems: 'center', gap: 2 },
  label: { fontSize: 11, fontWeight: '600', lineHeight: 14 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: '#ff3b30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
});
