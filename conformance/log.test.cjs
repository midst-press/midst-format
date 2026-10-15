// Unit tests for log.cjs (midst-format #38). All values are synthetic.
const { logEvent, installUncaughtHandler, reportHarnessError, classOf, codeOf, writeAll, FIELDS } = require('./log.cjs');
const fs = require('fs');
// What a spied fs.writeSync was given, as text: each call is (fd, buffer, offset, length).
const written = (spy, fd = 2) =>
  spy.mock.calls
    .filter(([f]) => f === fd)
    .map(([, b, o, n]) => Buffer.from(b).toString('utf8', o, o + n))
    .join('');

const NOW = () => new Date('2026-10-16T03:00:00.000Z');
const capture = (level, event, fields) => {
  const lines = [];
  logEvent(level, event, fields, { write: (l) => lines.push(l), now: NOW });
  return lines;
};

describe('logEvent output', () => {
  test('writes exactly one newline-terminated JSON line with the expected keys', () => {
    const lines = capture('error', 'poem-fail', { index: 3, firstBad: 1 });
    expect(lines).toHaveLength(1);
    expect(lines[0].endsWith('\n')).toBe(true);
    expect(lines[0].slice(0, -1)).not.toContain('\n');
    const rec = JSON.parse(lines[0]);
    expect(Object.keys(rec)).toEqual(['ts', 'level', 'script', 'event', 'index', 'firstBad']);
    expect(rec).toMatchObject({ ts: '2026-10-16T03:00:00.000Z', level: 'error', event: 'poem-fail', index: 3, firstBad: 1 });
    expect(typeof rec.script).toBe('string');
  });

  test('fields default to empty', () => {
    const rec = JSON.parse(capture('warn', 'usage')[0]);
    expect(Object.keys(rec)).toEqual(['ts', 'level', 'script', 'event']);
  });

  test('script is the entry point name without extension', () => {
    const rec = JSON.parse(capture('error', 'usage')[0]);
    expect(rec.script).not.toMatch(/\.[cm]?js$/);
    expect(rec.script).not.toContain('/');
  });

  test('script falls back to node when there is no argv[1]', () => {
    const saved = process.argv;
    process.argv = [saved[0]];
    try {
      expect(JSON.parse(capture('error', 'usage')[0]).script).toBe('node');
    } finally {
      process.argv = saved;
    }
  });

  test('the default writer goes to stderr (fd 2, synchronously), with the real clock', () => {
    const spy = jest.spyOn(fs, 'writeSync').mockImplementation((fd, b, o, n) => n);
    try {
      logEvent('error', 'usage');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe(2);
      const rec = JSON.parse(written(spy));
      expect(rec.event).toBe('usage');
      expect(Number.isNaN(Date.parse(rec.ts))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('level and event validation', () => {
  test.each(['info', 'ERROR', '', undefined, null, 3])('level %p throws', (level) => {
    expect(() => capture(level, 'usage')).toThrow(TypeError);
  });
  test.each(['error', 'warn'])('level %s is accepted', (level) => {
    expect(capture(level, 'usage')).toHaveLength(1);
  });
  test.each(['Usage', 'poem_fail', 'poem-', '-poem', 'poem--fail', 'a b', '', 'poem1', undefined, null, 5, {}])('event %p throws', (event) => {
    expect(() => capture('error', event)).toThrow(TypeError);
  });
  test.each(['usage', 'poem-error', 'a-b-c'])('event %s is accepted', (event) => {
    expect(capture('error', event)).toHaveLength(1);
  });
  test('a rejected call writes nothing', () => {
    const lines = [];
    expect(() => logEvent('error', 'usage', { nope: 1 }, { write: (l) => lines.push(l), now: NOW })).toThrow(TypeError);
    expect(lines).toEqual([]);
  });
});

describe('fields', () => {
  test('the allowlist is exactly the documented set', () => {
    expect(FIELDS).toEqual(['stage', 'class', 'code', 'count', 'exit', 'index', 'firstBad', 'seed', 'case']);
  });
  test.each(FIELDS)('allowlisted field %s accepts a number and a boolean', (key) => {
    for (const value of [0, -1, 2.5, true, false]) {
      expect(JSON.parse(capture('error', 'usage', { [key]: value })[0])[key]).toBe(value);
    }
  });
  // No string field takes free text (clement-7074f29f): stage and code from closed vocabularies, class an identifier.
  test.each([
    ['stage', 'convert'],
    ['stage', 'block-not-found'],
    ['code', 'ENTRY_COUNT'],
    ['code', 'ENOENT'],
    ['code', 'MODULE_NOT_FOUND'],
    ['code', 'ERR_INVALID_ARG_TYPE'],
    ['class', 'ConformanceError'],
  ])('%s accepts %j from its vocabulary', (key, value) => {
    expect(JSON.parse(capture('error', 'usage', { [key]: value })[0])[key]).toBe(value);
  });
  test.each([
    ['stage', 'moonlight'],
    ['stage', 'Convert'],
    ['code', 'LOVE'],
    ['code', 'ERR_'],
    ['code', 'entry_count'],
    ['class', 'two words'],
    ['case', 'font'],
    ['seed', 'moonlight'],
    ['index', 'moonlight'],
    ['count', 'moonlight'],
    ['exit', 'moonlight'],
    ['firstBad', 'moonlight'],
  ])('%s refuses %j: a word cannot be logged even by mistake', (key, value) => {
    expect(() => capture('error', 'usage', { [key]: value })).toThrow(/vocabulary/);
  });
  test('all allowlisted fields together', () => {
    const fields = Object.fromEntries(FIELDS.map((k, i) => [k, i]));
    expect(JSON.parse(capture('error', 'usage', fields)[0])).toMatchObject(fields);
  });
  test.each(['message', 'name', 'text', 'Stage', 'ts', 'level', 'script', 'event', '__proto__x'])('non-allowlisted key %s throws', (key) => {
    expect(() => capture('error', 'usage', { [key]: 1 })).toThrow(/not allowed/);
  });
  test('an allowlisted key does not excuse a bad sibling', () => {
    expect(() => capture('error', 'usage', { index: 1, extra: 1 })).toThrow(TypeError);
  });
  test('a 64-character identifier is accepted, 65 throws', () => {
    expect(capture('error', 'usage', { class: 'a'.repeat(64) })).toHaveLength(1);
    expect(() => capture('error', 'usage', { class: 'a'.repeat(65) })).toThrow(TypeError);
  });
  test.each(['has space', 'two\nlines', 'tab\there', '', 'quo"te', 'slash/path', 'café', '<p>x</p>', 'a,b'])('string %j throws', (value) => {
    expect(() => capture('error', 'usage', { class: value })).toThrow(TypeError);
  });
  test.each([NaN, Infinity, -Infinity, {}, { a: 1 }, null, undefined, () => 1, 10n, Symbol('s')].map((v) => [v]).concat([[[]], [[1]]]))('value %p throws', (value) => {
    expect(() => capture('error', 'usage', { count: value })).toThrow(TypeError);
  });
  test.each([[[]], [[1]], ['text'], [5], [true]])('fields %p that is not an object throws', (fields) => {
    expect(() => capture('error', 'usage', fields)).toThrow(/object/);
  });
  test('explicit null fields throws (default applies only to undefined)', () => {
    expect(() => capture('error', 'usage', null)).toThrow(TypeError);
  });
});

describe('classOf', () => {
  test('normal errors give their class name', () => {
    expect(classOf(new TypeError('x'))).toBe('TypeError');
    expect(classOf(new Error('x'))).toBe('Error');
    class ConformanceError extends Error {}
    expect(classOf(new ConformanceError('x'))).toBe('ConformanceError');
  });
  test('null and undefined give their typeof; other primitives their wrapper class', () => {
    expect(classOf(undefined)).toBe('undefined');
    expect(classOf(null)).toBe('object');
    expect(classOf(0)).toBe('Number');
    expect(classOf('')).toBe('String');
    expect(classOf('s')).toBe('String');
  });
  test('an own constructor property on data is ignored: the class comes from the prototype', () => {
    expect(classOf(JSON.parse('{"constructor":{"name":"aword"}}'))).toBe('Object');
    const e = new Error('x');
    e.constructor = { name: 'aword' };
    expect(classOf(e)).toBe('Error');
  });
  test('an object without a constructor falls back to typeof', () => {
    expect(classOf(Object.create(null))).toBe('object');
  });
  test('a constructor name that is not an identifier is unnamed', () => {
    class F extends Error {}
    const e = new F('x');
    Object.defineProperty(F, 'name', { value: 'has a space' });
    expect(classOf(e)).toBe('unnamed');
    Object.defineProperty(F, 'name', { value: 'x'.repeat(65) });
    expect(classOf(e)).toBe('unnamed');
    Object.defineProperty(F, 'name', { value: '' });
    expect(classOf(e)).toBe('unnamed');
  });
  test('the result is always accepted as a log value', () => {
    for (const v of [new Error('x'), null, undefined, 3, { constructor: { name: 'a b' } }]) {
      expect(() => capture('error', 'harness-error', { class: classOf(v) })).not.toThrow();
    }
  });
});

describe('installUncaughtHandler', () => {
  const SECRET = 'SYNTHETICSECRETMESSAGE';
  let spy;
  let added;
  const install = (opts) => {
    const before = { e: process.listeners('uncaughtException'), r: process.listeners('unhandledRejection') };
    const handle = installUncaughtHandler(opts);
    added = {
      e: process.listeners('uncaughtException').filter((l) => !before.e.includes(l)),
      r: process.listeners('unhandledRejection').filter((l) => !before.r.includes(l)),
    };
    return handle;
  };
  beforeEach(() => {
    spy = jest.spyOn(fs, 'writeSync').mockImplementation((fd, b, o, n) => n);
  });
  afterEach(() => {
    spy.mockRestore();
    for (const l of added.e) process.removeListener('uncaughtException', l);
    for (const l of added.r) process.removeListener('unhandledRejection', l);
  });

  test('logs one harness-error with the class and exits 2, never the message', () => {
    const exit = jest.fn();
    const handle = install({ exit });
    expect(added.e).toEqual([handle]);
    expect(added.r).toEqual([handle]);
    handle(new RangeError(SECRET));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(2);
    const out = written(spy);
    expect(out.endsWith('\n')).toBe(true);
    const lines = out.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ level: 'error', event: 'harness-error', class: 'RangeError' });
    expect(out).not.toContain(SECRET);
  });

  test('a thrown non-error is logged by type', () => {
    const exit = jest.fn();
    install({ exit })(SECRET);
    const rec = JSON.parse(written(spy));
    expect(rec.class).toBe('String');
    expect(written(spy)).not.toContain(SECRET);
    expect(exit).toHaveBeenCalledWith(2);
  });

  test('still exits 2 when logging itself throws', () => {
    const exit = jest.fn();
    spy.mockImplementation(() => {
      throw new Error('stderr closed');
    });
    const handle = install({ exit });
    expect(() => handle(new Error('x'))).toThrow('stderr closed');
    expect(exit).toHaveBeenCalledWith(2);
  });

  test('the default exit calls process.exit(2)', () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
    try {
      install()(new Error('x'));
      expect(exitSpy).toHaveBeenCalledWith(2);
    } finally {
      exitSpy.mockRestore();
    }
  });
});

describe('writeAll: the line reaches fd 2 whole, even from a pipe that is full', () => {
  const again = () => Object.assign(new Error('busy'), { code: 'EAGAIN' });
  test('a partial write carries on from where it stopped', () => {
    const got = [];
    const writeSync = jest.fn((fd, b, o, n) => {
      const k = Math.min(n, 3);
      got.push(b.toString('utf8', o, o + k));
      return k;
    });
    writeAll('abcdefgh\n', { writeSync, pause: () => {} });
    expect(got.join('')).toBe('abcdefgh\n');
    expect(writeSync.mock.calls.every(([fd]) => fd === 2)).toBe(true);
  });
  test('EAGAIN is waited out and retried, with the real pause', () => {
    let tries = 0;
    const writeSync = jest.fn((fd, b, o, n) => {
      tries += 1;
      if (tries < 3) throw again();
      return n;
    });
    writeAll('x\n', { writeSync });
    expect(tries).toBe(3);
  });
  test('any other error is thrown, not swallowed', () => {
    const writeSync = () => {
      throw Object.assign(new Error('closed'), { code: 'EPIPE' });
    };
    expect(() => writeAll('x\n', { writeSync })).toThrow('closed');
  });
});

// river-2fc1630e's case: many lines, then process.exit(), with a reader that is slow to drain the pipe. An
// asynchronous write loses whatever is still queued at exit; every line must arrive.
test('every line logged before process.exit() arrives, however slowly stderr is read', async () => {
  const { spawn } = require('child_process');
  const N = 20000;
  const code = `const { logEvent } = require(${JSON.stringify(require.resolve('./log.cjs'))});
for (let i = 0; i < ${N}; i++) logEvent('error', 'poem-fail', { index: i });
process.exit(1);`;
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.pause();
  await new Promise((r) => setTimeout(r, 500));
  let text = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d) => (text += d));
  child.stderr.resume();
  const status = await new Promise((r) => child.on('close', r));
  expect(status).toBe(1);
  const lines = text.trim().split('\n');
  expect(lines).toHaveLength(N);
  expect(JSON.parse(lines[N - 1]).index).toBe(N - 1);
}, 60000);

describe('reportHarnessError: a fixed line for the person, the class and code for the log, never the message', () => {
  const SECRET_WORD = 'moonlight';
  const report = (e) => {
    const out = [];
    const logged = [];
    reportHarnessError(e, { out: (l) => out.push(l), log: (level, event, fields) => logged.push({ level, event, fields }) });
    return { out: out.join(''), logged };
  };
  test("Node's own code is logged and printed", () => {
    const { out, logged } = report(Object.assign(new Error(`cannot open ${SECRET_WORD}`), { code: 'ENOENT' }));
    expect(logged).toEqual([{ level: 'error', event: 'harness-error', fields: { class: 'Error', code: 'ENOENT' } }]);
    expect(out).toBe('harness error: Error (ENOENT). Its message is not shown, because it can quote a poem.\n');
    expect(out).not.toContain(SECRET_WORD);
  });
  test('a code that is not a known one is left out', () => {
    const { out, logged } = report(Object.assign(new TypeError('x'), { code: SECRET_WORD }));
    expect(logged[0].fields).toEqual({ class: 'TypeError' });
    expect(out).not.toContain(SECRET_WORD);
  });
  test('codeOf takes only codes from the vocabulary, and only from objects', () => {
    expect(codeOf({ code: 'MODULE_NOT_FOUND' })).toBe('MODULE_NOT_FOUND');
    expect(codeOf({ code: 'ERR_REQUIRE_ESM' })).toBe('ERR_REQUIRE_ESM');
    expect(codeOf({ code: 'NO_B_META' })).toBe('NO_B_META');
    expect(codeOf({ code: 'LOVE' })).toBeUndefined();
    expect(codeOf({ code: 3 })).toBeUndefined();
    expect(codeOf('ENOENT')).toBeUndefined();
    expect(codeOf(null)).toBeUndefined();
  });
  test('the default report writes the human line to stdout (fd 1) and the record to stderr (fd 2)', () => {
    const spy = jest.spyOn(fs, 'writeSync').mockImplementation((fd, b, o, n) => n);
    try {
      reportHarnessError(Object.assign(new Error(SECRET_WORD), { code: 'ENOENT' }));
      expect(written(spy, 1)).toMatch(/^harness error: Error \(ENOENT\)\./);
      expect(JSON.parse(written(spy, 2))).toMatchObject({ event: 'harness-error', class: 'Error', code: 'ENOENT' });
      expect(written(spy, 1) + written(spy, 2)).not.toContain(SECRET_WORD);
    } finally {
      spy.mockRestore();
    }
  });
});
