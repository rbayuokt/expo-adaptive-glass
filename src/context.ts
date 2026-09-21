import { createContext, useContext } from 'react';

import { GlassNative, type NativeGlassStats } from './ExpoAdaptiveGlassModule';
import { GlassQualityManager, type StatsSource } from './quality/GlassQualityManager';
import type { GlassDeviceInfo } from './types';

let deviceInfo: GlassDeviceInfo | null | undefined;

/** Null without the native module. */
export function getGlassDeviceInfo(): GlassDeviceInfo | null {
  if (deviceInfo === undefined) {
    try {
      deviceInfo = GlassNative?.getDeviceInfo() ?? null;
    } catch (e) {
      if (__DEV__)
        console.warn('[@rbayuokt/expo-adaptive-glass] getDeviceInfo failed, using fallback', e);
      deviceInfo = null;
    }
  }
  return deviceInfo;
}

const nativeSource: StatsSource | null = GlassNative
  ? (listener: (s: NativeGlassStats) => void) => {
      const sub = GlassNative!.addListener('onStats', listener);
      return () => sub.remove();
    }
  : null;

export function createGlassManager() {
  return new GlassQualityManager(getGlassDeviceInfo(), nativeSource);
}

let defaultManager: GlassQualityManager | null = null;

// for surfaces rendered outside a provider
function getDefaultManager() {
  return (defaultManager ??= createGlassManager());
}

export const GlassContext = createContext<GlassQualityManager | null>(null);

export function useGlassManager(): GlassQualityManager {
  return useContext(GlassContext) ?? getDefaultManager();
}

export const GlassClarityContext = createContext(0);

/** The provider's `clarity`, 0 frosted to 1 clear. */
export function useGlassClarity(): number {
  return useContext(GlassClarityContext);
}

// less frost tint and less blur as the glass gets clearer
export function clearer(intensity: number, clarity: number) {
  return Math.max(0, Math.min(1, intensity)) * (1 - 0.85 * clarity);
}
