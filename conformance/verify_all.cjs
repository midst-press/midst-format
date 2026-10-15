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
const { verifyZip, formatRow, recordRow, summarise, logRow, logSummary } = require('./verify_lib.cjs');
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
  console.log(formatRow(r));
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
process.exit(s.exitCode);
