// The glide estimate (midst-editor #26): its arithmetic on a history built here, and that a run prints no poem
// data, only with --titles writing a title, to that file.
//
//   npm test
//
// Needs the `zip` command. It does not need the harness built from midst-editor: a stand-in converter is used.
const fs = require('fs'),
  path = require('path'),
  os = require('os');
const { execFileSync } = require('child_process');
const { estimate, paragraphAt, glideMs, main, BAND_SCREENS, VIEW_PX, STEP_MS } = require('./glide_estimate.cjs');

const paragraphs = (n) => Array.from({ length: n }, (_, i) => `<p>line ${i}</p>`).join('');
// A change that types `x` at `front` in `text`, as the converter writes one.
const typeAt = (text, front) => ({ front, inserted: 'x', end: text.length - front });

// Twenty paragraphs typed at once, then an edit in the first, then one in the last: one jump of 19 paragraphs.
function jumpHistory() {
  const start = paragraphs(20);
  const first = start.indexOf('line 0') + 'line 0'.length;
  const afterFirst = start.slice(0, first) + 'x' + start.slice(first);
  const last = afterFirst.indexOf('line 19') + 'line 19'.length;
  return [
    { front: 0, inserted: start, end: 0 },
    typeAt(start, first),
    typeAt(afterFirst, last),
  ];
}

test('a place is in the paragraph that has not closed before it', () => {
  const html = paragraphs(3);
  expect(paragraphAt(html, 0)).toBe(0);
  expect(paragraphAt(html, html.indexOf('line 1'))).toBe(1);
  expect(paragraphAt(html, html.length)).toBe(3);
});

test('a jump of 19 paragraphs at 14px is one glide, timed as follow.ts times it; a jump of none is not', () => {
  const r = estimate(jumpHistory(), 14);
  const screens = (19 * 14 * 1.5) / VIEW_PX; // 0.907
  expect(r.steps).toBe(3);
  expect(r.largest).toBeCloseTo(screens, 6);
  expect(r.glides).toBe(1);
  expect(r.pauseMs).toBeCloseTo(glideMs(screens * VIEW_PX, VIEW_PX), 6);
  expect(r.baseMs).toBe(3 * STEP_MS);
  expect(r.multiple).toBeCloseTo(r.pauseMs / r.baseMs, 9);
});

test('a jump inside the comfortable band does not glide, and the font size sets the distance', () => {
  // At 4px, 19 paragraphs is 19 * 6 / 440 = 0.26 of a screen: inside the band.
  const small = estimate(jumpHistory(), 4);
  expect(small.largest).toBeLessThan(BAND_SCREENS);
  expect(small.glides).toBe(0);
  expect(small.pauseMs).toBe(0);
  // No usable font size: the player's 14px.
  expect(estimate(jumpHistory(), undefined).largest).toBeCloseTo(estimate(jumpHistory(), 14).largest, 9);
});

test('a short glide still takes 250ms, as in follow.ts', () => {
  expect(glideMs(1, VIEW_PX)).toBe(250);
  expect(glideMs(10 * VIEW_PX, VIEW_PX)).toBe(4000);
});

test('a run prints no title and no archive path; --titles writes the title only to its file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'midst-glide-test-'));
  try {
    const poet = path.join(dir, 'corpus', 'MARKERPOET');
    fs.mkdirSync(poet, { recursive: true });
    const midst = path.join(dir, 'MARKERPOEM.midst');
    fs.writeFileSync(midst, '{}');
    execFileSync('zip', ['-q', '-j', path.join(poet, 'MARKERPOEM.midst.zip'), midst]);
    const convertMidstFile = () => JSON.stringify({ text: '', history: jumpHistory(), meta: { title: 'MARKERTITLE', fontSize: 14 } });
    const out = [];
    const titles = path.join(dir, 'titles.json');
    const rc = main([path.join(dir, 'corpus'), '--titles', titles], {
      convertMidstFile,
      log: (...a) => out.push(a.join(' ')),
      err: (...a) => out.push(a.join(' ')),
    });
    const printed = out.join('\n');
    expect(rc).toBe(0);
    expect(printed).toMatch(/^#1 /m);
    for (const marker of ['MARKERTITLE', 'MARKERPOET', 'MARKERPOEM', 'line 19']) expect(printed).not.toContain(marker);
    expect(JSON.parse(fs.readFileSync(titles, 'utf8'))).toEqual({ 1: 'MARKERTITLE' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
