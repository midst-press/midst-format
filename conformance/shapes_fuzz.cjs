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
//   node conformance/shapes_fuzz.cjs [--seed N] [--n COUNT] [--history all|append|edit] [--open [class,...]] [--emit DIR]
// --open adds the primitives whose conversion is a KNOWN open defect (OPEN below): all of them, or the named classes.
// --open-controls runs each open class alone and requires it to FAIL, so the generator can still reach it. Without it every check must
// pass; when a defect is fixed, move its primitive out of OPEN so CI guards it.
// Exit: 0 all pass, 1 a failure, 2 usage or harness error.
const fs = require('fs'),
  os = require('os'),
  path = require('path');
const { execFileSync } = require('child_process');
// Errors are logged as JSONL on stderr (log.cjs, midst-format #38); stdout is the report.
const { logEvent, installUncaughtHandler, reportHarnessError } = require('./log.cjs');
installUncaughtHandler();
const { normalise } = require('./normalise.cjs');
const { textOf } = require('./textexact.cjs');
// Required where used, so a usage error is reported without a built harness or a browser.
const convertMidstFile = (raw) => require('../out/converter.cjs').convertMidstFile(raw);
const openRenderer = () => require('./render_page.cjs').openRenderer();
const comparableEditorLines = (...a) => require('./render_page.cjs').comparableEditorLines(...a);

// Known open defects, each generated only under --open.
const OPEN = {
  divLine: 'midst-editor #15: a <div> line (<div><br></div>, <div>a<br></div>) does not draw the lines the browser did',
  supSub: 'midst-editor #15: <sup> or <sub>, even empty, can make the editor show fewer lines than the browser',
  plainTab: 'midst-editor #17: a plain tab (not in a white-space: pre span) showed as one space in the old app',
};

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const SEED = Number(arg('--seed', Math.floor(Math.random() * 2 ** 31)));
const N = Number(arg('--n', 500));
const openArg = process.argv.includes('--open') ? arg('--open', '') : null;
const OPEN_ON = new Set(openArg === null ? [] : !openArg || openArg.startsWith('--') ? Object.keys(OPEN) : openArg.split(','));
for (const k of OPEN_ON)
  if (!OPEN[k]) (console.log(`unknown open class ${k}; known: ${Object.keys(OPEN)}`), logEvent('error', 'usage'), process.exit(2));
const on = (k) => OPEN_ON.has(k);
const WITH_OPEN = OPEN_ON.size > 0;
const EMIT = arg('--emit', null);
const MODEL = arg('--history', 'all');
// The replay-scroll report and its --pos-known ratchet are retired (midst-format #19): neither the editor's Replay nor
// the website's player reads pos any more. Refused rather than ignored, so a caller relying on it hears it is gone.
if (process.argv.includes('--pos-known')) (console.log('--pos-known is retired: nothing reads pos any more (midst-format #19)'), logEvent('error', 'usage'), process.exit(2));
if (!['all', 'append', 'edit'].includes(MODEL)) (console.log('--history must be all, append or edit'), logEvent('error', 'usage'), process.exit(2));
if (!Number.isInteger(SEED) || !Number.isInteger(N) || N < 1) {
  console.log('usage: shapes_fuzz.cjs [--seed N] [--n COUNT] [--open] [--emit DIR]');
  logEvent('error', 'usage');
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

const clone = (x) => JSON.parse(JSON.stringify(x));

// ---- the document model ---------------------------------------------------------------------------
// line   {kind:'p', kids:[node], trailingBr:bool} | {kind:'blank'} | {kind:'div', kids, trailingBr}
// node   {t:'word',s} {t:'sp',n} {t:'nbsp'} {t:'tabpre'} {t:'tab'} {t:'br'} {t:'mark'} {t:'nl'} {t:'wrap',tag,kids}
const WRAPS = ['em', 'strong', 'i', 'b', 'u', 's', 'span'];
// <font>: contenteditable writes it for colour and size, and a trailing <br> inside it is handled (midst-editor #15).
const MORE_WRAPS = ['font'];
const OPEN_WRAPS = ['sup', 'sub'];
let markId = 0;

function genInline(r, depth) {
  const kinds = ['word', 'word', 'word', 'sp', 'sp', 'nbsp', 'tabpre', 'br', 'mark', 'nl'];
  if (depth < 2) kinds.push('wrap');
  if (on('plainTab')) kinds.push('tab');
  const k = r.pick(kinds);
  if (k === 'word') return { t: 'word', s: Array.from({ length: 1 + r.int(5) }, () => r.pick('abcdefghij'.split(''))).join('') };
  if (k === 'sp') return { t: 'sp', n: 1 + r.int(3) };
  if (k === 'wrap') {
    const tags = on('supSub') ? WRAPS.concat(MORE_WRAPS, OPEN_WRAPS) : WRAPS.concat(MORE_WRAPS);
    return { t: 'wrap', tag: r.pick(tags), kids: genKids(r, depth + 1, 1 + r.int(3)) };
  }
  return { t: k };
}
const genKids = (r, depth, n) => Array.from({ length: n }, () => genInline(r, depth));

// Without --open, no line of an open class: not generated, and not reached by a mutation or a shrink step.
function lineAllowed(l) {
  if (l.kind === 'blank') return true;
  if (!l.kids.length) return false;
  return true;
}
function genLine(r) {
  for (;;) {
    if (r.chance(0.25)) return { kind: 'blank' };
    const l = { kind: on('divLine') && r.chance(0.2) ? 'div' : 'p', kids: genKids(r, 0, 1 + r.int(5)), trailingBr: r.chance(0.3) };
    if (lineAllowed(l)) return l;
  }
}
function genDoc(r) {
  const n = 1 + r.int(5);
  return { lines: Array.from({ length: n }, () => genLine(r)), markFirst: r.chance(0.2) }; // a selection marker outside any paragraph: an open class until midst-editor GitHub #31 fixed it, now generated always
}

// ---- histories: how the document changes between frames -------------------------------------------
// A case is a list of steps {doc, line}: each step is one frame, `line` its lineNumber (the line being edited).
//   append  one whole line typed per frame (part 1's only model)
//   edit    a random walk of insert / delete / edit / type-a-letter / split / join on any line
const appendCase = (d) => ({ steps: d.lines.map((_, i) => ({ doc: { ...d, lines: d.lines.slice(0, i + 1) }, line: i })) });
function wordPaths(kids, p = []) {
  return kids.flatMap((k, j) => (k.t === 'word' ? [p.concat(j)] : k.t === 'wrap' ? wordPaths(k.kids, p.concat(j)) : []));
}
const at = (kids, p) => p.slice(1).reduce((n, j) => n.kids[j], kids[p[0]]);
function mutate(r, d) {
  const c = clone(d),
    L = c.lines,
    k = r.int(L.length),
    out = [];
  const textLine = (i) => L[i] && L[i].kind !== 'blank';
  switch (r.pick(['append', 'insert', 'delete', 'edit', 'edit', 'type', 'type', 'split', 'join'])) {
    case 'append':
      L.push(genLine(r));
      out.push({ doc: c, line: L.length - 1 });
      break;
    case 'insert': {
      const i = r.int(L.length + 1);
      L.splice(i, 0, genLine(r));
      out.push({ doc: c, line: i });
      break;
    }
    case 'delete':
      if (L.length < 2) break;
      L.splice(k, 1);
      out.push({ doc: c, line: Math.max(0, k - 1) });
      break;
    case 'edit': {
      if (!textLine(k)) break;
      const kids = L[k].kids,
        j = r.int(kids.length);
      const op = r.pick(['replace', 'insert', 'remove']);
      if (op === 'replace') kids[j] = genInline(r, 0);
      else if (op === 'insert') kids.splice(j, 0, genInline(r, 0));
      else if (kids.length > 1) kids.splice(j, 1);
      else break;
      out.push({ doc: c, line: k });
      break;
    }
    case 'type': {
      // character by character: one frame per letter, all on line k
      if (!textLine(k)) break;
      const ws = wordPaths(L[k].kids);
      if (!ws.length) break;
      const w = r.pick(ws);
      for (let t = 1 + r.int(4); t > 0; t--) {
        at(L[k].kids, w).s += r.pick('abcdefghij'.split(''));
        out.push({ doc: clone(c), line: k });
      }
      break;
    }
    case 'split': {
      // Enter inside a line: it becomes two, the caret on the second
      if (!textLine(k) || L[k].kind !== 'p' || L[k].kids.length < 2) break;
      const j = 1 + r.int(L[k].kids.length - 1);
      L.splice(k, 1, { ...L[k], kids: L[k].kids.slice(0, j), trailingBr: false }, { ...L[k], kids: L[k].kids.slice(j) });
      out.push({ doc: c, line: k + 1 });
      break;
    }
    case 'join': {
      // Backspace at the start of line k+1
      if (!textLine(k) || !textLine(k + 1) || L[k].kind !== 'p' || L[k + 1].kind !== 'p') break;
      L.splice(k, 2, { kind: 'p', kids: L[k].kids.concat(L[k + 1].kids), trailingBr: L[k + 1].trailingBr });
      out.push({ doc: c, line: k });
      break;
    }
  }
  return out.filter((s) => allowed(s.doc));
}
function genCase(r) {
  const d = genDoc(r);
  if (MODEL === 'append' || (MODEL === 'all' && r.chance(0.3))) return appendCase(d);
  const steps = [{ doc: d, line: d.lines.length - 1 }];
  for (let m = 1 + r.int(6); m > 0; m--) steps.push(...mutate(r, steps[steps.length - 1].doc));
  return { steps };
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
const docHtml = (d) => (d.markFirst ? MARK() : '') + d.lines.map(lineHtml).join('');

// The history the converter sees: one frame per step.
function midstOf(c) {
  markId = 0;
  const frames = c.steps.map((s, i) => ({ content: docHtml(s.doc), lineNumber: String(s.line), timestamp: 1600000000000 + i * 1000 }));
  return { frames, raw: JSON.stringify({ editorTimelineFrames: frames }) };
}

// ---- the checks -------------------------------------------------------------------------------------
const step = (acc, c) => acc.slice(0, c.front) + c.inserted + acc.slice(acc.length - c.end);
async function check(c, R) {
  const { frames, raw } = midstOf(c);
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
      e = comparableEditorLines(b, await R.editorLines(acc), acc);
    if (b !== e) fails.add(e > b ? 'lines-editorMore' : 'lines-editorFewer');
  }
  return [...fails].sort();
}

// ---- shrinking: smallest document that still fails the same way -----------------------------------
function* caseCandidates(c) {
  for (let j = 0; j < c.steps.length; j++) if (c.steps.length > 1) yield { steps: c.steps.filter((_, i) => i !== j) };
  for (let j = 0; j < c.steps.length; j++)
    for (const d of candidates(c.steps[j].doc)) {
      const steps = c.steps.slice();
      steps[j] = { doc: d, line: Math.min(c.steps[j].line, d.lines.length - 1) };
      yield { steps };
    }
}
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
const allowed = (d) => d.lines.length > 0 && d.lines.every(lineAllowed);
async function shrink(c0, sig, R) {
  let best = c0;
  for (let changed = true, rounds = 0; changed && rounds < 200; rounds++) {
    changed = false;
    for (const c of caseCandidates(best)) {
      if (!c.steps.every((s) => allowed(s.doc))) continue;
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
    // `case` is the class's position in OPEN, a number; the line above names it.
    if (!ok) logEvent('error', 'control-not-fired', { seed: SEED, case: Object.keys(OPEN).indexOf(k) });
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
  // A line holding only a plain tab (plainTab, still open, midst-editor #17): zero height in the old app, whose
  // white-space is normal, and one line in the editor, which keeps tabs. (The control used to be a <br> then only a
  // whitespace-only tag, which midst-editor #15 fixed.)
  const bad = { lines: [{ kind: 'p', kids: [{ t: 'word', s: 'a' }], trailingBr: false }, { kind: 'p', kids: [{ t: 'tab' }], trailingBr: false }], markFirst: false };
  const good = { lines: [{ kind: 'p', kids: [{ t: 'word', s: 'a' }], trailingBr: true }, { kind: 'blank' }], markFirst: false };
  const cb = await check(appendCase(bad), R),
    cg = await check(appendCase(good), R);
  if (!cb.length || cg.length) {
    // The checks are inert, so nothing measured after this would mean anything. Exit 2, as for a harness error.
    console.log(`control failed: known-bad [${cb}] plain [${cg}]`);
    logEvent('error', 'control-not-fired', { seed: SEED, count: (cb.length ? 0 : 1) + (cg.length ? 1 : 0) });
    process.exit(2);
  }
  const r = rng(SEED);
  const bySig = new Map();
  let failed = 0;
  for (let k = 0; k < N; k++) {
    const d = genCase(r);
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
    console.log(`\nFAIL [${sig}]  ${v.count} case(s), first #${v.index}; minimal (${frames.length} frame(s)):`);
    logEvent('error', 'case-fail', { seed: SEED, case: v.index, count: v.count });
    for (const f of frames) console.log(`  line ${f.lineNumber}  ${JSON.stringify(f.content)}`);
    if (EMIT) console.log(`  written ${emitFixture(min, `html-shape--fuzz-${sig.replace(/[^a-z]+/g, '-')}-${SEED}`)}`);
  }
  await R.close();
  console.log(`${N - failed} of ${N} cases pass every check   (history model ${MODEL}; seed ${SEED}; re-run with --seed ${SEED})`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  // The message may quote a generated document: the class and code only.
  reportHarnessError(e);
  process.exit(2);
});
