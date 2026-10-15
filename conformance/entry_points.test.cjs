// Each entry point, made to fail on purpose, must say so as JSONL on stderr (midst-format #38): every stderr
// line parses, the events are exactly the expected ones, and the exit status is the documented one.
// Synthetic inputs only: an empty directory, a file of non-zip bytes, bad flags.
const fs = require('fs'),
  path = require('path'),
  os = require('os');
const { spawnSync } = require('child_process');

const DIR = __dirname;
let empty;
let notZip;
let tmp;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'midst-entry-'));
  empty = path.join(tmp, 'empty');
  fs.mkdirSync(empty);
  notZip = path.join(tmp, 'not-a-zip.midst.zip');
  fs.writeFileSync(notZip, 'this is not a zip archive');
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// env without any MIDST_* variable, plus the ones the case sets
const cleanEnv = (extra) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('MIDST_'))), ...extra });

// One case per row: name, script, args (a function is resolved at run time), env extras, expected events, exit status, whether stdout has a message.
const run = (file, args, env) => spawnSync(process.execPath, [path.join(DIR, file), ...args], { encoding: 'utf8', env: cleanEnv(env), timeout: 60000 });

const CASES = [
  ['verify_all: no corpus', 'verify_all.cjs', [], () => ({}), ['corpus-not-set'], 2, true],
  ['verify_all: empty corpus', 'verify_all.cjs', [], () => ({ MIDST_CORPUS: empty }), ['no-poems'], 1, true],
  ['markloss: no corpus', 'markloss.cjs', [], () => ({}), ['corpus-not-set'], 2, true],
  ['markloss: empty corpus', 'markloss.cjs', [], () => ({ MIDST_CORPUS: empty }), ['no-poems'], 1, true],
  ['render_lines: no argument', 'render_lines.cjs', [], () => ({}), ['usage'], 2, true],
  ['render_lines: empty dir', 'render_lines.cjs', [() => empty], () => ({}), ['no-poems'], 2, true],
  ['shapes_fuzz: bad --history', 'shapes_fuzz.cjs', ['--history', 'bogus'], () => ({}), ['usage'], 2, true],
  ['shapes_fuzz: --n 0', 'shapes_fuzz.cjs', ['--n', '0'], () => ({}), ['usage'], 2, true],
  ['shapes_fuzz: unknown --open class', 'shapes_fuzz.cjs', ['--open', 'nosuchclass'], () => ({}), ['usage'], 2, true],
  ['control_probe: no argument', 'control_probe.cjs', [], () => ({}), ['usage'], 2, true],
  ['trajectory: no argument', 'trajectory.cjs', [], () => ({}), ['usage'], 2, true],
  ['one: no argument', 'one.cjs', [], () => ({}), ['usage'], 2, true],
  ['build: no editor source', 'build.mjs', [], () => ({}), ['build-env-not-set'], 2, true],
  ['one: not a zip', 'one.cjs', [() => notZip], () => ({ MIDST_OUT: tmp }), ['harness-error'], 2, false],
];

describe('entry points fail loudly as JSONL on stderr', () => {
  test.each(CASES)('%s', (_name, file, args, env, events, exit, printsHuman) => {
    const r = run(file, args.map((a) => (typeof a === 'function' ? a() : a)), env());
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(exit);
    const lines = r.stderr.split('\n');
    expect(lines.pop()).toBe(''); // stderr ends with a newline and holds nothing after the last record
    const records = lines.map((l, i) => {
      let rec;
      try {
        rec = JSON.parse(l);
      } catch {
        throw new Error(`stderr line ${i + 1} is not JSON`); // never quote the line: it is what the log must keep clean
      }
      return rec;
    });
    expect(records.map((x) => x.event)).toEqual(events);
    const script = path.basename(file).replace(/\.[cm]?js$/, '');
    for (const rec of records) {
      expect(rec.level).toBe('error');
      expect(rec.script).toBe(script);
      expect(Number.isNaN(Date.parse(rec.ts))).toBe(false);
    }
    if (events[0] === 'harness-error') expect(records[0].class).toMatch(/^[A-Za-z0-9_$.:-]{1,64}$/);
    if (printsHuman) expect(r.stdout.trim()).not.toBe('');
  });
});
