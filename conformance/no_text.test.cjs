// A poem that FAILS verification must leave no text behind: not in what verify_lib prints, not in
// the rows written to VERIFICATION.json, not on stderr. This builds failing fixtures on the spot, each
// carrying a marker word in one place text could escape from, and searches every output for them.
//
//   npm test
//
// Needs `npm ci` (normalise.cjs uses TipTap) and the `zip` and `unzip` commands. It does NOT need the
// harness built from midst-editor: a stand-in converter is used, because the subject here is what the
// suite reports when something is wrong, not the converter.
//
// The cases run in a child process (no_text_child.cjs) so that everything written to stdout AND
// stderr, by this code or by unzip, is captured and searched. The assertions are Node's `assert`, in
// the order they have always run: the first one that fails names what escaped.
const fs = require('fs'),
  path = require('path'),
  os = require('os'),
  assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');
const { MARK, FRAMES, CASES, zipName } = require('./no_text_cases.cjs');

function noTextOnFailure() {
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
    const run = spawnSync(process.execPath, [path.join(__dirname, 'no_text_child.cjs'), dir], { encoding: 'utf8' });
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
    assert.match(by.mismatch.line, /^FAIL #02 .*badFrames: +1 .* firstBad:1$/);
    assert.match(by['short-frame'].line, /^FAIL #07 .* firstBad:1$/);
    assert.strictEqual(by['long-history'].line, 'ERR  #08  stage:verify class:ConformanceError code:HISTORY_LONGER_THAN_FRAMES count:1');
    assert.strictEqual(by['two-entries'].line, 'ERR  #03  stage:list class:ConformanceError code:ENTRY_COUNT count:2');
    assert.strictEqual(by['not-json'].line, 'ERR  #04  stage:parse class:SyntaxError');
    assert.strictEqual(by['no-frames'].line, 'ERR  #05  stage:parse class:ConformanceError code:NO_FRAMES_ARRAY count:1');
    assert.strictEqual(by['converter-throws'].line, 'ERR  #06  stage:convert class:Error');
    assert.match(by['broken-zip'].line, /^ERR {2}#09 {2}stage:list class:Error exit:\d+$/);
    assert.match(by['meta-dropped'].line, /^FAIL #10 .* meta:NO /);
    assert.ok(has(CASES['meta-dropped'].entries['inner.midst'], MARK.meta), 'control: the meta marker is in the B file');

    // THE EXIT STATUS. A failing run, an unfired control and an empty corpus must all be non-zero.
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'exit.json'), 'utf8')), [1, 0, 1, 1], 'exit status');

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
    // NO HASH AND NO FRAME LENGTH IS PRINTED. An unkeyed hash beside an exact length can be brute-forced
    // for a short frame or confirmed against a guess, and a marker search cannot see that.
    for (const c of ['mismatch', 'short-frame']) {
      const fb = by[c].row.firstBad;
      assert.match(fb.expSha, /^[0-9a-f]{12}$/, `control: ${c} has a hash in its recorded row`);
      assert.ok(fb.expSha !== fb.gotSha && fb.expLen !== fb.gotLen, `control: ${c}'s recorded hashes and lengths differ`);
      for (const v of [fb.expSha, fb.gotSha]) assert.ok(!has(printed, v), `${c}: a frame hash was printed`);
      assert.ok(!/expLen|gotLen|Sha/.test(by[c].line), `${c}: its printed line names a frame length or hash`);
    }
    for (const c of failing) assert.ok(!/[0-9a-f]{12}/.test(by[c].line), `${c}: its printed line holds something hash-shaped`);
    // And nowhere on stdout or stderr except the one PASS line, which names its archive file.
    const rest = printed.replace(by.passes.line, '');
    for (const [kind, word] of Object.entries(MARK)) assert.ok(!has(rest, word), `the ${kind} marker reached stdout or stderr`);
    assert.strictEqual(run.stderr, '', 'something was written to stderr');
    return { failing: failing.length, markers: Object.keys(MARK).length };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a failing poem leaves no text in any output', () => {
  // Nine failing cases and seven markers were searched; fewer means a case or a marker went missing.
  expect(noTextOnFailure()).toEqual({ failing: 9, markers: 7 });
}, 60000);
