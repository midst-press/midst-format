// Unit tests for log.cjs (midst-format #38). All values are synthetic.
const { logEvent, installUncaughtHandler, classOf, FIELDS } = require('./log.cjs');

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

  test('the default writer goes to stderr, with the real clock', () => {
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      logEvent('error', 'usage');
      expect(spy).toHaveBeenCalledTimes(1);
      const rec = JSON.parse(spy.mock.calls[0][0]);
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
  test.each(FIELDS)('allowlisted field %s accepts a number, a boolean and an identifier', (key) => {
    for (const value of [0, -1, 2.5, true, false, 'ConformanceError', 'a.b:c-d_e$1']) {
      expect(JSON.parse(capture('error', 'usage', { [key]: value })[0])[key]).toBe(value);
    }
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
  test('non-objects give their typeof', () => {
    expect(classOf(undefined)).toBe('undefined');
    expect(classOf(null)).toBe('object');
    expect(classOf(0)).toBe('number');
    expect(classOf('')).toBe('string');
    expect(classOf('s')).toBe('String');
  });
  test('an object without a constructor falls back to typeof', () => {
    expect(classOf(Object.create(null))).toBe('object');
  });
  test('a constructor name that is not an identifier is unnamed', () => {
    const e = new Error('x');
    function F() {}
    Object.defineProperty(F, 'name', { value: 'has a space' });
    e.constructor = F;
    expect(classOf(e)).toBe('unnamed');
    Object.defineProperty(F, 'name', { value: 'x'.repeat(65) });
    expect(classOf(e)).toBe('unnamed');
    Object.defineProperty(F, 'name', { value: '' });
    expect(classOf(e)).toBe('object');
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
    spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
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
    const written = spy.mock.calls.map((c) => c[0]).join('');
    expect(written.endsWith('\n')).toBe(true);
    const lines = written.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ level: 'error', event: 'harness-error', class: 'RangeError' });
    expect(written).not.toContain(SECRET);
  });

  test('a thrown non-error is logged by type', () => {
    const exit = jest.fn();
    install({ exit })(SECRET);
    const rec = JSON.parse(spy.mock.calls[0][0]);
    expect(rec.class).toBe('String');
    expect(spy.mock.calls[0][0]).not.toContain(SECRET);
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
