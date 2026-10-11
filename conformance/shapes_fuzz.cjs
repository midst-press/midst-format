// Seeded generator of whitespace and structure shapes (issue #16, part 1).
//
// Composes documents from the HTML primitives the old app is known to write, with INVENTED letters only,
// turns each into a typing history (one frame per line typed), runs it through the real converter, and
// checks every frame three ways:
//   text        textOf(replay) === textOf(source frame)             (textexact.cjs, independent of the parse)
//   trajectory  replay === normalise(source frame)                  (normalise.cjs mirrors the converter)
//   lines       visible lines in a browser === lines in TipTap      (render_page.cjs, rendered not modelled)
// A failing document is shrunk to a minimal one, which is printed (it contains no poem text, by construction)
// and, with --emit DIR, written as a fixture.
//
//   node conformance/shapes_fuzz.cjs [--seed N] [--n COUNT] [--open [class,...]] [--emit DIR]
// --open adds the primitives whose conversion is a KNOWN open defect (OPEN below): all of them, or the named classes.
// --open-controls runs each open class alone and requires it to FAIL, so the generator can still reach it. Without it every check must
// pass; when a defect is fixed, move its primitive out of OPEN so CI guards it.
// Exit: 0 all pass, 1 a failure, 2 usage or harness error.
const fs = require('fs'),
  os = require('os'),
  path = require('path');
const { execFileSync } = require('child_process');
const { convertMidstFile } = require('../out/converter.cjs');
const { normalise } = require('./normalise.cjs');
const { textOf } = require('./textexact.cjs');
const { openRenderer } = require('./render_page.cjs');

// Known open defects, each generated only under --open.
const OPEN = {
  font: 'midst-editor #15: a trailing <br> inside <font>/<sup>/<sub> still doubles',
  divLine: 'midst-editor #15: a non-empty <div>a<br></div> still doubles',
  plainTab: 'midst-editor #17: a plain tab (not in a white-space: pre span) showed as one space in the old app',
  markOutside: 'midst-editor #15: a selection-marker span outside any paragraph becomes its own paragraph',
  hiddenAfterBr: 'midst-editor #15: a <br> followed only by invisible inline content (a selection marker, an empty or whitespace-only tag) is not drawn by a browser, but the converter keeps it',
  emptyLine: 'midst-editor #15: a paragraph with nothing visible (spaces, newlines, hidden markers) is zero height in a browser, one line in the editor',
};

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const SEED = Number(arg('--seed', Math.floor(Math.random() * 2 ** 31)));
const N = Number(arg('--n', 500));
const openArg = process.argv.includes('--open') ? arg('--open', '') : null;
const OPEN_ON = new Set(openArg === null ? [] : !openArg || openArg.startsWith('--') ? Object.keys(OPEN) : openArg.split(','));
for (const k of OPEN_ON) if (!OPEN[k]) (console.error(`unknown open class ${k}; known: ${Object.keys(OPEN)}`), process.exit(2));
const on = (k) => OPEN_ON.has(k);
const WITH_OPEN = OPEN_ON.size > 0;
const EMIT = arg('--emit', null);
if (!Number.isInteger(SEED) || !Number.isInteger(N) || N < 1) {
  console.error('usage: shapes_fuzz.cjs [--seed N] [--n COUNT] [--open] [--emit DIR]');
  process.exit(2);
}

// mulberry32: small, seedable, the same sequence on every platform.
function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n) => Math.floor(next() * n);
  return { int, pick: (xs) => xs[int(xs.length)], chance: (p) => next() < p };
}

// ---- the document model ---------------------------------------------------------------------------
// line   {kind:'p', kids:[node], trailingBr:bool} | {kind:'blank'} | {kind:'div', kids, trailingBr}
// node   {t:'word',s} {t:'sp',n} {t:'nbsp'} {t:'tabpre'} {t:'tab'} {t:'br'} {t:'mark'} {t:'nl'} {t:'wrap',tag,kids}
const WRAPS = ['em', 'strong', 'i', 'b', 'u', 's', 'span'];
const OPEN_WRAPS = ['font', 'sup', 'sub'];
let markId = 0;

function genInline(r, depth) {
  const kinds = ['word', 'word', 'word', 'sp', 'sp', 'nbsp', 'tabpre', 'br', 'mark', 'nl'];
  if (depth < 2) kinds.push('wrap');
  if (on('plainTab')) kinds.push('tab');
  const k = r.pick(kinds);
  if (k === 'word') return { t: 'word', s: Array.from({ length: 1 + r.int(5) }, () => r.pick('abcdefghij'.split(''))).join('') };
  if (k === 'sp') return { t: 'sp', n: 1 + r.int(3) };
  if (k === 'wrap') {
    const tags = on('font') ? WRAPS.concat(OPEN_WRAPS) : WRAPS;
    return { t: 'wrap', tag: r.pick(tags), kids: genKids(r, depth + 1, 1 + r.int(3)) };
  }
  return { t: k };
}
const genKids = (r, depth, n) => Array.from({ length: n }, () => genInline(r, depth));

// Nothing a browser draws a line box for: spaces and newlines collapse, a selection marker is display: none.
const invisible = (kids) => kids.every((k) => ['sp', 'nl', 'mark'].includes(k.t) || (k.t === 'wrap' && invisible(k.kids)));
// A <br> followed, to the end of the line, only by invisible inline content (a marker, or a tag holding nothing
// visible) is a trailing break the converter cannot see. Spaces alone are fine: its rule allows them.
function brThenHidden(kids) {
  const flat = [];
  (function f(ks) {
    for (const k of ks) {
      if (k.t === 'wrap') flat.push('wrap'), f(k.kids);
      else flat.push(k.t);
    }
  })(kids);
  const tail = flat.slice(flat.lastIndexOf('br') + 1);
  return flat.includes('br') && tail.every((t) => ['mark', 'sp', 'nl', 'wrap'].includes(t)) && tail.some((t) => t === 'mark' || t === 'wrap');
}
function genDoc(r) {
  const lines = [];
  const n = 1 + r.int(5);
  while (lines.length < n) {
    if (r.chance(0.25)) {
      lines.push({ kind: 'blank' });
      continue;
    }
    const l = { kind: on('divLine') && r.chance(0.2) ? 'div' : 'p', kids: genKids(r, 0, 1 + r.int(5)), trailingBr: r.chance(0.3) };
    if (!on('emptyLine') && !l.trailingBr && invisible(l.kids)) continue; // OPEN.emptyLine
    if (!on('hiddenAfterBr') && brThenHidden(l.kids)) continue; // OPEN.hiddenAfterBr
    lines.push(l);
  }
  return { lines, markFirst: on('markOutside') && r.chance(0.2) }; // OPEN.markOutside
}

const MARK = () =>
  `<span id="selectionBoundary_1_${++markId}" class="rangySelectionBoundary" style="line-height: 0; display: none;">﻿</span>`;
function nodeHtml(x) {
  switch (x.t) {
    case 'word':
      return x.s;
    case 'sp':
      return ' '.repeat(x.n);
    case 'nbsp':
      return '&nbsp;';
    case 'tabpre':
      return '<span style="white-space: pre;">\t</span>';
    case 'tab':
      return '\t';
    case 'br':
      return '<br>';
    case 'nl':
      return '\n';
    case 'mark':
      return MARK();
    case 'wrap':
      return `<${x.tag}>${x.kids.map(nodeHtml).join('')}</${x.tag}>`;
  }
  throw new Error(`unknown node ${x.t}`);
}
// A trailing <br> goes inside the innermost last wrapper when there is one, as contenteditable writes it.
function kidsHtml(kids, trailingBr) {
  if (!trailingBr) return kids.map(nodeHtml).join('');
  const last = kids[kids.length - 1];
  if (last && last.t === 'wrap') return kids.slice(0, -1).map(nodeHtml).join('') + `<${last.tag}>${kidsHtml(last.kids, true)}</${last.tag}>`;
  return kids.map(nodeHtml).join('') + '<br>';
}
function lineHtml(l, i) {
  if (l.kind === 'blank') return `<p data-line-number="${i}"><br></p>`;
  return `<${l.kind} data-line-number="${i}">${kidsHtml(l.kids, l.trailingBr)}</${l.kind}>`;
}
const docHtml = (d, upTo) => (d.markFirst ? MARK() : '') + d.lines.slice(0, upTo).map(lineHtml).join('');

// One frame per line typed: the history the converter sees.
function midstOf(d) {
  markId = 0;
  const frames = d.lines.map((_, i) => ({ content: docHtml(d, i + 1), lineNumber: String(i), timestamp: 1600000000000 + i * 1000 }));
  return { frames, raw: JSON.stringify({ editorTimelineFrames: frames }) };
}

// ---- the checks -------------------------------------------------------------------------------------
const step = (acc, c) => acc.slice(0, c.front) + c.inserted + acc.slice(acc.length - c.end);
async function check(d, R) {
  const { frames, raw } = midstOf(d);
  let history;
  try {
    history = JSON.parse(convertMidstFile(raw)).history;
  } catch (e) {
    return ['convert-throws'];
  }
  if (history.length !== frames.length) return ['history-length'];
  const fails = new Set();
  let acc = '';
  for (let i = 0; i < frames.length; i++) {
    acc = step(acc, history[i]);
    const src = frames[i].content;
    if (textOf(acc, { editor: true }) !== textOf(src)) fails.add('text');
    if (acc !== normalise(src)) fails.add('trajectory');
    const b = await R.browserLines(src),
      e = await R.editorLines(acc);
    if (b !== e) fails.add(e > b ? 'lines-editorMore' : 'lines-editorFewer');
  }
  return [...fails].sort();
}

// ---- shrinking: smallest document that still fails the same way -----------------------------------
const clone = (x) => JSON.parse(JSON.stringify(x));
function* candidates(d) {
  for (let i = 0; i < d.lines.length; i++) if (d.lines.length > 1) yield { ...clone(d), lines: d.lines.filter((_, j) => j !== i) };
  if (d.markFirst) yield { ...clone(d), markFirst: false };
  for (let i = 0; i < d.lines.length; i++) {
    const l = d.lines[i];
    if (l.kind === 'blank') continue;
    if (l.trailingBr) {
      const c = clone(d);
      c.lines[i].trailingBr = false;
      yield c;
    }
    if (l.kind === 'div') {
      const c = clone(d);
      c.lines[i].kind = 'p';
      yield c;
    }
    // every node position, recursively: remove it, unwrap it, or shorten a word
    const paths = [];
    (function walk(kids, p) {
      kids.forEach((k, j) => {
        paths.push(p.concat(j));
        if (k.t === 'wrap') walk(k.kids, p.concat(j));
      });
    })(l.kids, []);
    for (const p of paths) {
      for (const op of ['remove', 'unwrap', 'shorten']) {
        const c = clone(d);
        let parent = c.lines[i].kids;
        for (const j of p.slice(0, -1)) parent = parent[j].kids;
        const j = p[p.length - 1],
          node = parent[j];
        if (op === 'remove' && (parent.length > 1 || p.length > 1)) parent.splice(j, 1);
        else if (op === 'unwrap' && node.t === 'wrap') parent.splice(j, 1, ...node.kids);
        else if (op === 'shorten' && ((node.t === 'word' && node.s.length > 1) || (node.t === 'sp' && node.n > 1))) {
          if (node.t === 'word') node.s = 'a';
          else node.n = 1;
        } else continue;
        yield c;
      }
    }
  }
}
// Without --open, a shrink step may not produce an open-class line, or the minimal case would blame a known defect.
const allowed = (d) =>
  d.lines.every(
    (l) => l.kind === 'blank' || ((on('emptyLine') || l.trailingBr || !invisible(l.kids)) && (on('hiddenAfterBr') || !brThenHidden(l.kids))),
  );
async function shrink(d, sig, R) {
  let best = d;
  for (let changed = true, rounds = 0; changed && rounds < 200; rounds++) {
    changed = false;
    for (const c of candidates(best)) {
      if (!allowed(c)) continue;
      if ((await check(c, R)).join() === sig) {
        best = c;
        changed = true;
        break;
      }
    }
  }
  return best;
}

function emitFixture(d, name) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuzz-'));
  const midst = path.join(tmp, `${name}.midst`);
  fs.writeFileSync(midst, midstOf(d).raw);
  fs.mkdirSync(EMIT, { recursive: true });
  const out = path.resolve(EMIT, `${name}.midst.zip`);
  execFileSync('zip', ['-q', '-j', '-X', out, midst]);
  fs.rmSync(tmp, { recursive: true, force: true });
  return out;
}

// Each open class alone must make documents fail: otherwise the generator no longer reaches it, and moving it
// out of OPEN later would guard nothing.
function openControls() {
  const { spawnSync } = require('child_process');
  let inert = 0;
  for (const k of Object.keys(OPEN)) {
    const r = spawnSync(process.execPath, [__filename, '--seed', String(SEED), '--n', String(N), '--open', k], { encoding: 'utf8' });
    const ok = r.status === 1;
    if (!ok) inert++;
    console.log(`${ok ? 'fires' : 'INERT'}  ${k.padEnd(14)} exit ${r.status}`);
  }
  console.log(`\n${Object.keys(OPEN).length - inert} of ${Object.keys(OPEN).length} open classes fail when generated alone (seed ${SEED}, ${N} documents)`);
  process.exit(inert ? 1 : 0);
}

async function main() {
  if (process.argv.includes('--open-controls')) return openControls();
  console.log(`seed ${SEED}   documents ${N}   open classes: ${WITH_OPEN ? [...OPEN_ON].join(', ') : 'none'}`);
  for (const k of OPEN_ON) console.log(`  open: ${k}  ${OPEN[k]}`);
  const R = await openRenderer();
  // Controls: a document of a known open class must FAIL and a plain one must PASS, or the checks are inert.
  const bad = { lines: [{ kind: 'p', kids: [{ t: 'br' }, { t: 'mark' }], trailingBr: false }], markFirst: false };
  const good = { lines: [{ kind: 'p', kids: [{ t: 'word', s: 'a' }], trailingBr: true }, { kind: 'blank' }], markFirst: false };
  const cb = await check(bad, R),
    cg = await check(good, R);
  if (!cb.length || cg.length) throw new Error(`control failed: known-bad [${cb}] plain [${cg}]`);
  const r = rng(SEED);
  const bySig = new Map();
  let failed = 0;
  for (let k = 0; k < N; k++) {
    const d = genDoc(r);
    const f = await check(d, R);
    if (!f.length) continue;
    failed++;
    const sig = f.join();
    if (!bySig.has(sig)) bySig.set(sig, { count: 0, doc: d, index: k });
    bySig.get(sig).count++;
  }
  for (const [sig, v] of bySig) {
    const min = await shrink(v.doc, sig, R);
    const { frames } = midstOf(min);
    console.log(`\nFAIL [${sig}]  ${v.count} document(s), first #${v.index}; minimal (${frames.length} frame(s)):`);
    console.log(`  ${JSON.stringify(frames[frames.length - 1].content)}`);
    if (EMIT) console.log(`  written ${emitFixture(min, `html-shape--fuzz-${sig.replace(/[^a-z]+/g, '-')}-${SEED}`)}`);
  }
  await R.close();
  console.log(`\n${N - failed} of ${N} documents pass every check   (seed ${SEED}; re-run with --seed ${SEED})`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(2);
});
