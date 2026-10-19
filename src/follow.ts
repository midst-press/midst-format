// Replay follows the writing (midst-press/midst-web#32, midst-editor #20).
//
// Annelyse: "when the author jumps to a place that was off screen, the content should scroll gently to
// that new point rather than jump", so the reader keeps their place.
//
// The old code scrolled `domAtPos(pos).node` into view. For a caret inside text that node is a Text node,
// which has no scrollIntoView, so nothing moved; at a boundary the scroll was instant. And `pos` itself is
// unreliable in converted poems. So:
//   WHERE   the first position where the document changed, from the documents themselves (findDiffStart),
//           not the recorded pos.
//   WHEN    only when that point is outside the comfortable middle of the view; writing already on screen
//           does not move the page.
//   HOW     a glide whose duration grows with distance, centring the point. A new target replaces the
//           glide in flight; the same target does not restart it.
//   WAIT    playback does not advance while a glide is in flight (midst-press/midst-editor#22), so the
//           reader arrives before the writing moves on.

/** The nearest ancestor that actually scrolls vertically, or null. */
export function scrollParent(el: HTMLElement | null): HTMLElement | null {
  let s = el;
  while (s) {
    if (
      s.scrollHeight > s.clientHeight + 1 &&
      /(auto|scroll)/.test(getComputedStyle(s).overflowY)
    )
      return s;
    s = s.parentElement;
  }
  return null;
}

/** Fraction of the view kept clear at the top and bottom: a point inside the band needs no scroll. */
export const MARGIN = 0.15;

/**
 * The scrollTop that centres a point, or null when the point is already comfortably in view.
 * `top`/`bottom` are the point's viewport coordinates; `box` is the scroller's client rect.
 */
export function targetScrollTop(
  point: { top: number; bottom: number },
  box: { top: number; height: number },
  scrollTop: number,
  scrollHeight: number
): number | null {
  const lo = box.top + box.height * MARGIN;
  const hi = box.top + box.height * (1 - MARGIN);
  if (point.top >= lo && point.bottom <= hi) return null;
  const centre =
    scrollTop + (point.top + point.bottom) / 2 - box.top - box.height / 2;
  return Math.max(0, Math.min(scrollHeight - box.height, Math.round(centre)));
}

/**
 * Peak glide speed, in viewports per second. Speed is set relative to the viewport, not in pixels,
 * so a short window (the website's player) is not scrolled harder than a tall one (the editor):
 * at 5 viewports/s a single 60Hz frame moves at most 1/12 of the view, and two frames landing in
 * one sample at most 1/6. On the editor's ~900px view this is about the earlier fixed 5 px/ms peak.
 */
export const PEAK_VIEWPORTS_PER_S = 5;

/**
 * Glide duration for `distance` px in a view `viewport` px tall. The ease below peaks at twice its
 * average speed, so the duration that keeps the peak at PEAK_VIEWPORTS_PER_S is
 * 2 * distance / (PEAK * viewport) seconds. Never shorter than 250ms, so a small move still reads
 * as a glide.
 *
 * No upper cap, and that is a trade: a gentle bound and a fixed cap cannot both hold for every
 * distance, and playback waits for the glide. So a long jump pauses the timelapse in proportion to
 * its length: at 5 viewports/s, 0.4s per view (5 views 2s, 20 views 8s, 50 views 20s). Measured
 * jumps in Annelyse's Autoscroll Test Poem stay under 2 views. Whether a very long jump should
 * instead jump most of the way and glide the rest is an open question for the editor
 * (clement-7074f29f, midst-editor#24).
 */
export function glideMs(distance: number, viewport: number): number {
  const ms =
    (2 * distance * 1000) / (PEAK_VIEWPORTS_PER_S * Math.max(1, viewport));
  return Math.max(250, ms);
}

export const ease = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

export interface Glide {
  to: number;
  frame: number;
  done: boolean;
  el: HTMLElement;
}

/** True while a glide is still moving. If the page is hidden (Chromium does not run animation
 * frames for a hidden page), the glide is finished immediately: scroll to target and stop. */
export function gliding(g: Glide | null): boolean {
  if (!g || g.done) return false;
  if (document.hidden) {
    cancelAnimationFrame(g.frame);
    g.el.scrollTop = g.to;
    g.done = true;
    return false;
  }
  return true;
}

/**
 * Views shorter than this are not glided: a collapsed or hidden scroller reports a height near 0,
 * which would make glideMs enormous, and playback waits for every glide (clement-7074f29f, #24).
 */
export const MIN_GLIDE_VIEWPORT = 50;

/**
 * The most glide time one frame may advance: two 60Hz frames. At PEAK_VIEWPORTS_PER_S that is at
 * most 1/6 of the view per frame, however long the frame actually took (midst-web#11's runner
 * showed 150-226ms stalls, which moved a wall-clock glide a whole stall's worth in one frame).
 */
export const MAX_FRAME_MS = 2 * (1000 / 60);

/** Glide `el` to `to`. Returns the glide, so the caller can tell whether it is already heading there. */
export function glideTo(
  el: HTMLElement,
  to: number,
  current: Glide | null
): Glide | null {
  if (current && !current.done && Math.abs(current.to - to) < 2) return current;
  if (current && !current.done) cancelAnimationFrame(current.frame);
  const from = el.scrollTop;
  const distance = Math.abs(to - from);
  if (distance < 2) return null;
  if (el.clientHeight < MIN_GLIDE_VIEWPORT) {
    el.scrollTop = to;
    return null;
  }
  const ms = glideMs(distance, el.clientHeight);
  let last = performance.now();
  let progress = 0;
  const glide: Glide = { to, frame: 0, done: false, el };
  const tick = (now: number) => {
    // Advance by at most MAX_FRAME_MS per frame: after a stall (a slow phone, a busy machine) the
    // glide resumes where it was rather than jumping ahead by the time it lost.
    progress += Math.max(0, Math.min(now - last, MAX_FRAME_MS));
    last = now;
    const t = Math.min(1, progress / ms);
    el.scrollTop = from + (to - from) * ease(t);
    if (t < 1) glide.frame = requestAnimationFrame(tick);
    else glide.done = true;
  };
  glide.frame = requestAnimationFrame(tick);
  return glide;
}
