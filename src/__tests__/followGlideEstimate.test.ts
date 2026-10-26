import { glideMs, MARGIN } from '../follow';

// conformance/glide_estimate.cjs (midst-editor #26) keeps its own copy of the glide's timing and of the band, since
// a Node script there cannot import this TypeScript. These hold the copies to the code the player runs.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const estimate = require('../../conformance/glide_estimate.cjs');

describe('the glide estimate times glides as follow.ts does', () => {
  it.each([0, 1, 50, 220, 440, 4400, 44000])('%ipx on a 440px view', (distance) => {
    expect(estimate.glideMs(distance, 440)).toBe(glideMs(distance, 440));
  });

  it('counts a glide where the comfortable band ends', () => {
    expect(estimate.BAND_SCREENS).toBeCloseTo(0.5 - MARGIN, 12);
  });
});
