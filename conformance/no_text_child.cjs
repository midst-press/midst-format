// The child half of no_text.test.cjs: verifies the fixtures in the given directory and prints one row
// each. It runs as its own process so that everything it writes to stdout AND stderr, and everything
// unzip writes, is captured and searched by the test.
//
//   node conformance/no_text_child.cjs <dir>
const fs = require('fs'),
  path = require('path');
const { MARK, CASES, zipName } = require('./no_text_cases.cjs');

function child(dir) {
  const { verifyZip, formatRow, recordRow, summarise } = require('./verify_lib.cjs');
  const { normalise } = require('./normalise.cjs');
  // A stand-in converter: each change replaces the whole text with the next frame.
  const converter = (mode) => (old) => {
    if (mode === 'throw') throw new Error(`could not convert near ${MARK.thrown}`);
    const frames = JSON.parse(old).editorTimelineFrames.map((f) => normalise(f.content));
    const history = frames.map((inserted) => ({ front: 0, inserted, end: 0 }));
    const text = frames[frames.length - 1];
    if (mode === 'corrupt') history[1] = { ...history[1], inserted: history[1].inserted + 'X' };
    if (mode === 'extra') history.push({ front: 0, inserted: text, end: 0 });
    // The stand-in writes meta as docs/META.md says a converter must; B here has none, so it is empty.
    if (mode === 'nometa') return JSON.stringify({ text, history });
    return JSON.stringify({ text, history, meta: {} });
  };
  const rows = Object.keys(CASES).map((c, i) =>
    verifyZip(path.join(dir, zipName(c)), i + 1, { convertMidstFile: converter(CASES[c].convert), normalise, outDir: path.join(dir, 'out') }),
  );
  rows.forEach((r) => console.log(formatRow(r)));
  fs.writeFileSync(path.join(dir, 'rows.json'), JSON.stringify(rows.map(recordRow)));
  // The exit status, for: every row; the passing row alone; that row with its control unfired; no rows.
  const pass = rows[0];
  const codes = [rows, [pass], [{ ...pass, control: false }], []].map((r) => summarise(r).exitCode);
  fs.writeFileSync(path.join(dir, 'exit.json'), JSON.stringify(codes));
}

child(process.argv[2]);
