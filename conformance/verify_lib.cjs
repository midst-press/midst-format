// Verifying one archive zip, and formatting its result. Kept apart from verify_all.cjs so the rule
// below can be tested with a stand-in converter and fixtures built on the spot.
//
// NOTHING A ROW CARRIES MAY BE POEM TEXT. A row holds an index, counts, lengths, hashes, booleans, an
// exception CLASS and a fixed reason code. Hashes and frame lengths stay in the recorded row; the
// printed line has neither. Never a slice of a frame, never an entry name from inside
// the zip (some are poem titles), never an exception's message (JSON.parse quotes its input). These
// rows are written to VERIFICATION.json and printed, and a workflow publishes the printed lines.
const fs = require('fs'),
  path = require('path'),
  os = require('os'),
  crypto = require('crypto');
const { execFileSync } = require('child_process');
const { textOf } = require('./textexact.cjs');

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

// docs/META.md, written from the spec rather than from the converter, so the two are decorrelated:
// what format C's meta must hold, given format B's.
const META_FIELDS = {
  editorFontFamily: 'fontFamily',
  editorFontSize: 'fontSize',
  editorHighestEverDraftNumber: 'highestDraftNumber',
  editorTitle: 'title',
  editorAuthor: 'author',
};
function expectedMeta(b = {}) {
  const m = {};
  for (const [from, to] of Object.entries(META_FIELDS)) if (from in b) m[to] = b[from];
  if (Array.isArray(b.editorDraftMarkers))
    m.draftMarkers = b.editorDraftMarkers.map((mk) =>
      Object.fromEntries(Object.entries(mk).map(([k, v]) => [k === 'timelineIndex' ? 'index' : k, v])),
    );
  return m;
}
// Key order must not matter, so compare a canonical form. Titles and marker names are poem data: only
// whether the two agree is ever recorded.
const canon = (v) =>
  Array.isArray(v)
    ? `[${v.map(canon).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
          .join(',')}}`
      : JSON.stringify(v);

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
    // Every B file the old editor wrote has a meta object (54 of 54 archived). Without one, the expected
    // meta is {} and a converter that reads the wrong place would pass against it (clement-7074f29f).
    if (!parsed.meta || typeof parsed.meta !== 'object' || Array.isArray(parsed.meta))
      throw new ConformanceError('NO_B_META', Object.keys(parsed).length);
    stage = 'convert';
    const converted = convertMidstFile(old);
    const { text, history, meta } = JSON.parse(converted);
    stage = 'verify';
    // META.md: meta copies B's presentation fields unchanged, and history has one entry per B frame.
    const want = canon(expectedMeta(parsed.meta));
    const metaOk = meta !== undefined && canon(meta) === want;
    const histLenOk = history.length === frames.length;
    // Control: the comparison must be able to fail. Change one copied field and it must disagree.
    const mutated = { ...(meta || {}), fontSize: ((meta && meta.fontSize) || 0) + 1 };
    const metaControl = canon(mutated) !== want;
    // How many fields were compared: a count, not poem data. Zero everywhere would be a vacuous pass.
    const metaFields = Object.keys(expectedMeta(parsed.meta)).length;
    if (history.length > frames.length) throw new ConformanceError('HISTORY_LONGER_THAN_FRAMES', history.length - frames.length);
    let acc = '',
      bad = 0,
      textBad = 0,
      firstBad = null;
    for (let i = 0; i < history.length; i++) {
      acc = step(acc, history[i]);
      const exp = normalise(frames[i].content);
      // Independent of the converter's parse: the characters of the SOURCE frame against the replay.
      if (textOf(acc, { editor: true }) !== textOf(frames[i].content)) textBad++;
      if (acc !== exp) {
        bad++;
        // Lengths and hashes let two local runs be compared. They go to VERIFICATION.json only and are
        // never printed: an unkeyed hash beside an exact length can be brute-forced for a short frame,
        // or confirmed against a guess, and the printed line is published (clement-7074f29f).
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
      textBad,
      firstBad,
      endpointOk: acc === text,
      control,
      metaOk,
      histLenOk,
      metaControl,
      metaFields,
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

const passed = (r) =>
  !r.error && r.trajectoryBad === 0 && r.textBad === 0 && r.endpointOk && r.metaOk && r.histLenOk;

// The printed line. A passing row is named by its archive file, as before. A failing or erroring row
// is named by its index alone, and says only what describeError allows, plus the first bad frame's
// number. firstBad's lengths and hashes are not printed.
function formatRow(r) {
  const id = `#${String(r.index).padStart(2, '0')}`;
  if (r.error) {
    const e = r.error;
    return `ERR  ${id}  stage:${e.stage} class:${e.class}${e.code ? ` code:${e.code}` : ''}${'count' in e ? ` count:${e.count}` : ''}${'exit' in e ? ` exit:${e.exit}` : ''}`;
  }
  const tail = `frames:${String(r.frames).padStart(6)} badFrames:${String(r.trajectoryBad).padStart(6)} textBad:${String(r.textBad).padStart(6)} endpoint:${r.endpointOk ? 'ok' : 'NO'} meta:${r.metaOk ? 'ok' : 'NO'} metaFields:${r.metaFields} histLen:${r.histLenOk ? 'ok' : 'NO'} control:${r.control && r.metaControl} ${String(r.oldMB).padStart(6)}MB->${String(r.newMB).padStart(6)}MB ${String(r.ms).padStart(6)}ms`;
  if (passed(r)) return `PASS ${r.name.padEnd(44)} ${tail}`;
  const fb = r.firstBad;
  return `FAIL ${id.padEnd(44)} ${tail}${fb ? ` firstBad:${fb.i}` : ''}`;
}

// The row as written to VERIFICATION.json: a row that did not pass loses its archive name too.
const recordRow = (r) => {
  if (passed(r)) return r;
  const { name, ...rest } = r;
  return rest;
};

// Totals, and the exit status the run must end with. Non-zero when any poem failed or errored, when a
// control did not fire (that poem's PASS means nothing), or when there was nothing to verify. Without
// this the suite printed FAIL and exited 0, so no CI job or hook could go red (clement-7074f29f).
function summarise(rows) {
  const ok = rows.filter(passed).length;
  const err = rows.filter((r) => r.error).length;
  const bad = rows.length - ok - err;
  const withControl = rows.filter((r) => r.control !== null && r.control !== undefined);
  // A poem's controls fired only if BOTH did: the trajectory corruption and the meta mutation.
  const ctl = withControl.filter((r) => r.control === true && r.metaControl === true).length;
  const ctlN = withControl.length;
  const exitCode = rows.length > 0 && bad === 0 && err === 0 && ctl === ctlN ? 0 : 1;
  const metaFields = rows.reduce((n, r) => n + (r.metaFields || 0), 0);
  return { ok, bad, err, ctl, ctlN, total: rows.length, metaFields, exitCode };
}

module.exports = { verifyZip, formatRow, recordRow, passed, summarise, describeError, ConformanceError, step };
