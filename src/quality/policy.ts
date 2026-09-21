import type {
  EffectiveGlassQuality,
  GlassDeviceInfo,
  GlassPriority,
  GlassQuality,
  GlassRenderer,
  GlassThermalState,
} from '../types';

// Every tunable lives here. None of it is benchmarked yet, tune once real device numbers exist.
export const POLICY = {
  score: {
    weights: { memory: 30, os: 20, renderer: 25, refresh: 10, generation: 15 },
    lowRamPenalty: 30,
    // minimum score for each tier
    tiers: { ultra: 80, high: 62, medium: 45, low: 28 },
  },
  caps: {
    thermal: { nominal: 'ultra', fair: 'high', serious: 'medium', critical: 'low' },
    lowPower: 'medium',
    lowMemory: 'low',
  },
  frames: {
    // average frame time / target frame time
    stressRatio: 1.25,
    stressDropped: 0.1,
    comfortRatio: 1.08,
    comfortDropped: 0.03,
    minSamples: 10,
    downgradeAfterMs: 750,
    upgradeAfterMs: 4000,
    // an upgrade that gets undone within this window doubles the next upgrade wait
    failedUpgradeWindowMs: 10000,
    maxUpgradeAfterMs: 60000,
    resetBackoffAfterMs: 30000,
    floor: 'low',
  },
  budget: {
    // screen-equivalents of ultra live glass the device can afford
    min: 0.4,
    max: 3.0,
    perSurfaceOverhead: { live: 0.04, acrylic: 0.005 },
    interactiveMultiplier: 1.15,
    rendererCost: { system: 1.2, shaderGlass: 1.4, nativeBlur: 1.0, acrylic: 0.1 },
    qualityCost: { ultra: 1.0, high: 0.85, medium: 0.7, low: 0.4, minimal: 0.3 },
    // coverage assumed for a surface native has not measured yet
    unmeasuredCoverage: 0.08,
  },
  // prettier-ignore
  tiers: {
    ultra: { blur: 1.0, refraction: 1.0, dynamicHighlights: true, shader: 3, maxBlurRadius: 28, maxLive: 12 },
    high: { blur: 0.9, refraction: 0.5, dynamicHighlights: true, shader: 2, maxBlurRadius: 25, maxLive: 10 },
    medium: { blur: 0.75, refraction: 0, dynamicHighlights: false, shader: 1, maxBlurRadius: 21, maxLive: 6 },
    low: { blur: 0, refraction: 0, dynamicHighlights: false, shader: 0, maxBlurRadius: 0, maxLive: 0 },
    minimal: { blur: 0, refraction: 0, dynamicHighlights: false, shader: 0, maxBlurRadius: 0, maxLive: 0 },
  },
} as const;

export const QUALITY_LEVELS: readonly EffectiveGlassQuality[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'ultra',
];

export const PRIORITY_RANK: Record<GlassPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  decorative: 4,
};

export const levelOf = (q: EffectiveGlassQuality) => QUALITY_LEVELS.indexOf(q);
export const qualityAt = (level: number) =>
  QUALITY_LEVELS[Math.max(0, Math.min(QUALITY_LEVELS.length - 1, level))];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function platformRenderer(device: GlassDeviceInfo | null): GlassRenderer {
  if (!device || device.lowRamDevice) return 'acrylic';
  if (device.supportsSystemGlass) return 'system';
  if (device.supportsShader) return 'shaderGlass';
  if (device.supportsLiveBlur) return 'nativeBlur';
  return 'acrylic';
}

export function computeDeviceScore(device: GlassDeviceInfo | null): number {
  if (!device) return 0;
  const w = POLICY.score.weights;
  const gb = device.totalMemoryMB / 1024;
  const ios = device.platform === 'ios';

  // iOS gets by with less RAM than Android for the same visual load
  const memory = ios ? clamp01((gb - 2) / 4) : clamp01((gb - 2) / 6);
  const os = ios
    ? device.apiLevel >= 26
      ? 1
      : device.apiLevel >= 17
        ? 0.8
        : device.apiLevel >= 16
          ? 0.6
          : 0.5
    : device.apiLevel >= 33
      ? 1
      : device.apiLevel >= 31
        ? 0.75
        : device.apiLevel >= 29
          ? 0.45
          : 0.2;
  const renderer = { system: 1, shaderGlass: 1, nativeBlur: 0.75, acrylic: 0.2 }[
    platformRenderer({ ...device, lowRamDevice: false })
  ];
  const refresh = device.maxRefreshRate >= 118 ? 1 : device.maxRefreshRate >= 88 ? 0.8 : 0.6;
  let generation: number;
  if (ios) {
    generation = device.cpuCores >= 6 ? 0.9 : 0.6;
  } else {
    const pc = device.performanceClass;
    generation = pc >= 34 ? 1 : pc >= 33 ? 0.9 : pc >= 31 ? 0.75 : pc >= 30 ? 0.6 : 0.4;
  }

  let score =
    memory * w.memory +
    os * w.os +
    renderer * w.renderer +
    refresh * w.refresh +
    generation * w.generation;
  if (device.lowRamDevice) score -= POLICY.score.lowRamPenalty;
  return Math.round(Math.max(0, Math.min(100, score)));
}

export function scoreToQuality(score: number): EffectiveGlassQuality {
  const t = POLICY.score.tiers;
  if (score >= t.ultra) return 'ultra';
  if (score >= t.high) return 'high';
  if (score >= t.medium) return 'medium';
  if (score >= t.low) return 'low';
  return 'minimal';
}

export function budgetForScore(score: number) {
  const { min, max } = POLICY.budget;
  return min + (max - min) * clamp01(score / 100);
}

export function thermalCap(state: GlassThermalState): EffectiveGlassQuality {
  return POLICY.caps.thermal[state];
}

export function rendererFor(quality: EffectiveGlassQuality, ceiling: GlassRenderer): GlassRenderer {
  switch (quality) {
    case 'ultra':
    case 'high':
      return ceiling;
    case 'medium':
      // the shader pass only carries refraction and moving highlights, which medium drops
      return ceiling === 'shaderGlass' ? 'nativeBlur' : ceiling;
    default:
      return 'acrylic';
  }
}

export interface SurfaceAllocation {
  quality: EffectiveGlassQuality;
  renderer: GlassRenderer;
  blur: number;
  refraction: number;
  dynamicHighlights: boolean;
  shaderQuality: 0 | 1 | 2 | 3;
  /** set under Reduce Transparency */
  opaque: boolean;
  reduceMotion: boolean;
}

export interface AllocationModifiers {
  scrollState: 'idle' | 'slow' | 'fast';
  reduceTransparency: boolean;
  reduceMotion: boolean;
}

export const NO_MODIFIERS: AllocationModifiers = {
  scrollState: 'idle',
  reduceTransparency: false,
  reduceMotion: false,
};

export function allocationFor(
  quality: EffectiveGlassQuality,
  ceiling: GlassRenderer,
  mods: AllocationModifiers = NO_MODIFIERS,
  refractionAllowed = true
): SurfaceAllocation {
  if (mods.reduceTransparency) {
    return {
      quality: 'minimal',
      renderer: 'acrylic',
      blur: 0,
      refraction: 0,
      dynamicHighlights: false,
      shaderQuality: 0,
      opaque: true,
      reduceMotion: mods.reduceMotion,
    };
  }
  const tier = POLICY.tiers[quality];
  const renderer = rendererFor(quality, ceiling);
  let refraction: number = refractionAllowed ? tier.refraction : 0;
  let dynamicHighlights: boolean = tier.dynamicHighlights && !mods.reduceMotion;
  if (mods.scrollState === 'slow') refraction *= 0.5;
  if (mods.scrollState === 'fast') {
    refraction = 0;
    dynamicHighlights = false;
  }
  return {
    quality,
    renderer,
    blur: renderer === 'acrylic' ? 0 : tier.blur,
    refraction: renderer === 'shaderGlass' || renderer === 'system' ? refraction : 0,
    dynamicHighlights,
    shaderQuality: renderer === 'shaderGlass' ? tier.shader : 0,
    opaque: false,
    reduceMotion: mods.reduceMotion,
  };
}

export function sameAllocation(a: SurfaceAllocation | undefined, b: SurfaceAllocation) {
  return (
    !!a &&
    a.quality === b.quality &&
    a.renderer === b.renderer &&
    a.blur === b.blur &&
    a.refraction === b.refraction &&
    a.dynamicHighlights === b.dynamicHighlights &&
    a.shaderQuality === b.shaderQuality &&
    a.opaque === b.opaque &&
    a.reduceMotion === b.reduceMotion
  );
}

/** Approximate GPU cost in screen-equivalents of ultra live glass. */
export function surfaceCost(
  coverage: number,
  quality: EffectiveGlassQuality,
  renderer: GlassRenderer,
  interactive: boolean
) {
  const b = POLICY.budget;
  const overhead =
    renderer === 'acrylic' ? b.perSurfaceOverhead.acrylic : b.perSurfaceOverhead.live;
  const area = coverage * b.rendererCost[renderer] * b.qualityCost[quality];
  return (overhead + area) * (interactive ? b.interactiveMultiplier : 1);
}

export interface SurfaceDemand {
  id: string;
  priority: GlassPriority;
  requestedQuality: GlassQuality;
  interactive: boolean;
  refraction: boolean;
  coverage: number;
  /** registration order, the final tie break */
  order: number;
  previous?: SurfaceAllocation;
  /** keep `previous` (clamped to the ceiling) instead of re-ranking */
  locked?: boolean;
}

export interface AllocationInput {
  surfaces: SurfaceDemand[];
  /** tier ceiling after device, thermal, power and frame caps */
  ceiling: EffectiveGlassQuality;
  platformCeiling: GlassRenderer;
  budget: number;
  maxLiveSurfaces: number;
  modifiers: AllocationModifiers;
}

export interface AllocationResult {
  allocations: Map<string, SurfaceAllocation>;
  pressure: boolean;
  budgetLimited: boolean;
  liveLimited: boolean;
  cost: number;
}

// under pressure, less important surfaces are capped before the budget is consulted
function pressureCap(priority: GlassPriority, ceiling: number) {
  switch (priority) {
    case 'critical':
    case 'high':
      return ceiling;
    case 'normal':
      return Math.max(levelOf('low'), ceiling - 1);
    case 'low':
      return Math.min(ceiling, levelOf('low'));
    case 'decorative':
      return levelOf('minimal');
  }
}

export function allocate(input: AllocationInput): AllocationResult {
  const { ceiling, platformCeiling, budget, modifiers } = input;
  const ceilingLevel = levelOf(ceiling);
  const maxLive = Math.min(input.maxLiveSurfaces, POLICY.tiers[ceiling].maxLive);

  const auto = input.surfaces.filter((s) => s.requestedQuality === 'auto');
  const demand = auto.reduce(
    (sum, s) =>
      sum + surfaceCost(s.coverage, ceiling, rendererFor(ceiling, platformCeiling), s.interactive),
    0
  );
  const liveAtCeiling = rendererFor(ceiling, platformCeiling) !== 'acrylic';
  const pressure = demand > budget || (liveAtCeiling && auto.length > maxLive);

  const allocations = new Map<string, SurfaceAllocation>();
  let remaining = budget;
  let live = 0;
  let cost = 0;
  let budgetLimited = false;
  let liveLimited = false;

  const assign = (s: SurfaceDemand, q: EffectiveGlassQuality) => {
    const a = allocationFor(q, platformCeiling, modifiers, s.refraction);
    const c = surfaceCost(s.coverage, a.quality, a.renderer, s.interactive);
    remaining -= c;
    cost += c;
    if (a.renderer !== 'acrylic') live++;
    allocations.set(s.id, a);
  };

  // pinned surfaces skip the budget but still count against it
  for (const s of input.surfaces) {
    if (s.requestedQuality !== 'auto') assign(s, s.requestedQuality);
  }

  // same priority, same tier: a list of cards never ends up half glass, half acrylic
  const groups = new Map<GlassPriority, SurfaceDemand[]>();
  for (const s of auto) {
    const g = groups.get(s.priority);
    if (g) g.push(s);
    else groups.set(s.priority, [s]);
  }
  const byRank = [...groups.entries()].sort((a, b) => PRIORITY_RANK[a[0]] - PRIORITY_RANK[b[0]]);

  for (const [priority, members] of byRank) {
    // mid-scroll, new cells join the group's tier. May briefly pass the live limit until the re-rank
    const locked = members.find((s) => s.locked && s.previous);
    if (locked) {
      const q = qualityAt(Math.min(levelOf(locked.previous!.quality), ceilingLevel));
      members.forEach((s) => assign(s, q));
      continue;
    }

    const cap = pressure ? pressureCap(priority, ceilingLevel) : ceilingLevel;
    let chosen = Math.min(cap, levelOf('low'));
    for (let level = cap; level > levelOf('low'); level--) {
      const q = qualityAt(level);
      const r = rendererFor(q, platformCeiling);
      if (r !== 'acrylic' && live + members.length > maxLive) {
        liveLimited = true;
        continue;
      }
      const groupCost = members.reduce(
        (sum, s) => sum + surfaceCost(s.coverage, q, r, s.interactive),
        0
      );
      if (groupCost <= remaining) {
        chosen = level;
        break;
      }
      budgetLimited = true;
    }
    const q = qualityAt(chosen);
    members.forEach((s) => assign(s, q));
  }

  return { allocations, pressure, budgetLimited, liveLimited, cost };
}

export function effectiveQualityFor(
  requested: GlassQuality,
  deviceQuality: EffectiveGlassQuality
): EffectiveGlassQuality {
  return requested === 'auto' ? deviceQuality : requested;
}
