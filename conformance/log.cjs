// The suite's error log: one JSON object per line, on stderr (midst-format #38). Stdout stays the human report.
//
//   logEvent('error', 'poem-error', { index: 3, stage: 'convert', class: 'TypeError' })
//   -> {"ts":"2026-10-16T03:00:00.000Z","level":"error","script":"verify_all","event":"poem-error","index":3,...}
//
// NOTHING LOGGED MAY BE TEXT FROM A POEM, or an exception's message (JSON.parse quotes its input). So the
// fields are an allowlist, and no string value is free text: `stage` and `code` come from closed vocabularies,
// `case` is a number, and `class` is a constructor's name read from the prototype (classOf). Anything else
// throws: a programming error, which a test catches before it can reach a log. (clement-7074f29f)
const fs = require('fs'),
  os = require('os'),
  path = require('path');

const LEVELS = ['error', 'warn'];
const FIELDS = ['stage', 'class', 'code', 'count', 'exit', 'index', 'firstBad', 'seed', 'case'];
// Event names are fixed kebab-case words.
const EVENT = /^[a-z]+(-[a-z]+)*$/;
// A class name: an identifier, as a constructor's own name is.
const TOKEN = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
// Where a failure happened: verify_lib's and markloss's stages, and provenance's kinds of disagreement.
const STAGES = ['list', 'extract', 'read', 'parse', 'normalise', 'convert', 'verify', 'write', 'options', 'block-not-found', 'no-options', 'trailing-break', 'zero-width'];
// The suite's own ConformanceError codes, and Node's: errno names, ERR_* and MODULE_NOT_FOUND.
const OWN_CODES = ['ENTRY_COUNT', 'EXTRACTED_COUNT', 'NO_FRAMES_ARRAY', 'NO_B_META', 'HISTORY_LONGER_THAN_FRAMES'];
const isCode = (c) =>
  typeof c === 'string' && (OWN_CODES.includes(c) || c === 'MODULE_NOT_FOUND' || /^ERR_[A-Z0-9_]{1,60}$/.test(c) || Object.hasOwn(os.constants.errno, c));
const STRINGS = { stage: (v) => STAGES.includes(v), code: isCode, class: (v) => TOKEN.test(v) };

// The entry point's name, without its extension: verify_all, shapes_fuzz, build.
const scriptName = () => (process.argv[1] ? path.basename(process.argv[1]).replace(/\.[cm]?js$/, '') : 'node');

function checked(level, event, fields) {
  if (!LEVELS.includes(level)) throw new TypeError(`log level must be one of ${LEVELS.join(', ')}`);
  if (typeof event !== 'string' || !EVENT.test(event)) throw new TypeError('log event must be a kebab-case name');
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) throw new TypeError('log fields must be an object');
  for (const [key, value] of Object.entries(fields)) {
    if (!FIELDS.includes(key)) throw new TypeError(`log field not allowed: ${key}`);
    const ok =
      (typeof value === 'number' && Number.isFinite(value)) ||
      typeof value === 'boolean' ||
      (typeof value === 'string' && key in STRINGS && STRINGS[key](value));
    if (!ok) throw new TypeError(`log field ${key}: not a number, a boolean, or a value from its vocabulary`);
  }
  return fields;
}

// Writes `line` to file descriptor 2 synchronously, so nothing is still queued when the script calls
// process.exit() right after logging. process.stderr.write is asynchronous on a pipe, and lines queued at exit
// are lost (river-2fc1630e measured 1,110 of 20,000 arriving). A pipe may be non-blocking, so EAGAIN is retried
// after a short wait, and a partial write carries on from where it stopped.
function writeAll(line, { fd = 2, writeSync = fs.writeSync, pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1) } = {}) {
  const bytes = Buffer.from(line, 'utf8');
  let done = 0;
  while (done < bytes.length) {
    try {
      done += writeSync(fd, bytes, done, bytes.length - done);
    } catch (e) {
      if (e.code !== 'EAGAIN') throw e;
      pause();
    }
  }
}

// Writes one line to stderr. `write` and `now` are for tests.
function logEvent(level, event, fields = {}, { write = (line) => writeAll(line), now = () => new Date() } = {}) {
  const record = { ts: now().toISOString(), level, script: scriptName(), event, ...checked(level, event, fields) };
  write(`${JSON.stringify(record)}\n`);
}

// The class of a thrown value, never its message. Read from the PROTOTYPE's constructor: an own `constructor`
// property, as on a parsed data object, would otherwise put a word of the data in the log (clement-7074f29f).
// A name that is not a plain identifier is 'unnamed', so logging a class can never be what throws.
const classOf = (e) => {
  const proto = e !== null && e !== undefined ? Object.getPrototypeOf(e) : null;
  const name = proto && typeof proto.constructor === 'function' ? proto.constructor.name : typeof e;
  return TOKEN.test(name) ? name : 'unnamed';
};

// A thrown error's code, when it is one the log may carry (ours, or Node's own: ENOENT, MODULE_NOT_FOUND, ...).
// Only from an Error: Node sets `code` on its errors, and a parsed data object is never one, so its own `code`
// property cannot reach the log (clement-7074f29f).
const codeOf = (e) => (e instanceof Error && isCode(e.code) ? e.code : undefined);

// A harness error, reported for a person and for the log: the class and code only, never the message.
// `out` and `log` are for tests.
function reportHarnessError(e, { out = (line) => writeAll(line, { fd: 1 }), log = logEvent } = {}) {
  const fields = { class: classOf(e) };
  const code = codeOf(e);
  if (code) fields.code = code;
  out(`harness error: ${fields.class}${code ? ` (${code})` : ''}. Its message is not shown, because it can quote a poem.\n`);
  log('error', 'harness-error', fields);
}

// For an entry point: a throw that nothing caught is reported as a harness error and the run exits 2. Without
// this, Node prints the message and stack, and a message can quote poem text.
function installUncaughtHandler({ exit = (code) => process.exit(code), report = reportHarnessError } = {}) {
  const handle = (e) => {
    try {
      report(e);
    } finally {
      exit(2);
    }
  };
  process.on('uncaughtException', handle);
  process.on('unhandledRejection', handle);
  return handle;
}

module.exports = { logEvent, installUncaughtHandler, reportHarnessError, classOf, codeOf, writeAll, FIELDS, LEVELS, STAGES };
