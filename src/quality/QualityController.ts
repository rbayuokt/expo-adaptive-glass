import { POLICY, levelOf } from './policy';

export interface FrameWindow {
  averageFrameTimeMs: number;
  targetFrameTimeMs: number;
  droppedFrameRatio: number;
  sampleCount: number;
  windowMs: number;
}

/** Frame-driven tier limit. Quick to downgrade, slow to upgrade, slower after a failed upgrade. */
export class QualityController {
  private readonly cfg = POLICY.frames;
  level: number;
  private stressMs = 0;
  private comfortMs = 0;
  private upgradeHoldMs: number = POLICY.frames.upgradeAfterMs;
  private lastUpgradeAt = -Infinity;
  private lastDowngradeAt = -Infinity;

  constructor(startLevel: number) {
    this.level = startLevel;
  }

  get upgradeHold() {
    return this.upgradeHoldMs;
  }

  update(frames: FrameWindow | null, ceiling: number, now: number): number {
    const floor = levelOf(this.cfg.floor);

    if (this.level > ceiling) {
      this.level = ceiling;
    }

    const w = frames?.windowMs ?? 0;
    const measured = !!frames && frames.sampleCount >= this.cfg.minSamples;
    const ratio = measured ? frames!.averageFrameTimeMs / frames!.targetFrameTimeMs : 1;
    const stressed =
      measured &&
      (ratio > this.cfg.stressRatio || frames!.droppedFrameRatio > this.cfg.stressDropped);
    // no frames means nothing is animating
    const calm =
      !measured ||
      (ratio < this.cfg.comfortRatio && frames!.droppedFrameRatio < this.cfg.comfortDropped);

    if (stressed) {
      this.comfortMs = 0;
      this.stressMs += w;
      if (this.stressMs >= this.cfg.downgradeAfterMs && this.level > floor) {
        this.level--;
        this.stressMs = 0;
        if (now - this.lastUpgradeAt < this.cfg.failedUpgradeWindowMs) {
          this.upgradeHoldMs = Math.min(this.upgradeHoldMs * 2, this.cfg.maxUpgradeAfterMs);
        }
        this.lastDowngradeAt = now;
      }
    } else if (calm) {
      this.stressMs = 0;
      this.comfortMs += w;
      if (this.comfortMs >= this.upgradeHoldMs && this.level < ceiling) {
        this.level++;
        this.comfortMs = 0;
        this.lastUpgradeAt = now;
      }
    } else {
      // neither: keep both clocks from running away
      this.comfortMs = 0;
      this.stressMs = Math.max(0, this.stressMs - w);
    }

    if (
      this.upgradeHoldMs > this.cfg.upgradeAfterMs &&
      now - this.lastDowngradeAt > this.cfg.resetBackoffAfterMs &&
      now - this.lastUpgradeAt > this.cfg.resetBackoffAfterMs
    ) {
      this.upgradeHoldMs = this.cfg.upgradeAfterMs;
    }

    return this.level;
  }
}
