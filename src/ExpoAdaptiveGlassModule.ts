import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { GlassDeviceInfo, GlassRenderer, GlassScrollState, GlassThermalState } from './types';

/** Sent once per ~500 ms window, never per frame. */
export interface NativeGlassStats {
  windowMs: number;
  sampleCount: number;
  refreshRate: number;
  targetFrameTimeMs: number;
  averageFrameTimeMs: number;
  worstFrameTimeMs: number;
  droppedFrameRatio: number;
  thermalState: GlassThermalState;
  lowPowerMode: boolean;
  lowMemory: boolean;
  reduceTransparency: boolean;
  reduceMotion: boolean;
  scrollState: GlassScrollState;
  /** visible surfaces only, area in pt/dp */
  surfaces: { id: string; area: number; renderer: GlassRenderer }[];
}

interface Subscription {
  remove(): void;
}

interface NativeGlassModule {
  getDeviceInfo(): GlassDeviceInfo;
  addListener(event: 'onStats', listener: (stats: NativeGlassStats) => void): Subscription;
}

export const GlassNative: NativeGlassModule | null =
  Platform.OS === 'ios' || Platform.OS === 'android'
    ? requireOptionalNativeModule<NativeGlassModule>('ExpoAdaptiveGlass')
    : null;

let warned = false;
export function warnMissingNative() {
  if (warned || GlassNative || !__DEV__ || Platform.OS === 'web') return;
  warned = true;
  console.warn(
    '[expo-adaptive-glass] Native module not found, so surfaces render a plain translucent ' +
      'fallback. This library ships native code and does not run in Expo Go. Create a development ' +
      'build (`npx expo run:ios` / `npx expo run:android`, or EAS Build) and rebuild after installing.'
  );
}
