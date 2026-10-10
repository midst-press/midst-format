// A poem that FAILS verification must leave no text behind: not in what verify_lib prints, not in
// the rows written to VERIFICATION.json, not on stderr. This builds failing fixtures on the spot, each
// carrying a marker word in one place text could escape from, and searches every output for them.
//
//   node conformance/test_no_text.cjs
//
// Needs `npm ci` (normalise.cjs uses TipTap) and the `zip` and `unzip` commands. It does NOT need the
// harness built from midst-editor: a stand-in converter is used, because the subject here is what the
// suite reports when something is wrong, not the converter.
//
// The cases run in a child process so that everything written to stdout AND stderr, by this code or by
// unzip, is captured and searched.
const fs = require('fs'),
  path = require('path'),
  os = require('os'),
  assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');

const MARK = {
  frame: 'QUIXOTICFRAMEMARK', // in the text of a frame
  json: 'XYLOQUARTZ', // at the start of a file that is not JSON (JSON.parse quotes about ten characters)
  entry: 'ZEPHYRENTRYMARK', // in the name of an entry inside the zip
  key: 'KUMQUATKEYMARK', // in a JSON key of a file with no frames array
  thrown: 'OBSIDIANTHROWNMARK', // in the message of an exception the converter throws
  object: 'JACARANDAOBJECTMARK', // in the zip's own file name
};
const FRAMES = ['<p>a</p>', `<p>a ${MARK.frame}</p>`, `<p>a ${MARK.frame} b</p>`, `<p>a ${MARK.frame} b c</p>`];
const B = (frames) => JSON.stringify({ editorTimelineFrames: frames.map((content, i) => ({ content, lineNumber: '0', timestamp: i })) });

// name -> { entries: {entry name: content}, convert: 'ok' | 'corrupt' | 'throw' }, or raw bytes for a broken zip
const CASES = {
  passes: { entries: { 'inner.midst': B(FRAMES) }, convert: 'ok' },
  mismatch: { entries: { 'inner.midst': B(FRAMES) }, convert: 'corrupt' },
  'two-entries': { entries: { [`${MARK.entry}-one.midst`]: B(FRAMES), [`${MARK.entry}-two.midst`]: B(FRAMES) }, convert: 'ok' },
  'not-json': { entries: { 'inner.midst': `${MARK.json} is not JSON` }, convert: 'ok' },
  'no-frames': { entries: { 'inner.midst': JSON.stringify({ [MARK.key]: [1] }) }, convert: 'ok' },
  'converter-throws': { entries: { 'inner.midst': B(FRAMES) }, convert: 'throw' },
  'broken-zip': { raw: 'this is not a zip archive' },
};
const zipName = (c) => `synthetic--${MARK.object}-${c}.midst.zip`;

function child(dir) {
  const { verifyZip, formatRow, recordRow } = require('./verify_lib.cjs');
  const { normalise } = require('./normalise.cjs');
  // A stand-in converter: each change replaces the whole text with the next frame.
  const converter = (mode) => (old) => {
    if (mode === 'throw') throw new Error(`could not convert near ${MARK.thrown}`);
    const frames = JSON.parse(old).editorTimelineFrames.map((f) => normalise(f.content));
    const history = frames.map((inserted) => ({ front: 0, inserted, end: 0 }));
    const text = frames[frames.length - 1];
    if (mode === 'corrupt') history[1] = { ...history[1], inserted: history[1].inserted + 'X' };
    return JSON.stringify({ text, history });
  };
  const rows = Object.keys(CASES).map((c, i) =>
    verifyZip(path.join(dir, zipName(c)), i + 1, { convertMidstFile: converter(CASES[c].convert), normalise, outDir: path.join(dir, 'out') }),
  );
  rows.forEach((r) => console.log(formatRow(r)));
  fs.writeFileSync(path.join(dir, 'rows.json'), JSON.stringify(rows.map(recordRow)));
}

function parent() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'midst-no-text-'));
  try {
    fs.mkdirSync(path.join(dir, 'out'));
    for (const [c, spec] of Object.entries(CASES)) {
      const zip = path.join(dir, zipName(c));
      if (spec.raw) {
        fs.writeFileSync(zip, spec.raw);
        continue;
      }
      const src = fs.mkdtempSync(path.join(dir, 'src-'));
      for (const [entry, content] of Object.entries(spec.entries)) fs.writeFileSync(path.join(src, entry), content);
      execFileSync('zip', ['-q', '-j', zip, ...Object.keys(spec.entries).map((e) => path.join(src, e))]);
      fs.rmSync(src, { recursive: true });
    }
    const run = spawnSync(process.execPath, [__filename, '--child', dir], { encoding: 'utf8' });
    assert.strictEqual(run.status, 0, `the child run failed with status ${run.status}`);
    const printed = run.stdout + run.stderr;
    const recorded = fs.readFileSync(path.join(dir, 'rows.json'), 'utf8');
    const rows = JSON.parse(recorded);
    const lines = run.stdout.trim().split('\n');
    const by = Object.fromEntries(Object.keys(CASES).map((c, i) => [c, { row: rows[i], line: lines[i] }]));
    const has = (text, word) => text.toLowerCase().includes(word.toLowerCase());

    // CONTROLS. Each marker really is somewhere it could escape from, and the search can find one.
    const { normalise } = require('./normalise.cjs');
    assert.ok(has(normalise(FRAMES[1]).slice(0, 120), MARK.frame), 'control: a 120-character slice of a frame holds the frame marker');
    let parseMessage = '';
    try {
      JSON.parse(CASES['not-json'].entries['inner.midst']);
    } catch (e) {
      parseMessage = String(e.message);
    }
    assert.ok(has(parseMessage, MARK.json), 'control: on this Node, JSON.parse quotes its input in the message');
    const listing = execFileSync('unzip', ['-Z', '-1', path.join(dir, zipName('two-entries'))], { encoding: 'utf8' });
    assert.ok(has(listing, MARK.entry), 'control: the entry marker is in the zip listing');
    assert.ok(has(by.passes.line, MARK.object), 'control: a PASSING row is still named by its archive file, so the search works');

    // Each case failed in the way it was built to.
    assert.match(by.passes.line, /^PASS /);
    assert.match(by.mismatch.line, /^FAIL #02 .*badFrames: +1 .*firstBad:1 expLen:\d+ gotLen:\d+ expSha:[0-9a-f]{12} gotSha:[0-9a-f]{12}$/);
    assert.strictEqual(by['two-entries'].line, 'ERR  #03  stage:list class:ConformanceError code:ENTRY_COUNT count:2');
    assert.strictEqual(by['not-json'].line, 'ERR  #04  stage:parse class:SyntaxError');
    assert.strictEqual(by['no-frames'].line, 'ERR  #05  stage:parse class:ConformanceError code:NO_FRAMES_ARRAY count:1');
    assert.strictEqual(by['converter-throws'].line, 'ERR  #06  stage:convert class:Error');
    assert.match(by['broken-zip'].line, /^ERR {2}#07 {2}stage:list class:Error exit:\d+$/);

    // THE RULE. No marker anywhere in what a failing case printed or recorded.
    const failing = Object.keys(CASES).filter((c) => c !== 'passes');
    for (const c of failing) {
      for (const [where, text] of [
        ['printed line', by[c].line],
        ['recorded row', JSON.stringify(by[c].row)],
      ]) {
        for (const [kind, word] of Object.entries(MARK)) assert.ok(!has(text, word), `${c}: the ${kind} marker is in its ${where}`);
      }
      assert.ok(!('name' in by[c].row), `${c}: its recorded row carries a name`);
    }
    // And nowhere on stdout or stderr except the one PASS line, which names its archive file.
    const rest = printed.replace(by.passes.line, '');
    for (const [kind, word] of Object.entries(MARK)) assert.ok(!has(rest, word), `the ${kind} marker reached stdout or stderr`);
    assert.strictEqual(run.stderr, '', 'something was written to stderr');
    console.log(`no text: ${failing.length} failing cases, ${Object.keys(MARK).length} markers, none in any output; 4 controls held`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--child') child(process.argv[3]);
else parent();
