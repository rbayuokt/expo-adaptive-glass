import { requireNativeView } from 'expo';
import type { ComponentType } from 'react';
import { Platform, type NativeSyntheticEvent, type ViewProps } from 'react-native';

import { GlassNative } from './ExpoAdaptiveGlassModule';
import type { EffectiveGlassQuality, GlassRenderer } from './types';

export interface NativeGlassViewProps extends ViewProps {
  surfaceId: string;
  renderer: GlassRenderer;
  quality: EffectiveGlassQuality;
  blur: number;
  refraction: number;
  dynamicHighlights: boolean;
  shaderQuality: number;
  opaque: boolean;
  reduceMotion: boolean;
  intensity: number;
  clarity: number;
  tintColor: number | null;
  tintScheme: 'system' | 'light' | 'dark';
  cornerRadius: number;
  interactive: boolean;
  draggable: boolean;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  onDragStart?: () => void;
  onDragEnd?: (event: NativeSyntheticEvent<{ x: number; y: number }>) => void;
  // GlassMenu only
  morphRect?: { x: number; y: number; width: number; height: number; radius: number } | null;
  morphIndex?: number;
  onMorphEnd?: (event: NativeSyntheticEvent<{ index: number }>) => void;
}

export const NativeGlassView: ComponentType<NativeGlassViewProps> | null = GlassNative
  ? requireNativeView<NativeGlassViewProps>('ExpoAdaptiveGlass')
  : null;

// iOS compositing blurs whatever is behind, only Android needs a backdrop view
export const NativeBackdropView: ComponentType<ViewProps> | null =
  GlassNative && Platform.OS === 'android'
    ? requireNativeView<ViewProps>('ExpoAdaptiveGlassBackdrop')
    : null;

export interface NativeLensViewProps extends ViewProps {
  selectedIndex: number;
  lensStyle: 'glass' | 'pill';
  refraction: boolean;
  tintColor: number | null;
  tintScheme: 'system' | 'light' | 'dark';
  // not onSelect: React Native already has a bubbling `select` event
  onTabSelect: (event: NativeSyntheticEvent<{ index: number }>) => void;
}

export const NativeLensView: ComponentType<NativeLensViewProps> | null = GlassNative
  ? requireNativeView<NativeLensViewProps>('ExpoAdaptiveGlassLens')
  : null;

export interface NativeGroupViewProps extends ViewProps {
  spacing: number;
  intensity: number;
  tintColor: number | null;
  tintScheme: 'system' | 'light' | 'dark';
}

export const NativeGroupView: ComponentType<NativeGroupViewProps> | null = GlassNative
  ? requireNativeView<NativeGroupViewProps>('ExpoAdaptiveGlassGroup')
  : null;

export interface NativeSwitchViewProps extends ViewProps {
  value: boolean;
  disabled: boolean;
  onColor: number | null;
  lens: boolean;
  scheme: 'system' | 'light' | 'dark';
  onValueChange: (event: NativeSyntheticEvent<{ value: boolean }>) => void;
}

export const NativeSwitchView: ComponentType<NativeSwitchViewProps> | null = GlassNative
  ? requireNativeView<NativeSwitchViewProps>('ExpoAdaptiveGlassSwitch')
  : null;

export interface NativeMagnifierViewProps extends ViewProps {
  lensWidth: number;
  lensHeight: number;
  magnification: number;
  lift: number;
  refraction: boolean;
  disabled: boolean;
}

export const NativeMagnifierView: ComponentType<NativeMagnifierViewProps> | null = GlassNative
  ? requireNativeView<NativeMagnifierViewProps>('ExpoAdaptiveGlassMagnifier')
  : null;

export interface NativeSliderViewProps extends ViewProps {
  value: number;
  disabled: boolean;
  fillColor: number | null;
  lens: boolean;
  scheme: 'system' | 'light' | 'dark';
  onValueChange: (event: NativeSyntheticEvent<{ value: number }>) => void;
  onSlidingComplete: (event: NativeSyntheticEvent<{ value: number }>) => void;
}

export const NativeSliderView: ComponentType<NativeSliderViewProps> | null = GlassNative
  ? requireNativeView<NativeSliderViewProps>('ExpoAdaptiveGlassSlider')
  : null;
