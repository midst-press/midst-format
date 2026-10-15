// The suite's error log: one JSON object per line, on stderr (midst-format #38). Stdout stays the human report.
//
//   logEvent('error', 'poem-error', { index: 3, stage: 'convert', class: 'TypeError' })
//   -> {"ts":"2026-10-16T03:00:00.000Z","level":"error","script":"verify_all","event":"poem-error","index":3,...}
//
// NOTHING LOGGED MAY BE TEXT FROM A POEM, or an exception's message (JSON.parse quotes its input). So the
// fields are an allowlist, every value is a number, a boolean or a short identifier, and anything else
// throws: a programming error, which a test catches before it can reach a log.
const path = require('path');

const LEVELS = ['error', 'warn'];
const FIELDS = ['stage', 'class', 'code', 'count', 'exit', 'index', 'firstBad', 'seed', 'case'];
// Event names are fixed kebab-case words; string values are identifiers (a class, a code, a stage).
const EVENT = /^[a-z]+(-[a-z]+)*$/;
const TOKEN = /^[A-Za-z0-9_$.:-]{1,64}$/;

// The entry point's name, without its extension: verify_all, shapes_fuzz, build.
const scriptName = () => (process.argv[1] ? path.basename(process.argv[1]).replace(/\.[cm]?js$/, '') : 'node');

function checked(level, event, fields) {
  if (!LEVELS.includes(level)) throw new TypeError(`log level must be one of ${LEVELS.join(', ')}`);
  if (typeof event !== 'string' || !EVENT.test(event)) throw new TypeError('log event must be a kebab-case name');
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) throw new TypeError('log fields must be an object');
  for (const [key, value] of Object.entries(fields)) {
    if (!FIELDS.includes(key)) throw new TypeError(`log field not allowed: ${key}`);
    const ok =
      (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean' || (typeof value === 'string' && TOKEN.test(value));
    if (!ok) throw new TypeError(`log field ${key} must be a number, a boolean or an identifier`);
  }
  return fields;
}

// Writes one line to stderr. `write` and `now` are for tests.
function logEvent(level, event, fields = {}, { write = (line) => process.stderr.write(line), now = () => new Date() } = {}) {
  const record = { ts: now().toISOString(), level, script: scriptName(), event, ...checked(level, event, fields) };
  write(`${JSON.stringify(record)}\n`);
}

// The class of a thrown value, never its message. A class whose name is not a plain identifier is 'unnamed',
// so logging a class can never be what throws.
const classOf = (e) => {
  const name = (e && e.constructor && e.constructor.name) || typeof e;
  return TOKEN.test(name) ? name : 'unnamed';
};

// For an entry point: a throw that nothing caught is logged as harness-error (its class only) and the run
// exits 2. Without this, Node prints the message and stack, and a message can quote poem text.
function installUncaughtHandler({ exit = (code) => process.exit(code) } = {}) {
  const handle = (e) => {
    try {
      logEvent('error', 'harness-error', { class: classOf(e) });
    } finally {
      exit(2);
    }
  };
  process.on('uncaughtException', handle);
  process.on('unhandledRejection', handle);
  return handle;
}

module.exports = { logEvent, installUncaughtHandler, classOf, FIELDS, LEVELS };
