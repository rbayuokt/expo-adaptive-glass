import {
  allocate,
  allocationFor,
  computeDeviceScore,
  platformRenderer,
  rendererFor,
  scoreToQuality,
  surfaceCost,
  type SurfaceDemand,
} from '../policy';
import { devices } from './fixtures';

const surface = (id: string, over: Partial<SurfaceDemand> = {}): SurfaceDemand => ({
  id,
  priority: 'normal',
  requestedQuality: 'auto',
  interactive: false,
  refraction: true,
  coverage: 0.1,
  order: Number(id.replace(/\D/g, '')) || 0,
  ...over,
});

describe('capability scoring', () => {
  it('ranks devices in a sensible order', () => {
    const s = (d: keyof typeof devices) => computeDeviceScore(devices[d]);
    expect(s('highEndIphone')).toBeGreaterThan(s('olderIphone'));
    expect(s('highEndAndroid')).toBeGreaterThan(s('midAndroid'));
    expect(s('midAndroid')).toBeGreaterThan(s('lowEndAndroid'));
    expect(s('lowEndAndroid')).toBeGreaterThan(s('lowRamAndroid'));
  });

  it('maps flagships to ultra and weak devices to low tiers', () => {
    expect(scoreToQuality(computeDeviceScore(devices.highEndIphone))).toBe('ultra');
    expect(scoreToQuality(computeDeviceScore(devices.highEndAndroid))).toBe('ultra');
    expect(['low', 'minimal']).toContain(scoreToQuality(computeDeviceScore(devices.lowEndAndroid)));
    expect(scoreToQuality(computeDeviceScore(devices.lowRamAndroid))).toBe('minimal');
  });

  it('scores 0 without native info', () => {
    expect(computeDeviceScore(null)).toBe(0);
  });
});

describe('renderer selection', () => {
  it('picks the best renderer the platform supports', () => {
    expect(platformRenderer(devices.highEndIphone)).toBe('system');
    expect(platformRenderer(devices.olderIphone)).toBe('nativeBlur');
    expect(platformRenderer(devices.highEndAndroid)).toBe('shaderGlass');
    expect(platformRenderer(devices.android12)).toBe('nativeBlur');
    expect(platformRenderer(devices.lowEndAndroid)).toBe('acrylic');
    expect(platformRenderer(devices.lowRamAndroid)).toBe('acrylic');
    expect(platformRenderer(null)).toBe('acrylic');
  });

  it('steps down progressively by tier', () => {
    expect(rendererFor('ultra', 'shaderGlass')).toBe('shaderGlass');
    expect(rendererFor('high', 'shaderGlass')).toBe('shaderGlass');
    expect(rendererFor('medium', 'shaderGlass')).toBe('nativeBlur');
    expect(rendererFor('medium', 'system')).toBe('system');
    expect(rendererFor('low', 'system')).toBe('acrylic');
    expect(rendererFor('minimal', 'shaderGlass')).toBe('acrylic');
  });

  it('never exceeds the platform ceiling', () => {
    expect(rendererFor('ultra', 'nativeBlur')).toBe('nativeBlur');
    expect(rendererFor('ultra', 'acrylic')).toBe('acrylic');
  });

  it('drops refraction before blur', () => {
    const high = allocationFor('high', 'shaderGlass');
    const medium = allocationFor('medium', 'shaderGlass');
    expect(allocationFor('ultra', 'shaderGlass').refraction).toBeGreaterThan(high.refraction);
    expect(medium.refraction).toBe(0);
    expect(medium.blur).toBeGreaterThan(0);
    expect(allocationFor('low', 'shaderGlass').blur).toBe(0);
  });

  it('turns off moving effects while scrolling fast', () => {
    const a = allocationFor('ultra', 'shaderGlass', {
      scrollState: 'fast',
      reduceMotion: false,
      reduceTransparency: false,
    });
    expect(a.refraction).toBe(0);
    expect(a.dynamicHighlights).toBe(false);
    expect(a.renderer).toBe('shaderGlass');
  });

  it('renders an opaque material under Reduce Transparency', () => {
    const a = allocationFor('ultra', 'system', {
      scrollState: 'idle',
      reduceMotion: false,
      reduceTransparency: true,
    });
    expect(a).toMatchObject({ renderer: 'acrylic', opaque: true, quality: 'minimal' });
  });
});

describe('cost model', () => {
  it('charges by area, not just count', () => {
    const button = 1600 / (393 * 852);
    const buttons = 20 * surfaceCost(button, 'ultra', 'system', false);
    const fullscreen = surfaceCost(1, 'ultra', 'system', false);
    expect(buttons).toBeLessThan(fullscreen);
  });

  it('makes acrylic much cheaper than live glass', () => {
    expect(surfaceCost(0.5, 'low', 'acrylic', false)).toBeLessThan(
      surfaceCost(0.5, 'medium', 'nativeBlur', false) / 5
    );
  });
});

describe('allocation', () => {
  const base = {
    ceiling: 'ultra' as const,
    platformCeiling: 'shaderGlass' as const,
    budget: 3,
    maxLiveSurfaces: Infinity,
    modifiers: { scrollState: 'idle' as const, reduceMotion: false, reduceTransparency: false },
  };

  it('gives a single surface the full ceiling', () => {
    const r = allocate({ ...base, surfaces: [surface('s1')] });
    expect(r.allocations.get('s1')!.quality).toBe('ultra');
    expect(r.pressure).toBe(false);
  });

  it('spends the live limit on whole priority groups', () => {
    const nav = [surface('n1', { priority: 'critical' }), surface('n2', { priority: 'critical' })];
    const cards = Array.from({ length: 12 }, (_, i) => surface(`s${i}`, { coverage: 0.02 }));
    const r = allocate({ ...base, surfaces: [...nav, ...cards], maxLiveSurfaces: 3 });
    expect(nav.map((s) => r.allocations.get(s.id)!.renderer)).toEqual([
      'shaderGlass',
      'shaderGlass',
    ]);
    // twelve cards cannot all be live, so none are, instead of one live and eleven acrylic
    expect(new Set(cards.map((s) => r.allocations.get(s.id)!.renderer))).toEqual(
      new Set(['acrylic'])
    );
    expect(r.liveLimited).toBe(true);
  });

  it('gives every surface of one priority the same tier', () => {
    const cards = Array.from({ length: 6 }, (_, i) =>
      surface(`c${i}`, { coverage: 0.05 + i * 0.03 })
    );
    const r = allocate({ ...base, surfaces: cards });
    expect(new Set(cards.map((s) => r.allocations.get(s.id)!.quality)).size).toBe(1);
  });

  it('keeps the critical nav bar at the best tier among many cards', () => {
    const cards = Array.from({ length: 20 }, (_, i) => surface(`card${i + 1}`, { coverage: 0.2 }));
    const nav = surface('nav', { priority: 'critical', coverage: 0.12, order: 99 });
    const r = allocate({ ...base, surfaces: [...cards, nav] });
    expect(r.allocations.get('nav')!.quality).toBe('ultra');
    const cardQualities = cards.map((c) => r.allocations.get(c.id)!.quality);
    expect(cardQualities.filter((q) => q === 'ultra')).toHaveLength(0);
    expect(cardQualities).toContain('low');
  });

  it('degrades decorative surfaces first under pressure', () => {
    const surfaces = [
      surface('d1', { priority: 'decorative', coverage: 0.5 }),
      ...Array.from({ length: 10 }, (_, i) => surface(`n${i + 2}`, { coverage: 0.3 })),
    ];
    const r = allocate({ ...base, surfaces });
    expect(r.allocations.get('d1')!.quality).toBe('minimal');
  });

  it('leaves the surfaces behind an open menu exactly as they were', () => {
    const cards = Array.from({ length: 6 }, (_, i) => surface(`c${i}`, { coverage: 0.2 }));
    const before = allocate({ ...base, surfaces: cards });
    const menu = surface('menu', { priority: 'high', coverage: 1, overlay: true });
    const after = allocate({ ...base, surfaces: [...cards, menu] });
    for (const c of cards)
      expect(after.allocations.get(c.id)).toEqual(before.allocations.get(c.id));
    expect(after.allocations.get('menu')!.quality).toBe('ultra');
    expect(after.pressure).toBe(before.pressure);
  });

  it('lets pinned surfaces bypass the budget but stay inside the platform', () => {
    const r = allocate({
      ...base,
      platformCeiling: 'nativeBlur',
      budget: 0.01,
      surfaces: [surface('p1', { requestedQuality: 'ultra' })],
    });
    expect(r.allocations.get('p1')).toMatchObject({ quality: 'ultra', renderer: 'nativeBlur' });
  });
});
