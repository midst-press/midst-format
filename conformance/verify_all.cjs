const fs = require('fs'),
  path = require('path'),
  os = require('os');
const { convertMidstFile } = require('../out/converter.cjs');
const { normalise } = require('./normalise.cjs');
const { verifyZip, formatRow, recordRow, passed } = require('./verify_lib.cjs');
// Paths come from the environment. Poem data never lives in this repository.
const CORPUS = process.env.MIDST_CORPUS;
const OUT = process.env.MIDST_OUT || path.join(os.tmpdir(), 'midst-converted');
if (!CORPUS) {
  console.error('MIDST_CORPUS is not set. Point it at a directory of .midst.zip files.');
  process.exit(2);
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
const rows = [];
// What is printed and recorded for a poem that fails is an index, counts, hashes and an error class,
// never text. The rule and its reasons are at the top of verify_lib.cjs; test_no_text.cjs holds it.
zips.forEach((zip, i) => {
  const r = verifyZip(zip, i + 1, { convertMidstFile, normalise, outDir: OUT });
  rows.push(r);
  console.log(formatRow(r));
});
fs.writeFileSync(
  path.join(OUT, 'VERIFICATION.json'),
  JSON.stringify({ generated: new Date().toISOString(), by: 'violet-14057653', rows: rows.map(recordRow) }, null, 1),
);
const ok = rows.filter(passed).length;
const bad = rows.filter((r) => !r.error && !passed(r)).length;
const err = rows.filter((r) => r.error).length;
const ctl = rows.filter((r) => r.control === true).length,
  ctlN = rows.filter((r) => r.control !== null && r.control !== undefined).length;
console.log(`\nPASS ${ok}   FAIL ${bad}   ERROR ${err}   of ${rows.length}`);
console.log(
  `controls fired: ${ctl}/${ctlN}  (a poem whose control did not fire has an INSENSITIVE check and its PASS means nothing)`,
);
