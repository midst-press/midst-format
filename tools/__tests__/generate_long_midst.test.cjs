/**
 * @jest-environment node
 */
// tools/generate_long_midst.mjs against a small INVENTED text (never the book, never a poem). Files are replayed with
// the midst-editor's own `step` / `reconstruct` (src/renderer/tracking/utils.ts), bundled the way conformance/build.mjs
// reaches the editor's source: MIDST_EDITOR_SRC, default ../midst-editor.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');

const REPO = path.join(__dirname, '..', '..');
const SCRIPT = path.join(REPO, 'tools', 'generate_long_midst.mjs');
const EDITOR = path.resolve(process.env.MIDST_EDITOR_SRC || path.join(REPO, '..', 'midst-editor'));

// Invented paragraphs, with the characters that need escaping, quotes, accents and one astral character (two UTF-16
// units, one keystroke).
const SENTENCES = [
  'The lamp-maker counted his small debts & found them kind.',
  'Is 3 < 5 and 9 > 2? The tide did not say, "no".',
  'A café by the quay sold salt, string and 𝄞 for the road.',
  'Nobody wrote the letter; everybody read it twice.',
];
const PARAGRAPHS = Array.from({ length: 40 }, (_, i) =>
  Array.from({ length: 5 + (i % 3) }, (_, j) => SENTENCES[(i + j) % SENTENCES.length]).join(' '));
// Hard-wrapped, as in the book, with blank-line breaks between paragraphs.
const SOURCE = PARAGRAPHS.map((p) => p.replace(/(.{40,}?) /g, '$1\n')).join('\n\n') + '\n';
// Invented, fast parameters in the committed file's schema. Each test changes the one parameter it is about.
const scalar = (nominal) => ({ nominal, range: [0, 1e9], rangeBasis: 'test', source: 'invented' });
const RATES = {
  measured: true,
  editKindShare: { insertOnly: scalar(0.6), removeOnly: scalar(0.2), replace: scalar(0.1), noop: scalar(0.1) },
  insertedChars: { shareExactlyOne: scalar(0.5), multiCharQuantiles: { quantiles: [[0, 2], [1, 6]], source: 'invented' } },
  deletionRuns: {
    lengthQuantiles: { quantiles: [[0, 1], [0.5, 3], [1, 6]], source: 'invented' },
    shareRetyped: scalar(0.5),
    removedCharsPerEdit: scalar(2),
  },
  gapMs: { quantiles: [[0, 50], [0.5, 120], [0.95, 600], [1, 6000]], source: 'invented' },
  burstCharsPerMinute: scalar(300),
  editsPerFinalChar: scalar(2),
};
// RATES with some parts replaced; `with_` merges one level down so a test names only what it changes.
const rates = (changes) => {
  const r = JSON.parse(JSON.stringify(RATES));
  for (const [k, v] of Object.entries(changes)) r[k] = v && typeof v === 'object' && !Array.isArray(v) && !('nominal' in v) && !('quantiles' in v) ? { ...r[k], ...v } : v;
  return r;
};

let work;
let textPath;
let editor;
let counter = 0;
const run = (args, env = {}) =>
  spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ...env } });
const writeRates = (r) => {
  counter += 1;
  const p = path.join(work, `rates${counter}.json`);
  fs.writeFileSync(p, JSON.stringify(r));
  return p;
};
// `rates` is an object in the parameter file's schema, or a path.
const gen = (name, { seed = 1, fraction = '1', rates: r = RATES, set = [] } = {}) => {
  const out = path.join(work, name);
  const ratesPath = typeof r === 'string' ? r : writeRates(r);
  const args = ['--text', textPath, '--rates', ratesPath, '--seed', String(seed), '--fraction', fraction, '--out', out];
  set.forEach((kv) => args.push('--set', kv));
  const res = run(args);
  if (res.status !== 0) throw new Error(`generator failed: ${res.stderr}`);
  return { out, summary: res.stdout, bytes: fs.readFileSync(out), stderr: res.stderr };
};
const parse = (bytes) => {
  const [header, json] = bytes.toString('utf8').split('\n');
  return { header, ...JSON.parse(json) };
};
const unescapeHtml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const paragraphsOfHtml = (html) => [...html.matchAll(/<p>(.*?)<\/p>/g)].map((m) => unescapeHtml(m[1]));
// ProseMirror position of a caret at the end of the document: a paragraph holds its text plus two boundary tokens, and
// the document opens with none, so the end sits one token before the sum.
const caretAtEnd = (html) => paragraphsOfHtml(html).reduce((n, p) => n + p.length + 2, 0) - 1;
// Replays with the editor's own `step`, calling `visit(html, entry, i)` after every entry; returns the final HTML.
const replay = (file, visit = () => {}) => {
  let html = '';
  file.history.forEach((e, i) => {
    html = editor.step(html, e);
    visit(html, e, i);
  });
  return html;
};
const WELL_FORMED = /^(<p>(?:[^<>&]|&amp;|&lt;|&gt;)*<\/p>)+$/;

// What the measuring tool sees in a file: each entry as removed / inserted HTML characters, a kind, and the gap before it.
function analyse(file) {
  let len = 0;
  let prevT = null;
  return file.history.map((e) => {
    const removed = len - e.front - e.end;
    const inserted = e.inserted.length;
    len += inserted - removed;
    const t = Date.parse(e.t);
    const gap = prevT === null ? null : t - prevT;
    prevT = t;
    const kind = removed === 0 && inserted === 0 ? 'noop' : removed === 0 ? 'insertOnly' : inserted === 0 ? 'removeOnly' : 'replace';
    return { kind, removed, inserted, gap, front: e.front };
  });
}
const share = (xs, f) => xs.filter(f).length / xs.length;
// Maximal runs of consecutive remove-only edits, each with whether the next edit inserts at the same place.
function runsOf(edits) {
  const runs = [];
  for (let i = 0; i < edits.length; i += 1) {
    if (edits[i].kind === 'removeOnly' && (i === 0 || edits[i - 1].kind !== 'removeOnly')) {
      let j = i;
      while (j + 1 < edits.length && edits[j + 1].kind === 'removeOnly') j += 1;
      const next = edits[j + 1];
      runs.push({ length: j - i + 1, retyped: !!next && next.inserted > 0 && next.front === edits[j].front });
      i = j;
    }
  }
  return runs;
}
const analysed = (name, o) => analyse(parse(gen(name, o).bytes));

beforeAll(() => {
  if (!fs.existsSync(path.join(EDITOR, 'src', 'renderer', 'tracking', 'utils.ts'))) {
    throw new Error(`midst-editor source not found at ${EDITOR}: set MIDST_EDITOR_SRC to a midst-editor checkout`);
  }
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'longmidst-')));
  const bundle = path.join(work, 'editor-utils.cjs');
  esbuild.buildSync({
    entryPoints: [path.join(EDITOR, 'src', 'renderer', 'tracking', 'utils.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent',
  });
  editor = require(bundle);
  textPath = path.join(work, 'text.txt');
  fs.writeFileSync(textPath, SOURCE);
});
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

describe('determinism', () => {
  test('same seed and arguments give byte-identical files', () => {
    expect(gen('a.midst', { seed: 7 }).bytes.equals(gen('b.midst', { seed: 7 }).bytes)).toBe(true);
  });
  test('a different seed gives a different history', () => {
    const a = parse(gen('a.midst', { seed: 7 }).bytes);
    const b = parse(gen('b.midst', { seed: 8 }).bytes);
    expect(JSON.stringify(a.history)).not.toBe(JSON.stringify(b.history));
    expect(a.text).toBe(b.text);
  });
});

describe('fractions', () => {
  test('the 1/2 poem is the leading paragraphs of the full one, cut at a paragraph boundary', () => {
    const full = paragraphsOfHtml(parse(gen('full.midst').bytes).text);
    const half = paragraphsOfHtml(parse(gen('half.midst', { fraction: '1/2' }).bytes).text);
    expect(full).toEqual(PARAGRAPHS);
    expect(half.length).toBeGreaterThan(0);
    expect(half.length).toBeLessThan(full.length);
    expect(half).toEqual(full.slice(0, half.length));
    const chars = (ps) => ps.reduce((n, p) => n + p.length, 0);
    expect(chars(half)).toBeLessThanOrEqual(chars(full) / 2);
    // ...and no later paragraph would also have fitted.
    expect(chars(full.slice(0, half.length + 1))).toBeGreaterThan(chars(full) / 2);
  });
  test('a malformed fraction is refused', () => {
    const r = run(['--text', textPath, '--rates', writeRates(RATES), '--fraction', '3/2', '--out', path.join(work, 'x.midst')]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--fraction/);
  });
});

describe('replay with the editor\'s own step/reconstruct', () => {
  let file;
  beforeAll(() => {
    file = parse(gen('replay.midst', { seed: 3 }).bytes);
  });
  test('has the current header, and ends exactly at the file\'s final text', () => {
    expect(file.header).toBe('midstVersion: 1');
    const finalHtml = replay(file);
    expect(finalHtml).toBe(file.text);
    expect(finalHtml).toBe(PARAGRAPHS.map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`).join(''));
    expect(editor.reconstruct('', file.history.slice(0, 2000), 1999)).toBe(replay({ history: file.history.slice(0, 2000) }));
  });
  test('every intermediate state is well-formed HTML', () => {
    let bad = null;
    replay(file, (html, e, i) => {
      if (bad === null && !WELL_FORMED.test(html)) bad = i;
    });
    expect(bad).toBeNull();
  });
  test('entries have the editor\'s fields and non-decreasing ISO times', () => {
    let last = -Infinity;
    file.history.forEach((e) => {
      expect(Object.keys(e)).toEqual(['inserted', 'front', 'end', 't', 'pos']);
      const t = Date.parse(e.t);
      expect(new Date(t).toISOString()).toBe(e.t);
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    });
  });
  test('every pos is the ProseMirror caret position after that edit', () => {
    const wrong = [];
    replay(file, (html, e, i) => {
      if (e.pos !== caretAtEnd(html)) wrong.push(i);
    });
    expect(wrong).toEqual([]);
  });
});

describe('each measured rate takes effect', () => {
  test('edit kinds come out at the configured shares, and a changed share moves them', () => {
    const e = analysed('k1.midst');
    expect(share(e, (x) => x.kind === 'insertOnly')).toBeGreaterThan(0.55);
    expect(share(e, (x) => x.kind === 'insertOnly')).toBeLessThan(0.7);
    expect(Math.abs(share(e, (x) => x.kind === 'removeOnly') - 0.2)).toBeLessThan(0.04);
    expect(Math.abs(share(e, (x) => x.kind === 'replace') - 0.1)).toBeLessThan(0.03);
    expect(Math.abs(share(e, (x) => x.kind === 'noop') - 0.1)).toBeLessThan(0.03);
    const more = rates({ editKindShare: { replace: scalar(0.25), insertOnly: scalar(0.45) } });
    expect(share(analysed('k2.midst', { rates: more }), (x) => x.kind === 'replace')).toBeGreaterThan(0.2);
    const none = rates({ editKindShare: { replace: scalar(0), insertOnly: scalar(0.7), noop: scalar(0.1) } });
    expect(share(analysed('k3.midst', { rates: none }), (x) => x.kind === 'replace')).toBe(0);
  });
  test('the share of one-character inserts follows insertedChars.shareExactlyOne', () => {
    const ones = (v) => {
      const e = analysed(`one${v}.midst`, { rates: rates({ insertedChars: { shareExactlyOne: scalar(v) } }) });
      // Typing edits only: the paragraph-break and first-keystroke edits insert markup.
      const ins = e.filter((x) => x.kind === 'insertOnly' && x.inserted !== 7);
      return share(ins, (x) => x.inserted === 1);
    };
    expect(ones(0.35)).toBeLessThan(ones(0.7) - 0.15);
    expect(Math.abs(ones(0.7) - 0.7 / 0.7)).toBeLessThan(0.45); // 0.7 of all edits, of the 0.7 that insert
    expect(Math.abs(ones(0.35) - 0.35 / 0.7)).toBeLessThan(0.1);
  });
  test('multi-character inserts stay within the configured size table', () => {
    const e = analysed('multi.midst', { rates: rates({ insertedChars: { multiCharQuantiles: { quantiles: [[0, 5], [1, 5]] }, shareExactlyOne: scalar(0.3) } }) });
    const typing = e.filter((x) => x.kind === 'insertOnly' && x.inserted !== 7);
    const multi = typing.filter((x) => x.inserted > 1);
    expect(multi.length).toBeGreaterThan(100);
    // Exactly the table's size, except where a paragraph ends first or an escape (&amp;) lengthens the HTML.
    expect(share(multi, (x) => x.inserted === 5)).toBeGreaterThan(0.85);
    expect(typing.some((x) => x.inserted === 1)).toBe(true);
  });
  test('deletion runs follow deletionRuns.lengthQuantiles', () => {
    const runLengths = (q) => runsOf(analysed(`len.midst`, { rates: rates({ deletionRuns: { lengthQuantiles: { quantiles: q } } }) })).map((r) => r.length);
    const four = runLengths([[0, 4], [1, 4]]);
    expect(four.length).toBeGreaterThan(100);
    expect(share(four, (n) => n === 4)).toBeGreaterThan(0.8);
    expect(Math.max(...four)).toBe(4);
    const one = runLengths([[0, 1], [1, 1]]);
    expect(Math.max(...one)).toBe(1);
  });
  test('the share of retyped runs follows deletionRuns.shareRetyped', () => {
    const retyped = (v) => share(runsOf(analysed('rt.midst', { rates: rates({ deletionRuns: { shareRetyped: scalar(v) } }) })), (r) => r.retyped);
    expect(Math.abs(retyped(0.9) - 0.9)).toBeLessThan(0.1);
    expect(Math.abs(retyped(0.1) - 0.1)).toBeLessThan(0.1);
  });
  test('characters taken out by one remove-only edit follow removedCharsPerEdit', () => {
    const mean = (v) => {
      const r = analysed('rm.midst', { rates: rates({ deletionRuns: { removedCharsPerEdit: scalar(v) } }) }).filter((x) => x.kind === 'removeOnly');
      return r.reduce((n, x) => n + x.removed, 0) / r.length;
    };
    expect(mean(1)).toBeLessThan(1.15);
    expect(mean(4)).toBeGreaterThan(2.8);
    expect(mean(4)).toBeLessThan(4.4);
  });
  test('gaps are drawn from gapMs.quantiles: a constant table gives constant gaps, a long tail gives long gaps', () => {
    const flat = rates({ gapMs: { quantiles: [[0, 100], [1, 100]] }, burstCharsPerMinute: scalar(600) });
    expect(new Set(analysed('flat.midst', { rates: flat }).slice(1).map((x) => x.gap))).toEqual(new Set([100]));
    const tail = rates({ gapMs: { quantiles: [[0, 100], [0.9, 200], [0.99, 5000], [1, 100000]] } });
    const over = share(analysed('tail.midst', { rates: tail }).slice(1), (x) => x.gap > 2000);
    // 2 s lies at p = 0.9644 on the log scale between the 200 ms and 5 s points: a share of about 3.6% (typing edits are
    // sped up a little, so slightly less).
    expect(over).toBeGreaterThan(0.015);
    expect(over).toBeLessThan(0.05);
  });
  test('single-character typing in bursts runs at burstCharsPerMinute', () => {
    const speed = (cpm, set = []) => {
      const e = analysed('burst.midst', { rates: rates({ gapMs: { quantiles: [[0, 60], [0.5, 140], [0.95, 600], [1, 3000]] } }), set });
      const g = e.slice(1).filter((x) => x.kind === 'insertOnly' && x.inserted === 1 && x.gap > 0 && x.gap < 2000).map((x) => x.gap);
      return g.length / (g.reduce((a, b) => a + b, 0) / 60000);
    };
    expect(Math.abs(speed(300) - 300)).toBeLessThan(25);
    const slow = speed(0, ['burstCharsPerMinute=150']);
    const fast = speed(0, ['burstCharsPerMinute=450']);
    expect(Math.abs(slow - 150)).toBeLessThan(15);
    expect(Math.abs(fast - 450)).toBeLessThan(40);
  });
});

describe('the parameter file', () => {
  const COMMITTED = path.join(REPO, 'tools', 'long_midst_rates.json');
  const committed = JSON.parse(fs.readFileSync(COMMITTED, 'utf8'));
  const scalars = [];
  (function walk(node, trail) {
    if (node && typeof node === 'object' && 'nominal' in node) scalars.push([trail.join('.'), node]);
    else if (node && typeof node === 'object' && !Array.isArray(node)) Object.entries(node).forEach(([k, v]) => walk(v, [...trail, k]));
  })(committed, []);

  test('is marked measured, names its source and the seed of the reported runs', () => {
    expect(committed.measured).toBe(true);
    expect(committed.provisional).toBeUndefined();
    expect(committed.source).toMatch(/converted-beta-0ec3c44, 54 poems, 233,233 entries, 16 Oct 2026, tools\/measure_typing_rates\.mjs/);
    expect(Number.isInteger(committed.reportedRunSeed)).toBe(true);
    expect(committed.note).toMatch(/rewrites/);
  });
  test('every scalar has a nominal value inside its range, a range basis and a source', () => {
    expect(scalars.length).toBeGreaterThanOrEqual(9);
    scalars.forEach(([name, s]) => {
      expect([name, s.range[0] <= s.nominal && s.nominal <= s.range[1]]).toEqual([name, true]);
      expect([name, typeof s.rangeBasis, typeof s.source]).toEqual([name, 'string', 'string']);
    });
    expect(scalars.map(([n]) => n)).toContain('burstCharsPerMinute');
  });
  test('generates a file that replays to its final text', () => {
    const file = parse(gen('committed.midst', { rates: COMMITTED, seed: committed.reportedRunSeed }).bytes);
    expect(replay(file)).toBe(file.text);
  });
  test('--set overrides a nominal value; an unknown name, a non-number and an out-of-range value are reported', () => {
    const base = gen('set0.midst', { rates: COMMITTED });
    const changed = gen('set1.midst', { rates: COMMITTED, set: ['deletionRuns.removedCharsPerEdit=2'] });
    expect(changed.bytes.equals(base.bytes)).toBe(false);
    expect(gen('set2.midst', { rates: COMMITTED, set: ['burstCharsPerMinute=900'] }).stderr).toMatch(/outside the stated range/);
    const bad = run(['--text', textPath, '--rates', COMMITTED, '--set', 'nope.nothing=1', '--out', path.join(work, 'x.midst')]);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/no scalar parameter named nope\.nothing/);
    const nan = run(['--text', textPath, '--rates', COMMITTED, '--set', 'burstCharsPerMinute=fast', '--out', path.join(work, 'x.midst')]);
    expect(nan.status).toBe(2);
  });
});

describe('failure modes', () => {
  test('a missing source text is a clear error that points at the fetch step, and nothing is downloaded', () => {
    const r = run(['--text', path.join(work, 'absent.txt'), '--rates', writeRates(RATES), '--out', path.join(work, 'x.midst')]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/source text not found/);
    expect(r.stderr).toMatch(/fetch_clarissa/);
    expect(r.stderr).toMatch(/never downloads/);
  });
  test('the text path may come from MIDST_LONG_TEXT', () => {
    const out = path.join(work, 'env.midst');
    const r = run(['--rates', writeRates(RATES), '--out', out], { MIDST_LONG_TEXT: textPath });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^chars=\d+ entries=\d+ bytes=\d+ seconds=[\d.]+\n$/);
  });
  test('an output path inside the repository is refused', () => {
    const r = run(['--text', textPath, '--rates', writeRates(RATES), '--out', path.join(REPO, 'should-not-exist.midst')]);
    expect(r.status).toBe(2);
    expect(fs.existsSync(path.join(REPO, 'should-not-exist.midst'))).toBe(false);
  });
  test('inconsistent or invalid rates are refused', () => {
    const run1 = (r) => run(['--text', textPath, '--rates', writeRates(r), '--out', path.join(work, 'x.midst')]);
    const bad = run1(rates({ editKindShare: { insertOnly: scalar(0.9) } }));
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/editKindShare must sum to 1/);
    const noRuns = run1(rates({ editKindShare: { removeOnly: scalar(0.7), insertOnly: scalar(0.1) }, insertedChars: { shareExactlyOne: scalar(0.15) }, deletionRuns: { shareRetyped: scalar(1) } }));
    expect(noRuns.status).toBe(2);
    expect(noRuns.stderr).toMatch(/inconsistent with deletionRuns/);
    // A typist who deletes more than it types never finishes: refused, not looped.
    const stuck = run1(rates({ editKindShare: { removeOnly: scalar(0.5), insertOnly: scalar(0.3) }, insertedChars: { shareExactlyOne: scalar(0.3) }, deletionRuns: { shareRetyped: scalar(1) } }));
    expect(stuck.status).toBe(2);
    expect(stuck.stderr).toMatch(/never be finished/);
  });
});
