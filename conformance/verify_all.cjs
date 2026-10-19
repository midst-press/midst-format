const fs = require('fs'),
  path = require('path'),
  os = require('os');
// Errors are logged as JSONL on stderr (log.cjs); stdout is the report. Installed first, so even a failure to
// load the converter is logged by class rather than printed with its message.
const { logEvent, installUncaughtHandler } = require('./log.cjs');
installUncaughtHandler();
// Paths come from the environment. Poem data never lives in this repository.
const CORPUS = process.env.MIDST_CORPUS;
const OUT = process.env.MIDST_OUT || path.join(os.tmpdir(), 'midst-converted');
if (!CORPUS) {
  console.log('MIDST_CORPUS is not set. Point it at a directory of .midst.zip files.');
  logEvent('error', 'corpus-not-set');
  process.exit(2);
}
const {
  verifyZip,
  formatRow,
  recordRow,
  summarise,
  logRow,
  logSummary,
  validateKnown,
  checkKnown,
  knownMark,
  knownExitCode,
  describeError,
} = require('./verify_lib.cjs');
// --known FILE: the expected differences, a ratchet (midst-format #72; verify_lib.cjs says what an entry excuses).
// Read before any poem is converted, so a bad file stops the run at once. Only the file's own fault is said: an
// error's class and code, never its message.
const ki = process.argv.indexOf('--known');
let known = null;
if (ki > 0) {
  try {
    known = validateKnown(JSON.parse(fs.readFileSync(process.argv[ki + 1], 'utf8')));
  } catch (e) {
    const d = describeError(e, 'read');
    console.log(`the known file ${process.argv[ki + 1]} was not usable: ${d.class}${d.code ? ` ${d.code}` : ''}${'count' in d ? ` (entry ${d.count})` : ''}`);
    logEvent('error', 'known-unusable', { class: d.class, ...(d.code ? { code: d.code } : {}), ...('count' in d ? { count: d.count } : {}) });
    process.exit(2);
  }
}
fs.mkdirSync(OUT, { recursive: true });
const zips = [];
(function w(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) w(p);
    else if (e.name.endsWith('.midst.zip')) zips.push(p);
  }
})(CORPUS);
zips.sort();
// Required only when there is a poem to convert, so a missing corpus and an empty one are both reported
// without a built harness (clement-7074f29f).
const { convertMidstFile } = zips.length ? require('../out/converter.cjs') : {};
const { normalise } = zips.length ? require('./normalise.cjs') : {};
const rows = [];
// What is printed and recorded for a poem that fails is an index, counts, hashes and an error class,
// never text. The rule and its reasons are at the top of verify_lib.cjs; no_text.test.cjs holds it.
zips.forEach((zip, i) => {
  const r = verifyZip(zip, i + 1, { convertMidstFile, normalise, outDir: OUT });
  rows.push(r);
  console.log(formatRow(r) + (known ? knownMark(r, known) : ''));
  logRow(r);
});
fs.writeFileSync(
  path.join(OUT, 'VERIFICATION.json'),
  JSON.stringify({ generated: new Date().toISOString(), by: 'violet-14057653', rows: rows.map(recordRow) }, null, 1),
);
const s = summarise(rows);
logSummary(s);
console.log(`\nPASS ${s.ok}   FAIL ${s.bad}   ERROR ${s.err}   of ${s.total}`);
// On its own line: tools/dogfood_corpus.sh in midst-editor anchors a pattern at the end of the PASS line.
console.log(`meta fields compared: ${s.metaFields}`);
console.log(
  `controls fired: ${s.ctl}/${s.ctlN}  (a poem whose control did not fire has an INSENSITIVE check and its PASS means nothing)`,
);
if (known) {
  const k = checkKnown(rows, known);
  for (const id of k.stale) {
    console.log(`STALE known ${id}: no failing poem at that index any more; remove the entry, or say why it moved`);
    logEvent('error', 'known-stale', { index: Number(id.slice(1)) });
  }
  if (k.unexpected) logEvent('error', 'known-unexpected', { count: k.unexpected });
  console.log(`known ${k.known}   unexpected ${k.unexpected}   stale ${k.stale.length}   against ${process.argv[ki + 1]}`);
  process.exit(knownExitCode(s, k));
}
process.exit(s.exitCode);
