import type { NativeGlassStats } from '../../ExpoAdaptiveGlassModule';
import { GlassQualityManager, type SurfaceDescriptor } from '../GlassQualityManager';
import { levelOf } from '../policy';
import { devices, stats, stressed } from './fixtures';

const desc = (over: Partial<SurfaceDescriptor> = {}): SurfaceDescriptor => ({
  priority: 'normal',
  requestedQuality: 'auto',
  interactive: false,
  refraction: true,
  ...over,
});

function setup(device: keyof typeof devices | null) {
  let t = 0;
  let emit: ((s: NativeGlassStats) => void) | null = null;
  const source = jest.fn((l: (s: NativeGlassStats) => void) => {
    emit = l;
    return () => {
      emit = null;
    };
  });
  const m = new GlassQualityManager(device ? devices[device] : null, source, () => t);
  const tick = (s: Partial<NativeGlassStats> = {}, count = 1) => {
    for (let i = 0; i < count; i++) {
      t += 500;
      m.ingest(stats(s));
    }
  };
  return { m, tick, source, isSubscribed: () => emit !== null };
}

const visible = (ids: string[], area: number) =>
  ids.map((id) => ({ id, area, renderer: 'nativeBlur' as const }));

describe('GlassQualityManager scenarios', () => {
  it('bends the lens on iOS below 26, where surfaces themselves cannot refract', () => {
    const { m, tick } = setup('olderIphone');
    m.register('a', desc());
    tick({ surfaces: visible(['a'], 20000) });
    const caps = m.getCapabilities();
    expect(caps.renderer).toBe('nativeBlur');
    expect(caps.refraction).toBe(false);
    expect(['ultra', 'high']).toContain(caps.quality);
    expect(caps.lensRefraction).toBe(true);
  });

  it('keeps the lens flat where there is no lens shader', () => {
    const { m } = setup('lowEndAndroid');
    expect(m.getCapabilities().lensRefraction).toBe(false);
  });

  it('high-end phone + 1 surface → ultra', () => {
    const { m, tick } = setup('highEndIphone');
    m.register('a', desc());
    tick({ surfaces: visible(['a'], 20000) });
    expect(m.getAllocation('a', desc()).quality).toBe('ultra');
    expect(m.getAllocation('a', desc()).renderer).toBe('system');
    expect(m.getMetrics().downgraded).toBe(false);
  });

  it('high-end phone + 25 large surfaces → lower quality', () => {
    const { m, tick } = setup('highEndAndroid');
    const ids = Array.from({ length: 25 }, (_, i) => `s${i}`);
    ids.forEach((id) => m.register(id, desc()));
    tick({ surfaces: visible(ids, 412 * 300) });
    const qs = ids.map((id) => m.getAllocation(id, desc()));
    expect(qs.filter((a) => a.renderer !== 'acrylic').length).toBeLessThanOrEqual(8);
    expect(qs.some((a) => levelOf(a.quality) < levelOf('ultra'))).toBe(true);
    expect(['surfaceCount', 'surfaceArea']).toContain(m.getQualityState().downgradeReason);
  });

  it('mid-range device + list scrolling → reduced effects', () => {
    const { m, tick } = setup('midAndroid');
    const ids = ['c1', 'c2', 'c3', 'c4'];
    ids.forEach((id) => m.register(id, desc()));
    tick({ scrollState: 'fast', surfaces: visible(ids, 412 * 120) });
    ids.forEach((id) => {
      const a = m.getAllocation(id, desc());
      expect(a.refraction).toBe(0);
      expect(a.dynamicHighlights).toBe(false);
    });
    expect(m.getQualityState().downgradeReason).toBe('scrolling');
    tick({ scrollState: 'idle', surfaces: visible(ids, 412 * 120) });
    expect(m.getQualityState().downgradeReason).not.toBe('scrolling');
  });

  it('low-RAM Android → acrylic', () => {
    const { m, tick } = setup('lowRamAndroid');
    m.register('a', desc({ requestedQuality: 'ultra' }));
    m.register('b', desc());
    tick({ surfaces: visible(['a', 'b'], 5000) });
    expect(m.getAllocation('a', desc({ requestedQuality: 'ultra' })).renderer).toBe('acrylic');
    expect(m.getAllocation('b', desc()).renderer).toBe('acrylic');
    expect(['low', 'minimal']).toContain(m.getQualityState().quality);
  });

  it('iPhone + Low Power Mode → reduced tier', () => {
    const { m, tick } = setup('highEndIphone');
    m.register('a', desc());
    tick({ lowPowerMode: true, surfaces: visible(['a'], 20000) });
    expect(levelOf(m.getQualityState().quality)).toBeLessThanOrEqual(levelOf('medium'));
    expect(m.getQualityState().downgradeReason).toBe('lowPower');
  });

  it('ignores Low Power Mode when asked to', () => {
    const { m, tick } = setup('highEndIphone');
    m.setOptions({ respectLowPowerMode: false });
    m.register('a', desc());
    tick({ lowPowerMode: true, surfaces: visible(['a'], 20000) });
    expect(m.getQualityState().quality).toBe('ultra');
  });

  it('thermal serious → downgrade, critical → acrylic', () => {
    const { m, tick } = setup('highEndIphone');
    m.register('a', desc());
    tick({ thermalState: 'serious', surfaces: visible(['a'], 20000) });
    expect(m.getQualityState()).toMatchObject({ quality: 'medium', downgradeReason: 'thermal' });
    tick({ thermalState: 'critical', surfaces: visible(['a'], 20000) });
    expect(m.getAllocation('a', desc()).renderer).toBe('acrylic');
  });

  it('frame drops → downgrade, recovery → slow upgrade', () => {
    const { m, tick } = setup('highEndAndroid');
    m.register('a', desc());
    const s = { surfaces: visible(['a'], 30000) };
    tick({ ...s, ...stressed }, 2);
    expect(m.getQualityState()).toMatchObject({
      quality: 'high',
      downgradeReason: 'framePerformance',
    });
    tick(s, 3);
    expect(m.getQualityState().quality).toBe('high');
    tick(s, 5);
    expect(m.getQualityState().quality).toBe('ultra');
  });

  it('does not blame glass for frame drops when none is visible', () => {
    const { m, tick } = setup('highEndAndroid');
    m.register('a', desc());
    tick({ ...stressed, surfaces: [] }, 6);
    expect(m.getQualityState().quality).toBe('ultra');
  });

  it('critical nav + many normal cards → nav keeps better rendering', () => {
    const { m, tick } = setup('midAndroid');
    const cards = Array.from({ length: 16 }, (_, i) => `card${i}`);
    cards.forEach((id) => m.register(id, desc()));
    m.register('nav', desc({ priority: 'critical' }));
    tick({ surfaces: [...visible(cards, 412 * 200), ...visible(['nav'], 412 * 80)] });
    const nav = m.getAllocation('nav', desc({ priority: 'critical' }));
    const best = Math.max(...cards.map((id) => levelOf(m.getAllocation(id, desc()).quality)));
    expect(levelOf(nav.quality)).toBeGreaterThanOrEqual(best);
    expect(nav.renderer).not.toBe('acrylic');
  });

  it('forced ultra on an unsupported platform → safely capped renderer', () => {
    const { m, tick } = setup('android12');
    m.setOptions({ quality: 'ultra' });
    m.register('a', desc());
    tick({ surfaces: visible(['a'], 20000) });
    expect(m.getAllocation('a', desc())).toMatchObject({
      quality: 'ultra',
      renderer: 'nativeBlur',
    });
  });

  it('forced quality ignores runtime adaptation', () => {
    const { m, tick } = setup('highEndAndroid');
    m.setOptions({ quality: 'medium' });
    m.register('a', desc());
    tick({ ...stressed, thermalState: 'serious', surfaces: visible(['a'], 20000) }, 6);
    expect(m.getQualityState()).toMatchObject({ quality: 'medium', downgradeReason: null });
  });

  it('respects maxLiveSurfaces from the provider', () => {
    const { m, tick } = setup('highEndIphone');
    m.setOptions({ maxLiveSurfaces: 2 });
    const d = {
      a: desc({ priority: 'critical' }),
      b: desc({ priority: 'high' }),
      c: desc(),
      e: desc(),
    };
    Object.entries(d).forEach(([id, x]) => m.register(id, x));
    tick({ surfaces: visible(Object.keys(d), 3000) });
    const live = Object.entries(d).filter(
      ([id, x]) => m.getAllocation(id, x).renderer !== 'acrylic'
    );
    expect(live.map(([id]) => id)).toEqual(['a', 'b']);
  });

  it('Reduce Transparency wins over everything', () => {
    const { m, tick } = setup('highEndIphone');
    m.register('a', desc({ requestedQuality: 'ultra' }));
    tick({ reduceTransparency: true, surfaces: visible(['a'], 3000) });
    expect(m.getAllocation('a', desc({ requestedQuality: 'ultra' }))).toMatchObject({
      renderer: 'acrylic',
      opaque: true,
    });
    expect(m.getQualityState().downgradeReason).toBe('accessibility');
  });

  it('keeps offscreen surfaces out of the budget', () => {
    const { m, tick } = setup('highEndIphone');
    m.setOptions({ maxLiveSurfaces: 1 });
    m.register('on', desc());
    m.register('off', desc());
    tick({ surfaces: visible(['on'], 3000) });
    expect(m.getAllocation('on', desc()).renderer).toBe('system');
    expect(m.getMetrics().visibleSurfaceCount).toBe(1);
  });
});

describe('stability while scrolling', () => {
  it('does not swap renderers mid-scroll as visible areas change', () => {
    const { m, tick } = setup('highEndIphone');
    m.setOptions({ maxLiveSurfaces: 3 });
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    ids.forEach((id) => m.register(id, desc()));
    const area = (big: string[]) =>
      ids.map((id) => ({
        id,
        area: big.includes(id) ? 60000 : 20000,
        renderer: 'system' as const,
      }));
    tick({ surfaces: area(['a', 'b', 'c']) });
    const before = ids.map((id) => m.getAllocation(id, desc()).renderer);
    // mid-fling the other half of the list becomes the larger on-screen part
    tick({ scrollState: 'fast', surfaces: area(['d', 'e', 'f']) });
    tick({ scrollState: 'slow', surfaces: area(['d', 'e', 'f']) });
    expect(ids.map((id) => m.getAllocation(id, desc()).renderer)).toEqual(before);
  });

  it('keeps list cards on one look, including cells mounting mid-scroll', () => {
    const { m, tick } = setup('midAndroid');
    const renderers = (ids: string[]) =>
      new Set(ids.map((id) => m.getAllocation(id, desc()).renderer));
    m.register('nav', desc({ priority: 'critical' }));
    const first = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
    first.forEach((id) => m.register(id, desc()));
    tick({ surfaces: [...visible(['nav'], 30000), ...visible(first, 50000)] });
    expect(renderers(first).size).toBe(1);
    // scrolling: two cards leave, two new ones mount and become visible
    tick({
      scrollState: 'fast',
      surfaces: [...visible(['nav'], 30000), ...visible(first.slice(2), 50000)],
    });
    ['c7', 'c8'].forEach((id) => m.register(id, desc()));
    const onScreen = [...first.slice(2), 'c7', 'c8'];
    tick({
      scrollState: 'fast',
      surfaces: [...visible(['nav'], 30000), ...visible(onScreen, 50000)],
    });
    expect(renderers(onScreen).size).toBe(1);
    tick({ surfaces: [...visible(['nav'], 30000), ...visible(onScreen, 50000)] });
    expect(renderers(onScreen).size).toBe(1);
  });

  it('gives a mounting surface the allocation it keeps after registering', () => {
    const { m, tick } = setup('highEndIphone');
    m.setOptions({ maxLiveSurfaces: 2 });
    ['a', 'b'].forEach((id) => m.register(id, desc()));
    tick({ surfaces: visible(['a', 'b'], 20000) });
    const provisional = m.getAllocation('new', desc());
    m.register('new', desc());
    expect(m.getAllocation('new', desc()).renderer).toBe(provisional.renderer);
    expect(provisional.renderer).toBe('acrylic');
  });
});

describe('surface registration', () => {
  it('subscribes to native stats only while needed', () => {
    const { m, isSubscribed } = setup('highEndIphone');
    expect(isSubscribed()).toBe(false);
    m.register('a', desc());
    expect(isSubscribed()).toBe(true);
    m.unregister('a');
    expect(isSubscribed()).toBe(false);
    const off = m.subscribeMetrics(() => {});
    expect(isSubscribed()).toBe(true);
    off();
    expect(isSubscribed()).toBe(false);
  });

  it('drops allocations on unregister and ignores duplicate registration', () => {
    const { m } = setup('highEndIphone');
    const listener = jest.fn();
    m.subscribeAllocations(listener);
    m.register('a', desc());
    const calls = listener.mock.calls.length;
    m.register('a', desc());
    expect(listener.mock.calls.length).toBe(calls);
    expect(m.surfaceCount).toBe(1);
    m.unregister('a');
    m.unregister('a');
    expect(m.surfaceCount).toBe(0);
  });

  it('keeps allocation identity stable when nothing changed', () => {
    const { m, tick } = setup('highEndIphone');
    m.register('a', desc());
    tick({ surfaces: visible(['a'], 3000) });
    const first = m.getAllocation('a', desc());
    tick({ surfaces: visible(['a'], 3100) });
    expect(m.getAllocation('a', desc())).toBe(first);
  });

  it('falls back to acrylic without the native module', () => {
    const m = new GlassQualityManager(null);
    m.register('a', desc());
    expect(m.getAllocation('a', desc()).renderer).toBe('acrylic');
    expect(m.getMetrics().nativeAvailable).toBe(false);
  });
});
