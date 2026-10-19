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
// Stand-in source directories for provenance.cjs --src: extensions.ts with the schema block, and convert.ts with the
// trailing-<br> rule, the zero-width declarations and the invisible-paragraph ones (midst-editor #169), built from the harness's own normalise.cjs so the 'same'
// directory matches it exactly.
const srcTree = (name, schema, zeroWidth = (u) => u) => {
  const root = path.join(tmp, name, 'src');
  fs.mkdirSync(root, { recursive: true });
  const mine = fs.readFileSync(path.join(DIR, 'normalise.cjs'), 'utf8');
  const rule = mine.match(/const TRAILING_BREAK = .*;/)[0];
  // The zero-width declarations, from ZERO_WIDTH_CHARS to the end of ZERO_WIDTH_ONLY_ELEMENT.
  const from = mine.indexOf('const ZERO_WIDTH_CHARS =');
  const to = mine.indexOf(');\n', mine.indexOf('const ZERO_WIDTH_ONLY_ELEMENT =')) + 3;
  // The invisible-paragraph declarations, from INLINE_TAGS to the end of INVISIBLE_PARAGRAPH.
  const pFrom = mine.indexOf('const INLINE_TAGS =');
  const pTo = mine.indexOf(');\n', mine.indexOf('const INVISIBLE_PARAGRAPH =')) + 3;
  fs.writeFileSync(path.join(root, 'convert.ts'), zeroWidth(`${rule}\n${mine.slice(from, to)}\n${mine.slice(pFrom, pTo)}`));
  fs.writeFileSync(path.join(root, 'extensions.ts'), schema(mine.slice(mine.indexOf('const extensions = ['), mine.indexOf('];', mine.indexOf('const extensions = [')) + 2)));
  return root;
};
const same = (block) => block.replace('const extensions = [', 'const poemExtensions = [');
let srcSame, srcFlipped, srcNoBlock, srcZeroWidth, srcInvisible, srcMissing;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'midst-entry-'));
  empty = path.join(tmp, 'empty');
  fs.mkdirSync(empty);
  notZip = path.join(tmp, 'not-a-zip.midst.zip');
  fs.writeFileSync(notZip, 'this is not a zip archive');
  srcSame = srcTree('same', same);
  srcFlipped = srcTree('flipped', (b) => same(b).replace('strike: false', 'strike: true'));
  srcNoBlock = srcTree('noblock', (b) => b.replace('const extensions = [', 'const schema = ['));
  // The zero-width set without U+2060: the harness would no longer mirror the converter.
  srcZeroWidth = srcTree('zerowidth', same, (u) => u.replace(', 0x2060]', ']'));
  // The invisible-paragraph rule without <sub>: likewise.
  srcInvisible = srcTree('invisible', same, (u) => u.replace("const INLINE_TAGS = 'em|strong|i|b|u|span|s|strike|a|font|sup|sub'", "const INLINE_TAGS = 'em|strong|i|b|u|span|s|strike|a|font|sup'"));
  srcMissing = path.join(tmp, 'no-such-src');
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
  ['shapes_fuzz: retired --pos-known', 'shapes_fuzz.cjs', ['--pos-known', '1/1/1/1/1'], () => ({}), ['usage'], 2, true],
  ['control_probe: no argument', 'control_probe.cjs', [], () => ({}), ['usage'], 2, true],
  ['trajectory: no argument', 'trajectory.cjs', [], () => ({}), ['usage'], 2, true],
  ['one: no argument', 'one.cjs', [], () => ({}), ['usage'], 2, true],
  ['one: not a zip', 'one.cjs', [() => notZip], () => ({ MIDST_OUT: tmp }), ['harness-error'], 2, true],
  ['provenance: unknown argument', 'provenance.cjs', ['--bogus'], () => ({}), ['usage'], 2, true],
  ['provenance: --src without a directory', 'provenance.cjs', ['--src'], () => ({}), ['usage'], 2, true],
  ['provenance: control, the repository itself', 'provenance.cjs', [], () => ({}), [], 0, true],
  ['provenance: control, the same schema', 'provenance.cjs', ['--src', () => srcSame], () => ({}), [], 0, true],
  ['provenance: an option flipped', 'provenance.cjs', ['--src', () => srcFlipped], () => ({}), ['provenance-mismatch'], 1, true],
  ['provenance: no schema block', 'provenance.cjs', ['--src', () => srcNoBlock], () => ({}), ['provenance-mismatch'], 1, true],
  ['provenance: the zero-width rule differs', 'provenance.cjs', ['--src', () => srcZeroWidth], () => ({}), ['provenance-mismatch'], 1, true],
  ['provenance: the invisible-paragraph rule differs', 'provenance.cjs', ['--src', () => srcInvisible], () => ({}), ['provenance-mismatch'], 1, true],
  ['provenance: a source directory that does not exist', 'provenance.cjs', ['--src', () => srcMissing], () => ({}), ['harness-error'], 2, false],
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

// Which disagreement provenance names matters as much as that it names one.
test.each([
  ['an option flipped', () => srcFlipped, { stage: 'options', count: 2 }],
  ['no schema block', () => srcNoBlock, { stage: 'block-not-found' }],
  ['the zero-width rule differs', () => srcZeroWidth, { stage: 'zero-width' }],
  ['the invisible-paragraph rule differs', () => srcInvisible, { stage: 'invisible-paragraph' }],
])('provenance: %s is logged with its stage', (_name, dir, fields) => {
  const r = run('provenance.cjs', ['--src', dir()], {});
  const [rec] = r.stderr.trim().split('\n').map((l) => JSON.parse(l));
  const { ts, level, script, event, ...rest } = rec;
  expect(rest).toEqual(fields);
});
