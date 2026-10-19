/** @jest-environment jsdom */
import {
  ease,
  glideMs,
  glideTo,
  gliding,
  Glide,
  MARGIN,
  MAX_FRAME_MS,
  MIN_GLIDE_VIEWPORT,
  scrollParent,
  targetScrollTop,
} from '../follow';

/** A div whose layout metrics are set by hand (jsdom does no layout). */
function box(
  scrollHeight: number,
  clientHeight: number,
  overflowY: string,
  parent?: HTMLElement
): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight });
  el.style.overflowY = overflowY;
  if (parent) parent.appendChild(el);
  return el;
}

describe('scrollParent', () => {
  it('returns null for a missing element', () => {
    expect(scrollParent(null)).toBeNull();
  });

  it('returns the element itself when it scrolls', () => {
    const el = box(1000, 400, 'auto');
    expect(scrollParent(el)).toBe(el);
  });

  it('walks up to an ancestor that scrolls', () => {
    const outer = box(1000, 400, 'scroll');
    const mid = box(100, 100, 'visible', outer);
    const inner = box(50, 50, 'visible', mid);
    expect(scrollParent(inner)).toBe(outer);
  });

  it('returns the nearest scroller when several qualify', () => {
    const outer = box(1000, 400, 'auto');
    const inner = box(900, 300, 'auto', outer);
    expect(scrollParent(inner)).toBe(inner);
  });

  it('skips an element with overflow but overflow-y hidden or visible', () => {
    const outer = box(1000, 400, 'auto');
    const hidden = box(900, 300, 'hidden', outer);
    const visible = box(900, 300, 'visible', hidden);
    expect(scrollParent(visible)).toBe(outer);
  });

  it('skips a scrollable-styled element whose content fits', () => {
    const outer = box(1000, 400, 'auto');
    const fits = box(300, 300, 'auto', outer);
    expect(scrollParent(fits)).toBe(outer);
  });

  it('treats a 1px overflow as not scrolling, and 2px as scrolling', () => {
    expect(scrollParent(box(401, 400, 'auto'))).toBeNull();
    const el = box(402, 400, 'auto');
    expect(scrollParent(el)).toBe(el);
  });

  it('returns null when nothing in the chain scrolls', () => {
    const outer = box(100, 100, 'auto');
    const inner = box(80, 80, 'hidden', outer);
    expect(scrollParent(inner)).toBeNull();
  });
});

describe('targetScrollTop', () => {
  // A 1000px view whose top edge sits at y=100: the comfortable band is y 250..950.
  const view = { top: 100, height: 1000 };
  const lo = view.top + view.height * MARGIN;
  const hi = view.top + view.height * (1 - MARGIN);

  it('needs no scroll for a point well inside the band', () => {
    expect(
      targetScrollTop({ top: 500, bottom: 540 }, view, 300, 5000)
    ).toBeNull();
  });

  it('needs no scroll when the point sits exactly on the band edges', () => {
    expect(
      targetScrollTop({ top: lo, bottom: hi }, view, 300, 5000)
    ).toBeNull();
  });

  it('scrolls when the point is one pixel past the top or bottom edge', () => {
    expect(
      targetScrollTop({ top: lo - 1, bottom: lo + 20 }, view, 300, 5000)
    ).not.toBeNull();
    expect(
      targetScrollTop({ top: hi - 20, bottom: hi + 1 }, view, 300, 5000)
    ).not.toBeNull();
  });

  it('scrolls for a point taller than the band even if centred', () => {
    expect(
      targetScrollTop({ top: 200, bottom: 1000 }, view, 300, 5000)
    ).not.toBeNull();
  });

  it('centres a point that is below the view', () => {
    const point = { top: 1400, bottom: 1440 };
    const next = targetScrollTop(point, view, 500, 5000) as number;
    // After scrolling by (next - 500) the point's middle must sit at the view's middle.
    const middleAfter = (point.top + point.bottom) / 2 - (next - 500);
    expect(middleAfter).toBe(view.top + view.height / 2);
  });

  it('centres a point that is above the view', () => {
    const point = { top: -200, bottom: -160 };
    const next = targetScrollTop(point, view, 3000, 9000) as number;
    const middleAfter = (point.top + point.bottom) / 2 - (next - 3000);
    expect(middleAfter).toBe(view.top + view.height / 2);
  });

  it('never returns a negative scrollTop', () => {
    expect(
      targetScrollTop({ top: -9000, bottom: -8960 }, view, 100, 5000)
    ).toBe(0);
  });

  it('never scrolls past the end of the content', () => {
    expect(
      targetScrollTop({ top: 90000, bottom: 90040 }, view, 100, 5000)
    ).toBe(5000 - view.height);
  });

  it('returns 0 when the content is shorter than the view', () => {
    expect(targetScrollTop({ top: 5000, bottom: 5040 }, view, 0, 600)).toBe(0);
  });

  it('returns a whole number of pixels', () => {
    const next = targetScrollTop(
      { top: 1400.3, bottom: 1440.6 },
      view,
      500,
      5000
    );
    expect(Number.isInteger(next)).toBe(true);
  });
});

describe('ease', () => {
  it('runs from 0 to 1, through the midpoint', () => {
    expect(ease(0)).toBe(0);
    expect(ease(0.5)).toBe(0.5);
    expect(ease(1)).toBe(1);
  });

  it('never decreases', () => {
    let prev = ease(0);
    for (let t = 0.01; t <= 1.0001; t += 0.01) {
      const v = ease(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('is symmetric: slow start mirrors slow finish', () => {
    [0.1, 0.25, 0.4].forEach((t) => {
      expect(ease(t) + ease(1 - t)).toBeCloseTo(1, 12);
      expect(ease(t)).toBeLessThan(t);
    });
  });
});

describe('gliding', () => {
  const el = { scrollTop: 0 } as unknown as HTMLElement;
  const glide = (done: boolean): Glide => ({ to: 0, frame: 0, done, el });

  it('is false for no glide', () => {
    expect(gliding(null)).toBe(false);
  });

  it('is true for a glide in flight and false once done', () => {
    expect(gliding(glide(false))).toBe(true);
    expect(gliding(glide(true))).toBe(false);
  });

  it('finishes a hidden glide: scrolls to target, stops the frame', () => {
    const spy = jest.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const raf = jest
      .spyOn(globalThis, 'cancelAnimationFrame')
      .mockImplementation(() => {});
    const g = glide(false);
    g.to = 42;
    expect(gliding(g)).toBe(false);
    expect(g.done).toBe(true);
    expect(g.el.scrollTop).toBe(42);
    expect(raf).toHaveBeenCalledWith(0);
    spy.mockRestore();
    raf.mockRestore();
  });

  it('a visible glide after a stall still counts as gliding', () => {
    const spy = jest.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    expect(gliding(glide(false))).toBe(true);
    spy.mockRestore();
  });
});

describe('glideMs edges', () => {
  it('floors zero and negative distances at 250ms', () => {
    expect(glideMs(0, 568)).toBe(250);
    expect(glideMs(-1000, 568)).toBe(250);
  });

  it('treats a zero or negative viewport as 1px instead of dividing by zero', () => {
    expect(Number.isFinite(glideMs(100, 0))).toBe(true);
    expect(glideMs(100, 0)).toBe(glideMs(100, 1));
    expect(glideMs(100, -50)).toBe(glideMs(100, 1));
  });

  it('grows in proportion to the number of views for very large jumps (no cap)', () => {
    expect(glideMs(50 * 568, 568)).toBeCloseTo(20000, 6);
    expect(glideMs(20 * 568, 568)).toBeCloseTo(8000, 6);
    expect(glideMs(5 * 568, 568)).toBeCloseTo(2000, 6);
  });

  it('is the same for the same number of views at different viewport sizes', () => {
    expect(glideMs(3 * 300, 300)).toBeCloseTo(glideMs(3 * 900, 900), 9);
  });
});

describe('glideTo edges', () => {
  let queued: FrameRequestCallback | null = null;
  let nextId = 0;
  let requests = 0;
  let cancel: jest.Mock;

  beforeEach(() => {
    queued = null;
    nextId = 100;
    requests = 0;
    cancel = jest.fn();
    jest.spyOn(performance, 'now').mockReturnValue(0);
    (global as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      queued = cb;
      requests += 1;
      nextId += 1;
      return nextId;
    };
    (global as any).cancelAnimationFrame = cancel;
  });
  afterEach(() => jest.restoreAllMocks());

  const scroller = (scrollTop: number, clientHeight = 440) =>
    ({ clientHeight, scrollTop } as HTMLElement);

  it('does nothing when already within 2px of the target', () => {
    const el = scroller(1000);
    expect(glideTo(el, 1001.9, null)).toBeNull();
    expect(el.scrollTop).toBe(1000);
    expect(requests).toBe(0);
  });

  it('does nothing when exactly on the target', () => {
    const el = scroller(1000);
    expect(glideTo(el, 1000, null)).toBeNull();
    expect(requests).toBe(0);
  });

  it('starts a glide at exactly 2px away', () => {
    const el = scroller(1000);
    const g = glideTo(el, 1002, null);
    expect(gliding(g)).toBe(true);
    expect(requests).toBe(1);
  });

  it('keeps the running glide for a target within 2px of its own, not at 2px', () => {
    const el = scroller(0);
    const first = glideTo(el, 2000, null);
    expect(glideTo(el, 2001.9, first)).toBe(first);
    expect(cancel).not.toHaveBeenCalled();
    const second = glideTo(el, 2002, first);
    expect(second).not.toBe(first);
    expect(cancel).toHaveBeenCalledWith(first!.frame);
  });

  it('cancels a glide in flight and stops when the new target is already reached', () => {
    const el = scroller(0);
    const first = glideTo(el, 2000, null);
    queued!(16);
    const at = el.scrollTop;
    const before = requests;
    // New target within 2px of where the view is now.
    expect(glideTo(el, at + 1, first)).toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(requests).toBe(before);
  });

  it('cancels an in-flight glide when a small view takes the jump at once', () => {
    const el = scroller(0);
    const first = glideTo(el, 2000, null);
    (el as any).clientHeight = MIN_GLIDE_VIEWPORT - 1;
    expect(glideTo(el, 5000, first)).toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(el.scrollTop).toBe(5000);
  });

  it('glides, and does not jump, in a view exactly at the minimum height', () => {
    const el = scroller(0);
    (el as any).clientHeight = MIN_GLIDE_VIEWPORT;
    expect(glideTo(el, 5000, null)).not.toBeNull();
    expect(el.scrollTop).toBe(0);
  });

  it('starts afresh, cancelling nothing, when the previous glide is done', () => {
    const el = scroller(0);
    const first = glideTo(el, 1000, null)!;
    for (let i = 0; i < 2000 && gliding(first); i += 1) queued!((i + 1) * 16);
    expect(first.done).toBe(true);
    const again = glideTo(el, 1000, first);
    expect(again).toBeNull(); // already there
    const next = glideTo(el, 3000, first);
    expect(next).not.toBe(first);
    expect(gliding(next)).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('records the frame id of the pending animation frame', () => {
    const el = scroller(0);
    const g = glideTo(el, 2000, null)!;
    expect(g.frame).toBe(101);
    queued!(16);
    expect(g.frame).toBe(102);
  });

  it('does not move on a first frame with no elapsed time', () => {
    const el = scroller(300);
    const g = glideTo(el, 2000, null);
    queued!(0);
    expect(el.scrollTop).toBe(300);
    expect(gliding(g)).toBe(true);
  });

  it('a single huge stall advances the glide by only MAX_FRAME_MS of its time', () => {
    const el = scroller(0);
    const distance = 10 * 440;
    const g = glideTo(el, distance, null);
    queued!(60000);
    const ms = glideMs(distance, 440);
    expect(el.scrollTop).toBeCloseTo(distance * ease(MAX_FRAME_MS / ms), 6);
    expect(gliding(g)).toBe(true);
  });

  it('glides upward and lands exactly on the target without overshoot', () => {
    const el = scroller(6000);
    const g = glideTo(el, 1000, null);
    let prev = el.scrollTop;
    for (let i = 0; i < 5000 && gliding(g); i += 1) {
      queued!((i + 1) * 16);
      expect(el.scrollTop).toBeLessThanOrEqual(prev);
      expect(el.scrollTop).toBeGreaterThanOrEqual(1000);
      prev = el.scrollTop;
    }
    expect(gliding(g)).toBe(false);
    expect(el.scrollTop).toBe(1000);
  });

  it('stops requesting frames once the glide completes', () => {
    const el = scroller(0);
    const g = glideTo(el, 500, null)!;
    let before = requests;
    for (let i = 0; i < 5000 && gliding(g); i += 1) {
      before = requests;
      queued!((i + 1) * 16);
    }
    expect(g.done).toBe(true);
    expect(requests).toBe(before); // the finishing frame asked for no further frame
  });
});
