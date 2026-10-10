// Verifying one archive zip, and formatting its result. Kept apart from verify_all.cjs so the rule
// below can be tested with a stand-in converter and fixtures built on the spot.
//
// NOTHING A ROW CARRIES MAY BE POEM TEXT. A row holds an index, counts, lengths, hashes, booleans, an
// exception CLASS and a fixed reason code. Never a slice of a frame, never an entry name from inside
// the zip (some are poem titles), never an exception's message (JSON.parse quotes its input). These
// rows are written to VERIFICATION.json and printed, and a workflow publishes the printed lines.
const fs = require('fs'),
  path = require('path'),
  os = require('os'),
  crypto = require('crypto');
const { execFileSync } = require('child_process');

const step = (i, c) => i.slice(0, c.front) + c.inserted + i.slice(i.length - c.end);
const sha12 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12);

// A failure this suite detects itself. `code` is one of a fixed set; `count` is a number or absent.
class ConformanceError extends Error {
  constructor(code, count) {
    super(code);
    this.code = code;
    this.count = count;
  }
}

// What may be said about a thrown value: where it happened, its class, and for our own errors the
// fixed code and a count. The message is dropped on purpose.
function describeError(e, stage) {
  const d = { stage, class: (e && e.constructor && e.constructor.name) || typeof e };
  if (e instanceof ConformanceError) {
    d.code = e.code;
    if (Number.isInteger(e.count)) d.count = e.count;
  } else if (Number.isInteger(e && e.status)) d.exit = e.status; // a child process's exit status
  return d;
}

// Verify one zip. `index` is its 1-based position in the sorted archive listing, and is how a failing
// poem is named in anything printed. Returns the row; writes the conversion to outDir on success.
function verifyZip(zip, index, { convertMidstFile, normalise, outDir }) {
  const name = path.basename(zip, '.midst.zip');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'midst-'));
  const t0 = Date.now();
  let stage = 'list';
  try {
    // Pick the .midst entry STRUCTURALLY. 9 of 54 zips carry an internal name that differs
    // from the object name -- misspellings, nicknames, NFD accents, a doubled extension.
    // Matching on the object name made those look like missing data.
    const listing = execFileSync('unzip', ['-Z', '-1', zip], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((n) => n.endsWith('.midst') && !n.startsWith('__MACOSX'));
    if (listing.length !== 1) throw new ConformanceError('ENTRY_COUNT', listing.length);
    stage = 'extract';
    // Extract WITHOUT naming the entry: an entry name passed back to unzip as an argument failed on one
    // accented name (archive #39 of 54). Take everything except __MACOSX, then find the file on disk.
    execFileSync('unzip', ['-q', '-j', '-o', zip, '-x', '__MACOSX/*', '-d', tmp], { stdio: 'ignore' });
    const extracted = fs.readdirSync(tmp).filter((n) => n.endsWith('.midst'));
    if (extracted.length !== 1) throw new ConformanceError('EXTRACTED_COUNT', extracted.length);
    stage = 'read';
    const old = fs.readFileSync(path.join(tmp, extracted[0]), 'utf8');
    stage = 'parse';
    const parsed = JSON.parse(old);
    const frames = parsed.editorTimelineFrames;
    if (!Array.isArray(frames)) throw new ConformanceError('NO_FRAMES_ARRAY', Object.keys(parsed).length);
    stage = 'convert';
    const converted = convertMidstFile(old);
    const { text, history } = JSON.parse(converted);
    stage = 'verify';
    let acc = '',
      bad = 0,
      firstBad = null;
    for (let i = 0; i < history.length; i++) {
      acc = step(acc, history[i]);
      const exp = normalise(frames[i].content);
      if (acc !== exp) {
        bad++;
        // Lengths and hashes say that and where it differs, and let two runs be compared. No text.
        if (!firstBad) firstBad = { i, expLen: exp.length, gotLen: acc.length, expSha: sha12(exp), gotSha: sha12(acc) };
      }
    }
    // control, per poem: a mid-history corruption must be detected
    let control = null;
    if (history.length >= 3) {
      const h = JSON.parse(JSON.stringify(history));
      h[Math.max(0, Math.min(h.length - 2, Math.floor(h.length / 2)))].inserted += '\u0001';
      let a2 = '',
        b2 = 0;
      for (let i = 0; i < h.length; i++) {
        a2 = step(a2, h[i]);
        if (a2 !== normalise(frames[i].content)) b2++;
      }
      control = b2 > 0;
    }
    stage = 'write';
    fs.writeFileSync(path.join(outDir, `${name}.converted.midst`), converted);
    return {
      index,
      name,
      frames: frames.length,
      hist: history.length,
      trajectoryBad: bad,
      firstBad,
      endpointOk: acc === text,
      control,
      oldMB: +(old.length / 1048576).toFixed(2),
      newMB: +(converted.length / 1048576).toFixed(3),
      ms: Date.now() - t0,
    };
  } catch (e) {
    return { index, name, error: describeError(e, stage), ms: Date.now() - t0 };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const passed = (r) => !r.error && r.trajectoryBad === 0 && r.endpointOk;

// The printed line. A passing row is named by its archive file, as before. A failing or erroring row
// is named by its index alone, and says only what describeError and firstBad allow.
function formatRow(r) {
  const id = `#${String(r.index).padStart(2, '0')}`;
  if (r.error) {
    const e = r.error;
    return `ERR  ${id}  stage:${e.stage} class:${e.class}${e.code ? ` code:${e.code}` : ''}${'count' in e ? ` count:${e.count}` : ''}${'exit' in e ? ` exit:${e.exit}` : ''}`;
  }
  const tail = `frames:${String(r.frames).padStart(6)} badFrames:${String(r.trajectoryBad).padStart(6)} endpoint:${r.endpointOk ? 'ok' : 'NO'} control:${r.control} ${String(r.oldMB).padStart(6)}MB->${String(r.newMB).padStart(6)}MB ${String(r.ms).padStart(6)}ms`;
  if (passed(r)) return `PASS ${r.name.padEnd(44)} ${tail}`;
  const fb = r.firstBad;
  return `FAIL ${id.padEnd(44)} ${tail}${fb ? ` firstBad:${fb.i} expLen:${fb.expLen} gotLen:${fb.gotLen} expSha:${fb.expSha} gotSha:${fb.gotSha}` : ''}`;
}

// The row as written to VERIFICATION.json: a row that did not pass loses its archive name too.
const recordRow = (r) => {
  if (passed(r)) return r;
  const { name, ...rest } = r;
  return rest;
};

module.exports = { verifyZip, formatRow, recordRow, passed, describeError, ConformanceError, step };
