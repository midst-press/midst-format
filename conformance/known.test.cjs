// verify_all.cjs --known (midst-format #72): the expected differences, a ratchet. Rows here are made on the spot
// with the fields verifyZip returns; no poem is read.
const fs = require('fs'),
  path = require('path'),
  os = require('os');
const { spawnSync } = require('child_process');
const { validateKnown, knownVerdict, checkKnown, knownMark, knownExitCode, ConformanceError } = require('./verify_lib.cjs');

// A row that passes, as verifyZip returns one; `over` makes it fail in one way.
const row = (index, over = {}) => ({
  index,
  name: `zq-${index}`,
  frames: 100,
  hist: 100,
  trajectoryBad: 0,
  textBad: 0,
  firstBad: null,
  endpointOk: true,
  control: true,
  metaOk: true,
  histLenOk: true,
  metaControl: true,
  metaFields: 3,
  ...over,
});
const entry = (over = {}) => ({ frames: 100, badFrames: 0, textBad: 2, why: 'midst-editor #15', ...over });

describe('a row against the known list', () => {
  const known = { '#03': entry() };

  test('fails exactly as its entry says: known', () => {
    expect(knownVerdict(row(3, { textBad: 2 }), known)).toBe('known');
    expect(knownMark(row(3, { textBad: 2 }), known)).toBe(' (known)');
  });

  test.each([
    ['more text differences', { textBad: 3 }],
    ['fewer text differences: a fix needs an edit too', { textBad: 1 }],
    ['trajectory differences it does not list', { textBad: 2, trajectoryBad: 1 }],
    ['another frame count: another poem at that index', { textBad: 2, frames: 101 }],
    ['an endpoint that does not match', { textBad: 2, endpointOk: false }],
    ['meta that does not match', { textBad: 2, metaOk: false }],
    ['a history of the wrong length', { textBad: 2, histLenOk: false }],
  ])('differs from its entry, %s: unexpected', (_name, over) => {
    expect(knownVerdict(row(3, over), known)).toBe('unexpected');
    expect(knownMark(row(3, over), known)).toBe(' UNEXPECTED (known frames/badFrames/textBad: 100/0/2)');
  });

  test('an error is never known, even at an index with an entry', () => {
    const r = { index: 3, name: 'zq', error: { stage: 'parse', class: 'SyntaxError' } };
    expect(knownVerdict(r, known)).toBe('unexpected');
    // Even if an erroring row ever carried counts that match its entry.
    expect(knownVerdict(row(3, { textBad: 2, error: r.error }), known)).toBe('unexpected');
  });

  test('a failing poem with no entry is unexpected', () => {
    expect(knownVerdict(row(4, { textBad: 1 }), known)).toBe('unexpected');
    expect(knownMark(row(4, { textBad: 1 }), known)).toBe(' UNEXPECTED (not known)');
  });

  test('a passing poem with an entry is stale, and its named line gets no mark', () => {
    expect(knownVerdict(row(3), known)).toBe('stale');
    expect(knownMark(row(3), known)).toBe('');
    expect(knownVerdict(row(4), known)).toBe('pass');
  });

  test('an entry under an Object.prototype name excuses nothing', () => {
    expect(knownVerdict(row(5, { textBad: 2 }), Object.create({ '#05': entry() }))).toBe('unexpected');
  });
});

describe('the run against the known list', () => {
  test('known, unexpected and stale are counted, stale by index', () => {
    const known = { '#01': entry(), '#02': entry(), '#07': entry() };
    const rows = [
      row(1, { textBad: 2 }), // known
      row(2), // passes: its entry is stale
      row(3, { textBad: 1 }), // not listed: unexpected
    ];
    // #07: no poem at that index, also stale.
    expect(checkKnown(rows, known)).toEqual({ known: 1, unexpected: 1, stale: ['#02', '#07'] });
  });

  test('a failing poem that does not match its entry is unexpected, not also stale', () => {
    expect(checkKnown([row(1, { textBad: 9 })], { '#01': entry() })).toEqual({ known: 0, unexpected: 1, stale: [] });
  });

  test('every failure known and nothing stale: clean', () => {
    expect(checkKnown([row(1, { textBad: 2 }), row(2)], { '#01': entry() })).toEqual({ known: 1, unexpected: 0, stale: [] });
  });

  test('an empty list makes every failure unexpected', () => {
    expect(checkKnown([row(1, { textBad: 2 }), row(2)], {})).toEqual({ known: 0, unexpected: 1, stale: [] });
  });
});

describe('the exit status under --known', () => {
  const ran = { total: 2, ctl: 2, ctlN: 2 };
  const clean = { known: 1, unexpected: 0, stale: [] };

  test('every failure known, nothing stale, controls fired: 0', () => {
    expect(knownExitCode(ran, clean)).toBe(0);
  });

  test.each([
    ['an unexpected failure', ran, { ...clean, unexpected: 1 }],
    ['a stale entry', ran, { ...clean, stale: ['#07'] }],
    ['a control that did not fire', { ...ran, ctl: 1 }, clean],
    ['nothing verified', { total: 0, ctl: 0, ctlN: 0 }, clean],
  ])('%s: 1', (_name, s, k) => {
    expect(knownExitCode(s, k)).toBe(1);
  });
});

describe('the known file itself', () => {
  test('a well-formed list is returned as it is', () => {
    const k = { '#08': entry(), '#28': entry({ badFrames: 1, textBad: 0 }) };
    expect(validateKnown(k)).toBe(k);
  });

  test.each([
    ['not an object', []],
    ['a key that is not an index', { 'poem name': entry() }],
    ['an index without its hash', { '08': entry() }],
    ['a count missing', { '#08': { frames: 1, textBad: 1, why: 'x' } }],
    ['a count that is not a whole number', { '#08': entry({ textBad: 1.5 }) }],
    ['a negative count', { '#08': entry({ frames: -1 }) }],
    ['no reason', { '#08': { frames: 1, badFrames: 0, textBad: 1 } }],
    ['an entry that expects no difference', { '#08': entry({ textBad: 0 }) }],
  ])('refuses %s', (_name, k) => {
    expect(() => validateKnown(k)).toThrow(ConformanceError);
  });

  test('names the entry it refuses by its position, never its key', () => {
    let thrown;
    try {
      validateKnown({ '#01': entry(), 'a title': entry() });
    } catch (e) {
      thrown = e;
    }
    expect([thrown.code, thrown.count]).toEqual(['KNOWN_SHAPE', 2]);
  });
});

describe('verify_all.cjs --known', () => {
  const runWith = (knownText) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'midst-known-'));
    try {
      const file = path.join(dir, 'known.json');
      fs.writeFileSync(file, knownText);
      fs.mkdirSync(path.join(dir, 'corpus'));
      return spawnSync(process.execPath, [path.join(__dirname, 'verify_all.cjs'), '--known', file], {
        encoding: 'utf8',
        env: { ...process.env, MIDST_CORPUS: path.join(dir, 'corpus'), MIDST_OUT: path.join(dir, 'out') },
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  test('a known file that is not JSON stops the run before any poem, exit 2, without its text', () => {
    const r = runWith('{"#01": zq-secret');
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(/was not usable: SyntaxError/);
    expect(r.stdout + r.stderr).not.toContain('zq-secret');
    expect(r.stderr).toContain('"event":"known-unusable"');
  });

  test('a known file of the wrong shape names the entry by position, exit 2', () => {
    const r = runWith(JSON.stringify({ 'zq title': entry() }));
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(/KNOWN_SHAPE \(entry 1\)/);
    expect(r.stdout + r.stderr).not.toContain('zq title');
  });

  test('a usable list with an empty corpus still fails: nothing was verified', () => {
    const r = runWith(JSON.stringify({ '#01': entry() }));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('STALE known #01');
    expect(r.stdout).toContain('known 0   unexpected 0   stale 1');
  });
});
