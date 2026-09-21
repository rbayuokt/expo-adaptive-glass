import type { NativeGlassStats } from '../ExpoAdaptiveGlassModule';
import type {
  EffectiveGlassQuality,
  GlassCapabilities,
  GlassDeviceInfo,
  GlassDowngradeReason,
  GlassPerformanceMetrics,
  GlassPriority,
  GlassQuality,
  GlassRenderer,
} from '../types';
import { QualityController } from './QualityController';
import {
  POLICY,
  allocate,
  budgetForScore,
  computeDeviceScore,
  levelOf,
  platformRenderer,
  qualityAt,
  rendererFor,
  sameAllocation,
  scoreToQuality,
  thermalCap,
  type AllocationModifiers,
  type SurfaceAllocation,
  type SurfaceDemand,
} from './policy';

export interface ManagerOptions {
  quality: GlassQuality;
  maxLiveSurfaces: number;
  adaptivePerformance: boolean;
  respectLowPowerMode: boolean;
  respectReduceTransparency: boolean;
}

export const DEFAULT_OPTIONS: ManagerOptions = {
  quality: 'auto',
  maxLiveSurfaces: Infinity,
  adaptivePerformance: true,
  respectLowPowerMode: true,
  respectReduceTransparency: true,
};

export interface SurfaceDescriptor {
  priority: GlassPriority;
  requestedQuality: GlassQuality;
  interactive: boolean;
  refraction: boolean;
}

export type StatsSource = (listener: (stats: NativeGlassStats) => void) => () => void;

export interface GlassQualityState {
  requestedQuality: GlassQuality;
  quality: EffectiveGlassQuality;
  renderer: GlassRenderer;
  downgradeReason: GlassDowngradeReason;
}

type Listener = () => void;

export class GlassQualityManager {
  readonly device: GlassDeviceInfo | null;
  readonly deviceScore: number;
  readonly deviceQuality: EffectiveGlassQuality;
  readonly platformCeiling: GlassRenderer;

  private options: ManagerOptions = DEFAULT_OPTIONS;
  private readonly controller: QualityController;
  private readonly surfaces = new Map<string, SurfaceDescriptor & { order: number }>();
  private order = 0;
  private stats: NativeGlassStats | null = null;
  private visible: Map<string, { area: number; renderer: GlassRenderer }> | null = null;
  // registered after the last stats window, so native has not measured them yet
  private unmeasured = new Set<string>();
  private allocations = new Map<string, SurfaceAllocation>();
  private provisional = new Map<string, SurfaceAllocation>();

  private qualityState: GlassQualityState;
  private capabilities: GlassCapabilities;
  private metrics: GlassPerformanceMetrics;

  private readonly allocationListeners = new Set<Listener>();
  private readonly qualityListeners = new Set<Listener>();
  private readonly metricsListeners = new Set<Listener>();
  private unsubscribeStats: (() => void) | null = null;

  constructor(
    device: GlassDeviceInfo | null,
    private readonly source: StatsSource | null = null,
    private readonly now: () => number = Date.now
  ) {
    this.device = device;
    this.deviceScore = computeDeviceScore(device);
    this.deviceQuality = device ? scoreToQuality(this.deviceScore) : 'low';
    this.platformCeiling = platformRenderer(device);
    this.controller = new QualityController(levelOf(this.deviceQuality));
    this.qualityState = {
      requestedQuality: 'auto',
      quality: this.deviceQuality,
      renderer: rendererFor(this.deviceQuality, this.platformCeiling),
      downgradeReason: null,
    };
    this.capabilities = this.buildCapabilities(this.deviceQuality, false);
    this.metrics = this.buildMetrics(0, 0);
    this.recompute();
  }

  setOptions(options: Partial<ManagerOptions>) {
    const next = { ...DEFAULT_OPTIONS, ...stripUndefined(options) };
    const o = this.options;
    if (
      o.quality === next.quality &&
      o.maxLiveSurfaces === next.maxLiveSurfaces &&
      o.adaptivePerformance === next.adaptivePerformance &&
      o.respectLowPowerMode === next.respectLowPowerMode &&
      o.respectReduceTransparency === next.respectReduceTransparency
    ) {
      return;
    }
    this.options = next;
    this.recompute();
    this.syncSubscription();
  }

  register(id: string, desc: SurfaceDescriptor) {
    const existing = this.surfaces.get(id);
    if (
      existing &&
      existing.priority === desc.priority &&
      existing.requestedQuality === desc.requestedQuality &&
      existing.interactive === desc.interactive &&
      existing.refraction === desc.refraction
    ) {
      return;
    }
    this.surfaces.set(id, { ...desc, order: existing?.order ?? this.order++ });
    this.provisional.delete(id);
    if (!existing) this.unmeasured.add(id);
    this.recompute();
    this.syncSubscription();
  }

  unregister(id: string) {
    if (!this.surfaces.delete(id)) return;
    this.unmeasured.delete(id);
    this.allocations.delete(id);
    this.visible?.delete(id);
    this.recompute();
    this.syncSubscription();
  }

  get surfaceCount() {
    return this.surfaces.size;
  }

  ingest(stats: NativeGlassStats) {
    this.stats = stats;
    this.visible = new Map(
      stats.surfaces.map((s) => [s.id, { area: s.area, renderer: s.renderer }])
    );
    this.unmeasured.clear();
    if (this.options.quality === 'auto' && this.options.adaptivePerformance) {
      // frame drops only count while glass is on screen
      const frames = stats.surfaces.length > 0 ? stats : null;
      this.controller.update(
        frames ?? { ...stats, sampleCount: 0 },
        levelOf(this.staticCeiling()),
        this.now()
      );
    }
    this.recompute();
  }

  getAllocation = (id: string, desc: SurfaceDescriptor): SurfaceAllocation => {
    const a = this.allocations.get(id);
    if (a) return a;
    // first render, before registration: budget it now so a new list cell doesn't pop a frame later
    let p = this.provisional.get(id);
    if (!p) {
      const plan = this.plan({ id, ...desc, order: this.order });
      p = allocate(plan.input).allocations.get(id)!;
      this.provisional.set(id, p);
    }
    return p;
  };

  getQualityState = () => this.qualityState;
  getCapabilities = () => this.capabilities;
  getMetrics = () => this.metrics;

  subscribeAllocations = (l: Listener) => this.listen(this.allocationListeners, l);
  subscribeQuality = (l: Listener) => this.listen(this.qualityListeners, l);
  subscribeMetrics = (l: Listener) => {
    const off = this.listen(this.metricsListeners, l);
    this.syncSubscription();
    return () => {
      off();
      this.syncSubscription();
    };
  };

  /** Pair with dispose() in an effect. */
  attach() {
    this.syncSubscription();
  }

  dispose() {
    this.unsubscribeStats?.();
    this.unsubscribeStats = null;
  }

  private listen(set: Set<Listener>, l: Listener) {
    set.add(l);
    return () => {
      set.delete(l);
    };
  }

  private syncSubscription() {
    if (!this.source) return;
    const want =
      this.metricsListeners.size > 0 || (this.surfaces.size > 0 && this.options.quality === 'auto');
    if (want && !this.unsubscribeStats) {
      this.unsubscribeStats = this.source((s) => this.ingest(s));
    } else if (!want && this.unsubscribeStats) {
      this.unsubscribeStats();
      this.unsubscribeStats = null;
    }
  }

  private modifiers(): AllocationModifiers {
    const s = this.stats;
    return {
      scrollState: this.options.quality === 'auto' ? (s?.scrollState ?? 'idle') : 'idle',
      reduceTransparency: !!s?.reduceTransparency && this.options.respectReduceTransparency,
      reduceMotion: !!s?.reduceMotion,
    };
  }

  /** Device tier after thermal, power and memory caps, before frame feedback. */
  private staticCeiling(): EffectiveGlassQuality {
    return qualityAt(Math.min(...this.caps().map((c) => levelOf(c.cap))));
  }

  private caps(): { cap: EffectiveGlassQuality; reason: GlassDowngradeReason }[] {
    const s = this.stats;
    const caps: { cap: EffectiveGlassQuality; reason: GlassDowngradeReason }[] = [
      { cap: this.deviceQuality, reason: null },
    ];
    if (!s) return caps;
    caps.push({ cap: thermalCap(s.thermalState), reason: 'thermal' });
    if (s.lowPowerMode && this.options.respectLowPowerMode) {
      caps.push({ cap: POLICY.caps.lowPower, reason: 'lowPower' });
    }
    if (s.lowMemory) caps.push({ cap: POLICY.caps.lowMemory, reason: 'lowMemory' });
    return caps;
  }

  private plan(extra?: SurfaceDescriptor & { id: string; order: number }) {
    const forced = this.options.quality !== 'auto';
    const mods = this.modifiers();
    let ceiling: EffectiveGlassQuality;
    let reason: GlassDowngradeReason = null;

    if (forced) {
      ceiling = this.options.quality as EffectiveGlassQuality;
    } else {
      const staticCeiling = this.staticCeiling();
      const adaptive = this.options.adaptivePerformance;
      ceiling = adaptive
        ? qualityAt(Math.min(levelOf(staticCeiling), this.controller.level))
        : staticCeiling;
      const binding = this.caps().find(
        (c) => c.reason && levelOf(c.cap) < levelOf(this.deviceQuality) && c.cap === staticCeiling
      );
      if (binding) reason = binding.reason;
      else if (adaptive && this.controller.level < levelOf(staticCeiling))
        reason = 'framePerformance';
      else if (mods.scrollState === 'fast') reason = 'scrolling';
    }

    const screenArea = this.device ? this.device.screenWidth * this.device.screenHeight : 1;
    // mid-scroll everything keeps its allocation, re-rank once motion stops
    const lock = mods.scrollState !== 'idle';
    const demands: SurfaceDemand[] = [];
    const entries: [string, SurfaceDescriptor & { order: number }][] = [...this.surfaces];
    if (extra) entries.push([extra.id, extra]);
    for (const [id, s] of entries) {
      const v = this.visible?.get(id);
      const isNew = id === extra?.id;
      if (!v && this.visible && !this.unmeasured.has(id) && !isNew) continue; // offscreen
      const previous = this.allocations.get(id);
      demands.push({
        id,
        priority: s.priority,
        requestedQuality:
          forced && s.requestedQuality === 'auto' ? this.options.quality : s.requestedQuality,
        interactive: s.interactive,
        refraction: s.refraction,
        coverage: v ? v.area / screenArea : POLICY.budget.unmeasuredCoverage,
        order: s.order,
        previous,
        locked: lock && !!previous,
      });
    }

    return {
      forced,
      mods,
      ceiling,
      reason,
      screenArea,
      demands,
      input: {
        surfaces: demands,
        ceiling,
        platformCeiling: this.platformCeiling,
        budget: budgetForScore(this.deviceScore),
        maxLiveSurfaces: this.options.maxLiveSurfaces,
        modifiers: mods,
      },
    };
  }

  private recompute() {
    const plan = this.plan();
    const { forced, mods, ceiling, screenArea, demands } = plan;
    let reason = plan.reason;
    const result = allocate(plan.input);
    this.provisional.clear();

    if (!forced && !reason && (result.pressure || result.budgetLimited || result.liveLimited)) {
      reason =
        result.liveLimited || demands.length > POLICY.tiers[ceiling].maxLive
          ? 'surfaceCount'
          : 'surfaceArea';
    }
    if (mods.reduceTransparency) reason = 'accessibility';

    let changed = false;
    for (const [id, a] of result.allocations) {
      const prev = this.allocations.get(id);
      if (!sameAllocation(prev, a)) {
        this.allocations.set(id, a);
        changed = true;
      }
    }

    const renderer = mods.reduceTransparency
      ? 'acrylic'
      : rendererFor(ceiling, this.platformCeiling);
    const q = this.qualityState;
    const quality = mods.reduceTransparency ? 'minimal' : ceiling;
    if (
      q.quality !== quality ||
      q.renderer !== renderer ||
      q.downgradeReason !== reason ||
      q.requestedQuality !== this.options.quality
    ) {
      this.qualityState = {
        requestedQuality: this.options.quality,
        quality,
        renderer,
        downgradeReason: reason,
      };
      this.capabilities = this.buildCapabilities(quality, mods.reduceTransparency);
      this.provisional.clear();
      this.qualityListeners.forEach((l) => l());
    }

    let live = 0;
    for (const id of this.visible?.keys() ?? []) {
      const a = this.allocations.get(id);
      if (a && a.renderer !== 'acrylic') live++;
    }
    this.metrics = this.buildMetrics(live, screenArea);

    if (changed) this.allocationListeners.forEach((l) => l());
    this.metricsListeners.forEach((l) => l());
  }

  private buildCapabilities(
    quality: EffectiveGlassQuality,
    reduceTransparency: boolean
  ): GlassCapabilities {
    const tier = POLICY.tiers[quality];
    const renderer = reduceTransparency ? 'acrylic' : rendererFor(quality, this.platformCeiling);
    const live = renderer !== 'acrylic';
    return {
      quality,
      renderer,
      liveBlur: live,
      refraction:
        live && tier.refraction > 0 && (renderer === 'shaderGlass' || renderer === 'system'),
      dynamicHighlights: tier.dynamicHighlights && !this.stats?.reduceMotion,
      maxBlurRadius: live ? tier.maxBlurRadius : 0,
      maxLiveSurfaces: live ? Math.min(tier.maxLive, this.options.maxLiveSurfaces) : 0,
      shaderQuality: renderer === 'shaderGlass' ? tier.shader : 0,
      refreshRate: this.stats?.refreshRate ?? this.device?.maxRefreshRate ?? 60,
    };
  }

  private buildMetrics(liveSurfaceCount: number, screenArea: number): GlassPerformanceMetrics {
    const s = this.stats;
    const refreshRate = s?.refreshRate ?? this.device?.maxRefreshRate ?? 60;
    const visibleGlassArea = s ? s.surfaces.reduce((sum, v) => sum + v.area, 0) : 0;
    // what native actually drew wins over what was asked for, e.g. no backdrop on Android
    const drawn = s?.surfaces.map((v) => v.renderer) ?? [];
    const order: GlassRenderer[] = ['system', 'shaderGlass', 'nativeBlur', 'acrylic'];
    const renderer = drawn.length
      ? order.find((r) => drawn.includes(r))!
      : this.qualityState.renderer;
    const target = s?.targetFrameTimeMs ?? 1000 / refreshRate;
    const dropped = s?.droppedFrameRatio ?? 0;
    return {
      refreshRate,
      targetFrameTimeMs: round(target),
      averageFrameTimeMs: round(s?.averageFrameTimeMs ?? 0),
      worstRecentFrameTimeMs: round(s?.worstFrameTimeMs ?? 0),
      approximateFps: Math.round(refreshRate * (1 - dropped)),
      droppedFrameRatio: round(dropped, 3),
      visibleSurfaceCount: s?.surfaces.length ?? 0,
      visibleGlassArea: Math.round(visibleGlassArea),
      surfaceCoverage: screenArea > 1 ? round(visibleGlassArea / screenArea, 3) : 0,
      liveSurfaceCount,
      quality: this.qualityState.quality,
      requestedQuality: this.qualityState.requestedQuality,
      renderer,
      deviceScore: this.deviceScore,
      thermalState: s?.thermalState ?? 'nominal',
      lowPowerMode: s?.lowPowerMode ?? false,
      lowMemory: s?.lowMemory ?? false,
      reduceTransparency: s?.reduceTransparency ?? false,
      reduceMotion: s?.reduceMotion ?? false,
      scrollState: s?.scrollState ?? 'idle',
      downgraded: this.qualityState.downgradeReason !== null,
      downgradeReason: this.qualityState.downgradeReason,
      nativeAvailable: !!this.device,
    };
  }
}

function round(v: number, digits = 2) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] !== undefined) out[k] = o[k];
  return out;
}
