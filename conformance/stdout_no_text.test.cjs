// markloss, trajectory and one put no poem data on stdout or stderr (midst-format #7, #41): no archive name, no
// entry name, no exception message, no frame text. Built from the no_text fixtures and their marker words, so
// a marker found in any output is a leak. Needs `npm ci`, the harness built from midst-editor (trajectory and
// one convert), and the `zip` and `unzip` commands.
const fs = require('fs'),
  path = require('path'),
  os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const { MARK, FRAMES, B, CASES, zipName } = require('./no_text_cases.cjs');
const { report } = require('./trajectory.cjs');

let dir;
const zipOf = (name, entries) => {
  const zip = path.join(dir, zipName(name));
  const src = fs.mkdtempSync(path.join(dir, 'src-'));
  for (const [entry, content] of Object.entries(entries)) fs.writeFileSync(path.join(src, entry), content);
  execFileSync('zip', ['-q', '-j', zip, ...Object.keys(entries).map((e) => path.join(src, e))]);
  fs.rmSync(src, { recursive: true });
  return zip;
};
const run = (file, args, env = {}) =>
  spawnSync(process.execPath, [path.join(__dirname, file), ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60000 });
const leaks = (text) => Object.values(MARK).filter((m) => text.toLowerCase().includes(m.toLowerCase()));

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'midst-stdout-'));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

test('markloss names a lossy or failing poem by its index and prints no archive name, entry name or message', () => {
  const corpus = path.join(dir, 'corpus');
  fs.mkdirSync(corpus);
  // Sorted by archive name: loss (#1), not-json (#2), two-entries (#3).
  const loss = zipOf('a-loss', { 'inner.midst': B(['<p>a</p>', `<p>a <s>${MARK.frame}</s></p>`]) });
  const notJson = zipOf('b-not-json', CASES['not-json'].entries);
  const two = zipOf('c-two-entries', CASES['two-entries'].entries);
  for (const z of [loss, notJson, two]) fs.renameSync(z, path.join(corpus, path.basename(z)));

  const r = run('markloss.cjs', [], { MIDST_CORPUS: corpus });
  const out = r.stdout + r.stderr;
  // Controls: the run reached every poem, and each marker was somewhere it could have escaped from.
  expect(r.stdout).toMatch(/^LOSS #01 {2}dropped tags: s\(x1\)$/m);
  expect(r.stdout).toMatch(/^ERR {2}#02 {2}stage:parse class:SyntaxError$/m);
  expect(r.stdout).toMatch(/^ERR {2}#03 {2}stage:list class:ConformanceError code:ENTRY_COUNT count:2$/m);
  expect(fs.readdirSync(corpus).join(' ')).toContain(MARK.object);
  expect(leaks(out)).toEqual([]);
});

test('one prints how many entries it extracted, never their names', () => {
  const two = zipOf('one-two-entries', CASES['two-entries'].entries);
  const r = run('one.cjs', [two], { MIDST_OUT: dir });
  expect(r.stdout).toContain('entries on disk after extract: 2, .midst candidates: 2');
  expect(leaks(r.stdout + r.stderr)).toEqual([]);
});

test('trajectory reports a poem with no archive name and no frame text', () => {
  const ok = zipOf('trajectory-passes', CASES.passes.entries);
  const r = run('trajectory.cjs', [ok]);
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/^frames 4, history 4$/m);
  expect(r.stdout).toMatch(/detected:true/);
  expect(path.basename(ok)).toContain(MARK.object);
  expect(leaks(r.stdout + r.stderr)).toEqual([]);
});

test('trajectory extracts an entry whose name is a pattern or decomposed (midst-format #6)', () => {
  for (const name of ['Poem [draft].midst', 'Poéme.midst']) {
    const z = path.join(dir, `t-${Buffer.from(name).toString('hex')}.midst.zip`);
    const src = fs.mkdtempSync(path.join(dir, 'src-'));
    fs.writeFileSync(path.join(src, name), B(FRAMES));
    execFileSync('zip', ['-q', '-j', z, path.join(src, name)]);
    const r = run('trajectory.cjs', [z]);
    expect({ name, status: r.status }).toEqual({ name, status: 0 });
  }
});

test('a mismatch is reported by frame number; its text only with --show-text', () => {
  const r = { nFrames: 2, nHist: 2, bad: 1, endpointOk: false, firstBad: { i: 1, exp: `<p>${MARK.frame}</p>`, got: '<p>x</p>' } };
  const plain = report(r).join('\n');
  expect(plain).toContain('first mismatch at frame 1');
  expect(leaks(plain)).toEqual([]);
  expect(report(r, { showText: true }).join('\n')).toContain(MARK.frame);
});
