import React, { Children } from 'react';
import { Pressable, StyleSheet, View, useColorScheme } from 'react-native';

import { GlassSurface, parseTint } from './GlassSurface';
import { NativeLensView } from './NativeGlassView';
import { useGlassCapabilities } from './hooks/useGlassCapabilities';
import type { GlassTabBarProps } from './types';

/** Tab bar with a native magnifying lens. JS only hears the chosen index. */
export function GlassTabBar({
  children,
  selectedIndex,
  onSelect,
  tint = 'system',
  cornerRadius = 999,
  intensity = 0.7,
  style,
  ...rest
}: GlassTabBarProps) {
  const caps = useGlassCapabilities();
  const scheme = useColorScheme();
  const { tintScheme, tintColor } = parseTint(tint);
  const tabs = Children.toArray(children);

  // glass behind the row, not around it, so the lens can bulge past the bar
  const background = (
    <GlassSurface
      priority="critical"
      tint={tint}
      intensity={intensity}
      cornerRadius={cornerRadius}
      style={StyleSheet.absoluteFill}
    />
  );

  if (!NativeLensView) {
    const dark = tintScheme === 'dark' || (tintScheme === 'system' && scheme === 'dark');
    return (
      <View accessibilityRole="tablist" collapsable={false} style={[styles.bar, style]} {...rest}>
        {background}
        {tabs.map((tab, i) => (
          <Pressable
            key={i}
            accessibilityRole="tab"
            accessibilityState={{ selected: i === selectedIndex }}
            onPress={() => onSelect(i)}
            style={[
              styles.tab,
              i === selectedIndex && {
                borderRadius: 999,
                backgroundColor: dark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.55)',
              },
            ]}>
            {tab}
          </Pressable>
        ))}
      </View>
    );
  }

  return (
    // the lens scales this view while held, so it can't be flattened away
    <View collapsable={false} style={[styles.bar, style]} {...rest}>
      {background}
      <NativeLensView
        accessibilityRole="tablist"
        style={styles.row}
        selectedIndex={selectedIndex}
        // the lens is cheap, so low tiers keep it. Only the bending follows `refraction`
        lensStyle={caps.quality === 'minimal' ? 'pill' : 'glass'}
        refraction={caps.refraction}
        tintColor={tintColor}
        tintScheme={tintScheme}
        onTabSelect={(e) => onSelect(e.nativeEvent.index)}>
        {tabs.map((tab, i) => (
          // native side finds tab i by child index
          <View
            key={i}
            collapsable={false}
            accessibilityRole="tab"
            accessibilityState={{ selected: i === selectedIndex }}
            style={styles.tab}>
            {tab}
          </View>
        ))}
      </NativeLensView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', padding: 4 },
  row: { flex: 1, flexDirection: 'row' },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
});
