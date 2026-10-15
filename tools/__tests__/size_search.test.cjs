/**
 * @jest-environment node
 */
// tools/size_search.mjs: the pass/fail judgement only. The search itself drives two apps and is run by hand, never here.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const esbuild = require('esbuild');

const SOURCE = path.join(__dirname, '..', 'size_search.mjs');
let tool;
let work;

beforeAll(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ssr-')));
  const bundle = path.join(work, 'tool.cjs');
  esbuild.buildSync({
    entryPoints: [SOURCE],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundle,
    logLevel: 'silent',
    define: { 'import.meta.url': JSON.stringify(pathToFileURL(SOURCE).href) },
  });
  tool = require(bundle);
});
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

const d = (p95) => ({ n: 6, p50: p95 / 2, p95, max: p95 });
// Every measure just inside its threshold.
const editor = () => ({
  steps: {
    openMs: 4999,
    keystrokeDomMs: { ...d(99), n: 100 },
    saveMs: 1999,
    replay: { setFps: 1000 / 60, achievedFps: 0.9 * (1000 / 60), sliderDomMs: d(249) },
  },
  failures: [],
});
const web = () => ({
  steps: { loadMs: 1, play: { setFps: 1000 / 60, achievedFps: 1000 / 60 }, scrubDomMs: d(249) },
  failures: [],
});

test('a level just inside every threshold passes', () => {
  const j = tool.judge(editor(), web());
  expect(j.checks).toEqual(Object.fromEntries(Object.keys(j.checks).map((k) => [k, true])));
  expect(j.pass).toBe(true);
});

test.each([
  ['editorOpen', (e) => { e.steps.openMs = 5000; }],
  ['editorKeystroke', (e) => { e.steps.keystrokeDomMs = { ...d(100), n: 100 }; }],
  ['editorSave', (e) => { e.steps.saveMs = 2000; }],
  ['replayPace', (e) => { e.steps.replay.achievedFps = 0.89 * (1000 / 60); }],
  ['replaySlider', (e) => { e.steps.replay.sliderDomMs = d(250); }],
])('editor at its threshold fails %s and only that', (check, mutate) => {
  const e = editor();
  mutate(e);
  const j = tool.judge(e, web());
  expect(Object.entries(j.checks).filter(([, ok]) => !ok).map(([k]) => k)).toEqual([check]);
  expect(j.pass).toBe(false);
});

test('a missing measure fails rather than passing by default', () => {
  const e = editor();
  delete e.steps.saveMs;
  const failed = tool.judge(e, web()).checks;
  expect(failed.editorSave).toBe(false);
  // An open that failed is recorded as an object, not a number: it must fail too.
  e.steps.openMs = { failedAfterMs: 120000, timeoutMs: 120000 };
  expect(tool.judge(e, web()).checks.editorOpen).toBe(false);
});

test('no web result, or a crash on either side, fails the no-crash checks', () => {
  expect(tool.judge(editor(), undefined).checks.webNoCrash).toBe(false);
  const w = web();
  w.failures = [{ step: 'crash', reason: 'page crashed' }];
  expect(tool.judge(editor(), w).checks.webNoCrash).toBe(false);
  const e = editor();
  e.failures = [{ step: 'harness', reason: 'launch failed' }];
  expect(tool.judge(e, web()).checks.editorNoCrash).toBe(false);
});

test('web load has no threshold: a slow load alone does not fail the level', () => {
  const w = web();
  w.steps.loadMs = 10 * 60 * 1000;
  expect(tool.judge(editor(), w).pass).toBe(true);
});

test('a step that failed part-way fails the level even when its surviving samples are fast', () => {
  const e = editor();
  e.steps.keystrokeDomMs = { ...d(5), n: 40 };
  e.failures = [{ step: 'keystrokes', reason: 'waitForFunction timeout' }];
  const j = tool.judge(e, web());
  expect(j.checks.editorKeystroke).toBe(false);
  expect(j.checks.editorNoFailures).toBe(false);
  expect(j.checks.editorNoCrash).toBe(true);
  expect(j.pass).toBe(false);
});

test.each([
  ['editor keystrokes', (e) => { e.steps.keystrokeDomMs = { ...d(5), n: 99 }; }, 'editorKeystroke'],
  ['Replay slider', (e) => { e.steps.replay.sliderDomMs = { ...d(5), n: 5 }; }, 'replaySlider'],
])('too few %s samples fail, with no failure recorded', (_name, mutate, check) => {
  const e = editor();
  mutate(e);
  expect(tool.judge(e, web()).checks[check]).toBe(false);
});

test('too few web scrub samples fail', () => {
  const w = web();
  w.steps.scrubDomMs = { ...d(5), n: 3 };
  expect(tool.judge(editor(), w).checks.webScrub).toBe(false);
});

test('any recorded web failure fails the level', () => {
  const w = web();
  w.failures = [{ step: 'scrub', reason: 'scrub to 0.9 did not update the text' }];
  expect(tool.judge(editor(), w).pass).toBe(false);
});

test('a level with a driver error fails even when the judged numbers pass', () => {
  const j = tool.judge(editor(), web());
  expect(tool.levelPasses(j, [])).toBe(true);
  expect(tool.levelPasses(j, [{ step: 'web spec', text: 'exit 1 with no recorded failure', log: 'x' }])).toBe(false);
});
