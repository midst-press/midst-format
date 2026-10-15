/**
 * @jest-environment node
 */
// tools/measure_typing_rates.mjs on INVENTED data only. The tool is an ES module and jest here runs CommonJS, so it is
// bundled with esbuild (as generate_long_midst.test.cjs does for the editor's utils.ts).
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');

const SOURCE = path.join(__dirname, '..', 'measure_typing_rates.mjs');
let tool;
let work;

beforeAll(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mtr-')));
  const bundle = path.join(work, 'tool.cjs');
  esbuild.buildSync({
    entryPoints: [SOURCE], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent',
  });
  tool = require(bundle);
});
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

const acc = () => ({
  edits: 0, insertedSum: 0, removedSum: 0, insertedOne: 0, noops: 0, insertOnly: 0, removeOnly: 0, replace: 0,
  nonPositiveGaps: 0, negativeGaps: 0, burstN: 0, burstMs: 0, burstAnyN: 0, burstAnyMs: 0, delRuns: 0, delRunsRetyped: 0,
  delRunLengths: [], insertedPerEdit: [], gaps: [],
});

test('diffFrames: prefix/suffix never overlap', () => {
  expect(tool.diffFrames('aa', 'aaa')).toEqual({ front: 2, end: 0, removed: 0, inserted: 1 });
  expect(tool.diffFrames('abcd', 'abXd')).toEqual({ front: 2, end: 1, removed: 1, inserted: 1 });
});

// Invented sequence: type "ab", backspace twice, retype "c" at the same place, a pause, then a 2000-char paste.
const texts = ['', 'a', 'ab', 'a', '', 'c', `c${'x'.repeat(2000)}`];
const stamps = [1000, 1100, 1200, 1300, 1400, 1500, 70000];

function expectCounts(edits, firstEditHasGap) {
  const all = acc();
  const typing = acc();
  expect(tool.analyseEdits(edits, all, typing)).toBe(1);
  expect(all.edits).toBe(6);
  expect(all.insertOnly).toBe(4);
  expect(all.removeOnly).toBe(2);
  expect(all.delRuns).toBe(1);
  expect(all.delRunLengths).toEqual([2]);
  expect(all.delRunsRetyped).toBe(1);
  expect(all.insertedOne).toBe(3);
  // single-char inserts with gap < 2 s: "a","b","c" each 100 ms (B) -- the paste gap is 68.5 s
  expect(all.burstN).toBe(firstEditHasGap ? 3 : 2);
  expect(all.burstMs).toBe(firstEditHasGap ? 300 : 200);
  expect(typing.edits).toBe(5);
  expect(typing.insertedSum).toBe(3);
  // B has a baseline frame, so every edit has a gap; C's first entry has none.
  const lead = firstEditHasGap ? [100] : [];
  expect(all.gaps).toEqual([...lead, 100, 100, 100, 100, 68500]);
  expect(typing.gaps).toEqual([...lead, 100, 100, 100, 100]);
}

test('format B: frames -> counts', () => {
  const frames = texts.map((content, i) => ({ content, lineNumber: '0', timestamp: stamps[i] }));
  const { edits, finalLen } = tool.editsFromFrames(frames);
  expect(finalLen).toBe(2001);
  expectCounts(edits, true);
});

test('format C: history entries -> same counts, lengths reconstructed', () => {
  const iso = (ms) => new Date(ms).toISOString();
  const history = [
    { front: 0, inserted: 'a', end: 0, t: iso(1100), pos: 1 },
    { front: 1, inserted: 'b', end: 0, t: iso(1200), pos: 2 },
    { front: 1, inserted: '', end: 0, t: iso(1300), pos: 1 },
    { front: 0, inserted: '', end: 0, t: iso(1400), pos: 0 },
    { front: 0, inserted: 'c', end: 0, t: iso(1500), pos: 1 },
    { front: 1, inserted: 'x'.repeat(2000), end: 0, t: iso(70000), pos: 2001 },
  ];
  const r = tool.editsFromHistory(history, `c${'x'.repeat(2000)}`);
  expect(r.lengthMismatch).toBe(false);
  expectCounts(r.edits, false);
});

test('measure(): failures counted by kind, no names', () => {
  const put = (name, content) => {
    const p = path.join(work, name);
    fs.writeFileSync(p, content);
    return { path: p, isZip: false };
  };
  const files = [
    put('x.midst', 'midstVersion: 9\n{}'),
    put('y.midst', 'midstVersion: 1\n{not json'),
    put('z.midst', '{"other":1}'),
    put('w.midst', JSON.stringify({ text: 'a', history: [{ front: 0, inserted: 'a', end: 0, t: 5 }] })),
  ];
  const r = tool.measure(files, 1);
  expect(r.poems.read).toBe(1);
  expect(r.poems.failed).toBe(2);
  expect(r.failuresByKind).toEqual({ c_unsupported_version: 1, c_json_parse_error: 1 });
  expect(r.skippedByKind).toEqual({ non_midst_extension: 1, unknown_format: 1 });
  expect(JSON.stringify(r).includes(work)).toBe(false);
});
