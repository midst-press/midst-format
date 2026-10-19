import {
  ease,
  glideMs,
  glideTo,
  gliding,
  MAX_FRAME_MS,
  MIN_GLIDE_VIEWPORT,
  PEAK_VIEWPORTS_PER_S,
} from '../follow';

const FRAME_MS = 1000 / 60;

/** The largest scroll change between consecutive 60Hz frames of one glide. */
function largestFrameStep(distance: number, viewport: number): number {
  const ms = glideMs(distance, viewport);
  let worst = 0;
  let prev = 0;
  for (let now = FRAME_MS; now < ms + FRAME_MS; now += FRAME_MS) {
    const at = distance * ease(Math.min(1, now / ms));
    worst = Math.max(worst, at - prev);
    prev = at;
  }
  return worst;
}

describe('glideMs', () => {
  // The website's player (a 439px view) shares this helper with the editor (568px), so the bound is
  // stated per viewport, not in pixels.
  const viewports = [300, 440, 568, 900];

  it.each(viewports)(
    'never moves more than 1/12 of a %ipx view in one 60Hz frame',
    (viewport) => {
      [10, 100, viewport, 5 * viewport, 50 * viewport].forEach((distance) => {
        expect(largestFrameStep(distance, viewport)).toBeLessThanOrEqual(
          viewport / (60 / PEAK_VIEWPORTS_PER_S) + 1e-9
        );
      });
    }
  );

  it('takes longer for the same distance in a shorter view', () => {
    expect(glideMs(2000, 440)).toBeGreaterThan(glideMs(2000, 568));
  });

  it('never glides for less than 250ms', () => {
    expect(glideMs(1, 568)).toBe(250);
  });
});

describe('glideTo', () => {
  // Playback waits while gliding() is true, so a glide that never ends stalls the timelapse.
  it.each([0, MIN_GLIDE_VIEWPORT - 1])(
    'moves a %ipx-tall scroller at once rather than gliding',
    (clientHeight) => {
      const el = { clientHeight, scrollTop: 0 } as HTMLElement;
      const glide = glideTo(el, 1000, null);
      expect(gliding(glide)).toBe(false);
      expect(el.scrollTop).toBe(1000);
    }
  );
});

describe('glideTo under stalls', () => {
  // Drive requestAnimationFrame by hand so frame times can include long stalls.
  let queued: FrameRequestCallback | null = null;
  beforeEach(() => {
    jest.spyOn(performance, 'now').mockReturnValue(0);
    (global as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      queued = cb;
      return 1;
    };
    (global as any).cancelAnimationFrame = () => {};
  });
  afterEach(() => jest.restoreAllMocks());

  // Runs one glide to completion with frames every `interval` ms, after an optional first gap.
  const run = (interval: number, first = interval) => {
    const el = { clientHeight: 440, scrollTop: 0 } as HTMLElement;
    const glide = glideTo(el, 10 * 440, null);
    let now = 0;
    let prev = 0;
    let worst = 0;
    let frames = 0;
    for (; frames < 5000 && gliding(glide); frames += 1) {
      now += frames === 0 ? first : interval;
      queued!(now);
      worst = Math.max(worst, Math.abs(el.scrollTop - prev));
      prev = el.scrollTop;
    }
    return { el, glide, worst, frames };
  };

  it.each([1000 / 60, 2000 / 60, 150, 1000])(
    'frames every %fms: reaches the target, never more than a sixth of the view per frame',
    (interval) => {
      const { el, glide, worst } = run(interval);
      expect(gliding(glide)).toBe(false);
      expect(el.scrollTop).toBe(10 * 440);
      expect(worst).toBeLessThanOrEqual(440 / 6 + 1e-9);
    }
  );

  it('a clock that goes backwards does not move the view backwards', () => {
    const el = { clientHeight: 440, scrollTop: 0 } as HTMLElement;
    glideTo(el, 4400, null);
    queued!(100);
    const at = el.scrollTop;
    queued!(50);
    expect(el.scrollTop).toBe(at);
  });

  it('the same target keeps the running glide; a new target cancels it', () => {
    const cancel = jest.fn();
    (global as any).cancelAnimationFrame = cancel;
    const el = { clientHeight: 440, scrollTop: 0 } as HTMLElement;
    const first = glideTo(el, 2000, null);
    expect(glideTo(el, 2001, first)).toBe(first);
    expect(cancel).not.toHaveBeenCalled();
    const second = glideTo(el, 3000, first);
    expect(second).not.toBe(first);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('never moves more than a sixth of the view in one frame, even after a 200ms stall', () => {
    const el = { clientHeight: 440, scrollTop: 0 } as HTMLElement;
    const glide = glideTo(el, 10 * 440, null);
    let now = 0;
    let prev = el.scrollTop;
    let worst = 0;
    for (let i = 0; i < 2000 && gliding(glide); i += 1) {
      now += i % 5 === 2 ? 200 : 1000 / 60; // a 200ms stall every fifth frame
      queued!(now);
      worst = Math.max(worst, Math.abs(el.scrollTop - prev));
      prev = el.scrollTop;
    }
    expect(gliding(glide)).toBe(false);
    expect(el.scrollTop).toBe(10 * 440);
    expect(worst).toBeLessThanOrEqual(440 / 6 + 1e-9);
    expect(MAX_FRAME_MS).toBeCloseTo(33.33, 1);
  });
});
