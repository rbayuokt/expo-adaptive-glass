import type { ReactNode } from 'react';
import type { StyleProp, ViewProps, ViewStyle } from 'react-native';

export type EffectiveGlassQuality = 'ultra' | 'high' | 'medium' | 'low' | 'minimal';

export type GlassQuality = 'auto' | EffectiveGlassQuality;

export type GlassPriority = 'critical' | 'high' | 'normal' | 'low' | 'decorative';

export type GlassRenderer = 'system' | 'shaderGlass' | 'nativeBlur' | 'acrylic';

/** `'system'` follows the OS appearance. Any other string is parsed as a color. */
export type GlassTint = 'system' | 'light' | 'dark' | (string & {});

export type GlassThermalState = 'nominal' | 'fair' | 'serious' | 'critical';

export type GlassScrollState = 'idle' | 'slow' | 'fast';

export type GlassDowngradeReason =
  | 'thermal'
  | 'lowPower'
  | 'lowMemory'
  | 'surfaceCount'
  | 'surfaceArea'
  | 'scrolling'
  | 'framePerformance'
  | 'accessibility'
  | null;

export interface GlassCapabilities {
  quality: EffectiveGlassQuality;
  renderer: GlassRenderer;
  liveBlur: boolean;
  refraction: boolean;
  dynamicHighlights: boolean;
  maxBlurRadius: number;
  maxLiveSurfaces: number;
  shaderQuality: 0 | 1 | 2 | 3;
  refreshRate: number;
}

export interface GlassPerformanceMetrics {
  refreshRate: number;
  targetFrameTimeMs: number;
  averageFrameTimeMs: number;
  worstRecentFrameTimeMs: number;
  approximateFps: number;
  droppedFrameRatio: number;

  visibleSurfaceCount: number;
  /** Visible glass area in points (iOS) / dp (Android). */
  visibleGlassArea: number;
  /** visibleGlassArea / screen area. Can exceed 1 when surfaces overlap. */
  surfaceCoverage: number;
  liveSurfaceCount: number;

  quality: EffectiveGlassQuality;
  requestedQuality: GlassQuality;
  renderer: GlassRenderer;
  deviceScore: number;

  thermalState: GlassThermalState;
  lowPowerMode: boolean;
  lowMemory: boolean;
  reduceTransparency: boolean;
  reduceMotion: boolean;
  scrollState: GlassScrollState;

  downgraded: boolean;
  downgradeReason: GlassDowngradeReason;
  /** False when the native module is missing (Expo Go, web). */
  nativeAvailable: boolean;
}

export interface GlassDeviceInfo {
  platform: 'ios' | 'android';
  osVersion: string;
  /** Android API level, or iOS major version. */
  apiLevel: number;
  totalMemoryMB: number;
  lowRamDevice: boolean;
  cpuCores: number;
  /** Android `Build.VERSION.MEDIA_PERFORMANCE_CLASS`, 0 when undeclared or on iOS. */
  performanceClass: number;
  screenWidth: number;
  screenHeight: number;
  screenScale: number;
  maxRefreshRate: number;
  supportsSystemGlass: boolean;
  supportsLiveBlur: boolean;
  supportsShader: boolean;
}

export interface GlassProviderProps {
  children?: ReactNode;
  /** Anything but `'auto'` pins every surface to that tier, still capped by the platform. */
  quality?: GlassQuality;
  /** Upper bound for surfaces rendered with live blur. The tier's own limit still applies. */
  maxLiveSurfaces?: number;
  adaptivePerformance?: boolean;
  respectLowPowerMode?: boolean;
  respectReduceTransparency?: boolean;
}

export interface GlassSurfaceProps extends Omit<ViewProps, 'style'> {
  children?: ReactNode;
  quality?: GlassQuality;
  priority?: GlassPriority;
  /** 0..1 */
  intensity?: number;
  tint?: GlassTint;
  cornerRadius?: number;
  /** Native touch highlight. Touch coordinates never reach JS. */
  interactive?: boolean;
  refraction?: boolean;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  /** Follows the finger natively and springs back on release. */
  draggable?: boolean;
  onDragStart?: () => void;
  /** release offset from the resting position, in points */
  onDragEnd?: (offset: { x: number; y: number }) => void;
  style?: StyleProp<ViewStyle>;
}

export interface GlassBackdropProps extends ViewProps {
  children?: ReactNode;
}

export interface GlassTabBarProps extends Omit<ViewProps, 'children'> {
  /** one child per tab. They're visual only, the bar handles touches */
  children: ReactNode;
  selectedIndex: number;
  onSelect: (index: number) => void;
  tint?: GlassTint;
  cornerRadius?: number;
  intensity?: number;
}

export interface GlassGroupProps extends ViewProps {
  children?: ReactNode;
  /** How close two surfaces get before they merge, in points. */
  spacing?: number;
  /** where the group draws the merged glass itself (Android, iOS before 26) */
  tint?: GlassTint;
  intensity?: number;
}
