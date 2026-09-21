import { QualityController, type FrameWindow } from '../QualityController';
import { POLICY, levelOf } from '../policy';

const calm: FrameWindow = {
  averageFrameTimeMs: 8.4,
  targetFrameTimeMs: 8.33,
  droppedFrameRatio: 0,
  sampleCount: 60,
  windowMs: 500,
};
const bad: FrameWindow = { ...calm, averageFrameTimeMs: 14, droppedFrameRatio: 0.3 };
const ULTRA = levelOf('ultra');

function run(c: QualityController, w: FrameWindow, count: number, start: number, ceiling = ULTRA) {
  let t = start;
  for (let i = 0; i < count; i++) {
    t += w.windowMs;
    c.update(w, ceiling, t);
  }
  return t;
}

describe('QualityController hysteresis', () => {
  it('ignores a single bad window', () => {
    const c = new QualityController(ULTRA);
    c.update(bad, ULTRA, 500);
    expect(c.level).toBe(ULTRA);
  });

  it('downgrades after sustained stress', () => {
    const c = new QualityController(ULTRA);
    run(c, bad, 2, 0);
    expect(c.level).toBe(ULTRA - 1);
  });

  it('upgrades only after a much longer calm period', () => {
    const c = new QualityController(ULTRA);
    let t = run(c, bad, 2, 0);
    t = run(c, calm, POLICY.frames.upgradeAfterMs / 500 - 1, t);
    expect(c.level).toBe(ULTRA - 1);
    run(c, calm, 1, t);
    expect(c.level).toBe(ULTRA);
  });

  it('does not flip-flop on alternating windows', () => {
    const c = new QualityController(ULTRA);
    let t = 0;
    for (let i = 0; i < 20; i++) {
      t = run(c, i % 2 ? calm : bad, 1, t);
    }
    expect(c.level).toBe(ULTRA);
  });

  it('backs off after an upgrade that immediately fails', () => {
    const c = new QualityController(ULTRA);
    let t = run(c, bad, 2, 0);
    t = run(c, calm, 8, t);
    expect(c.level).toBe(ULTRA);
    t = run(c, bad, 2, t);
    expect(c.level).toBe(ULTRA - 1);
    expect(c.upgradeHold).toBe(POLICY.frames.upgradeAfterMs * 2);
    run(c, calm, 8, t);
    expect(c.level).toBe(ULTRA - 1);
  });

  it('never goes below the frame floor', () => {
    const c = new QualityController(ULTRA);
    run(c, bad, 40, 0);
    expect(c.level).toBe(levelOf(POLICY.frames.floor));
  });

  it('follows a lower ceiling immediately but climbs back slowly', () => {
    const c = new QualityController(ULTRA);
    c.update(calm, levelOf('medium'), 500);
    expect(c.level).toBe(levelOf('medium'));
    c.update(calm, ULTRA, 1000);
    expect(c.level).toBe(levelOf('medium'));
  });

  it('treats idle windows as calm', () => {
    const c = new QualityController(ULTRA);
    const t = run(c, bad, 2, 0);
    run(c, { ...calm, sampleCount: 0 }, 8, t);
    expect(c.level).toBe(ULTRA);
  });
});
