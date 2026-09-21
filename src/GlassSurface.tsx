import React, { useId, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { StyleSheet, View, processColor, useColorScheme } from 'react-native';

import { warnMissingNative } from './ExpoAdaptiveGlassModule';
import { NativeGlassView, type NativeGlassViewProps } from './NativeGlassView';
import { useGlassManager } from './context';
import type { SurfaceDescriptor } from './quality/GlassQualityManager';
import type { GlassSurfaceProps, GlassTint } from './types';

const DEFAULT_RADIUS = 24;

export function GlassSurface({
  children,
  quality = 'auto',
  priority = 'normal',
  intensity = 0.6,
  tint = 'system',
  cornerRadius = DEFAULT_RADIUS,
  interactive = false,
  refraction = true,
  onInteractionStart,
  onInteractionEnd,
  draggable = false,
  onDragStart,
  onDragEnd,
  style,
  ...rest
}: GlassSurfaceProps) {
  const manager = useGlassManager();
  const id = useId();

  const desc = useMemo<SurfaceDescriptor>(
    () => ({ priority, requestedQuality: quality, interactive, refraction }),
    [priority, quality, interactive, refraction]
  );

  // layout effect so a list mounting 30 cards is budgeted before the first paint
  useLayoutEffect(() => {
    manager.register(id, desc);
  }, [manager, id, desc]);
  useLayoutEffect(() => () => manager.unregister(id), [manager, id]);

  const allocation = useSyncExternalStore(
    manager.subscribeAllocations,
    () => manager.getAllocation(id, desc),
    () => manager.getAllocation(id, desc)
  );

  const scheme = useColorScheme();
  const { tintScheme, tintColor } = useMemo(() => parseTint(tint), [tint]);
  const shape = { borderRadius: cornerRadius, borderCurve: 'continuous' as const };

  if (!NativeGlassView) {
    warnMissingNative();
    const dark = tintScheme === 'dark' || (tintScheme === 'system' && scheme === 'dark');
    return (
      <View style={[shape, fallbackStyle(dark, intensity, tintColor), style]} {...rest}>
        {children}
      </View>
    );
  }

  const nativeProps: NativeGlassViewProps = {
    surfaceId: id,
    renderer: allocation.renderer,
    quality: allocation.quality,
    blur: allocation.blur,
    refraction: allocation.refraction,
    dynamicHighlights: allocation.dynamicHighlights,
    shaderQuality: allocation.shaderQuality,
    opaque: allocation.opaque,
    reduceMotion: allocation.reduceMotion,
    intensity: Math.max(0, Math.min(1, intensity)),
    tintColor,
    tintScheme,
    cornerRadius,
    interactive,
    onInteractionStart,
    onInteractionEnd,
    draggable,
    onDragStart,
    onDragEnd: onDragEnd && ((e) => onDragEnd(e.nativeEvent)),
  };

  // children live inside the native view: Android keeps them out of the backdrop recording, and
  // both platforms move them with the press
  return (
    <NativeGlassView collapsable={false} style={[shape, style]} {...rest} {...nativeProps}>
      {children}
    </NativeGlassView>
  );
}

export function parseTint(tint: GlassTint): {
  tintScheme: 'system' | 'light' | 'dark';
  tintColor: number | null;
} {
  if (tint === 'system' || tint === 'light' || tint === 'dark') {
    return { tintScheme: tint as 'system' | 'light' | 'dark', tintColor: null };
  }
  const c = processColor(tint);
  return { tintScheme: 'system', tintColor: typeof c === 'number' ? c : null };
}

// no native module (Expo Go, web)
function fallbackStyle(dark: boolean, intensity: number, tintColor: number | null) {
  const alpha = 0.55 + 0.3 * intensity;
  const base =
    tintColor !== null
      ? `rgba(${(tintColor >> 16) & 255}, ${(tintColor >> 8) & 255}, ${tintColor & 255}, ${alpha})`
      : dark
        ? `rgba(28, 28, 32, ${alpha})`
        : `rgba(250, 250, 252, ${alpha})`;
  return {
    backgroundColor: base,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: dark ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.7)',
  };
}
