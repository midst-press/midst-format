#!/usr/bin/env node
// Deterministic generator of LONG current-format .midst files (midst-editor #34: the text length at which the editor
// and the web player stop coping). It simulates a person typing a public-domain text into Midst, one history entry per
// keystroke, with human gaps, longer pauses, and deletions that are then retyped.
//
// The source text is read from a local cache and is never downloaded here. No poem is read or written.
//
//   node tools/generate_long_midst.mjs --out /path/out.midst [--seed 1] [--fraction 1/4] [--rates tools/long_midst_rates.json]
//                                       [--text /path/clarissa.txt]   (or env MIDST_LONG_TEXT)
//                                       [--set burstCharsPerMinute=280 ...]   override a nominal parameter
//   The text cache is built and verified by tools/fetch_clarissa.mjs (pinned by tools/clarissa_source.json).
//
// FORMAT (midst-editor e2e/fixtures.ts, src/renderer/tracking/utils.ts): `midstVersion: 1\n` then JSON
// {text, history}. `text` is the editor's HTML, one <p> per paragraph. Each history entry is
// {inserted, front, end, t, pos}: the next string is prev.slice(0, front) + inserted + prev.slice(prev.length - end).
// `pos` is the ProseMirror position of the caret after the edit.
//
// WHY ENTRIES CAN BE BUILT ARITHMETICALLY. The simulated typist is always at the end of the document, inside the last
// paragraph, so the previous HTML always ends `...</p>`. Typing a character c (escaped e) turns `X</p>` into
// `Xe</p>`: compareStrings gives front = len(X) = htmlLen - 4, end = 4, inserted = e (the first mismatch is e[0]
// against '<', and e never starts with '<'). A backspace is the reverse. Enter appends `<p></p>`: front = htmlLen,
// end = 0. The first keystroke of the document inserts the whole `<p>c</p>` (front 0, end 0). The tests replay the file
// with the editor's own `step` to prove this, so no whole string is ever diffed here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION_HEADER = 'midstVersion: 1';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
// tools/fetch_clarissa.mjs's default cache.
const DEFAULT_TEXT = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'midst-format', 'clarissa', 'clarissa.txt');
const DEFAULT_RATES = path.join(HERE, 'long_midst_rates.json');
const FLUSH_AT = 1 << 20;

export class UsageError extends Error {}

// Small seeded PRNG: same seed, same sequence.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// What the editor's HTML serialiser writes for a text character. (Whitespace is collapsed to plain spaces before it
// gets here, so no non-breaking space needs an entity.)
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
export const escapeChar = (c) => ESC[c] ?? c;

// "1", "1/2", "1/4", ... -> a number in (0, 1].
export function parseFraction(s) {
  const m = /^(\d+)(?:\/(\d+))?$/.exec(String(s).trim());
  const f = m ? Number(m[1]) / Number(m[2] ?? 1) : NaN;
  if (!(f > 0 && f <= 1)) throw new UsageError(`--fraction must be 1, 1/2, 1/4, ... (a share in (0, 1]); got "${s}"`);
  return f;
}

// Paragraphs from the book's blank-line breaks; hard-wrapped lines are joined with single spaces.
export function paragraphsOf(text) {
  return text
    .split(/\n[ \t]*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
}

// The LEADING paragraphs whose end falls at or before `fraction` of the characters: every level is the true early part
// of the larger one. Always at least one paragraph.
export function leadingParagraphs(paragraphs, fraction) {
  const total = paragraphs.reduce((n, p) => n + p.length, 0);
  const limit = Math.floor(total * fraction);
  const out = [];
  let n = 0;
  for (const p of paragraphs) {
    if (n + p.length > limit && out.length > 0) break;
    out.push(p);
    n += p.length;
  }
  return out;
}

function checkTable(name, q, { from0 = true, positive = true } = {}) {
  const ok = Array.isArray(q) && q.length >= 2 && q.every((r) => Array.isArray(r) && r.length === 2 && r.every(Number.isFinite));
  if (!ok) throw new UsageError(`rates: ${name} must be [[p, value], ...] with at least two points`);
  if (from0 && (q[0][0] !== 0 || q[q.length - 1][0] !== 1)) throw new UsageError(`rates: ${name} must start at p=0 and end at p=1`);
  for (let i = 1; i < q.length; i += 1) {
    if (q[i][0] <= q[i - 1][0] || q[i][1] < q[i - 1][1]) throw new UsageError(`rates: ${name} must increase in p and not decrease in value`);
  }
  if (positive && q[0][1] <= 0) throw new UsageError(`rates: ${name} values must be positive`);
}

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

// The parameter file gives every scalar as {nominal, range, rangeBasis, source} and every table with its source. The
// simulation runs on nominal values; `--set path=value` overrides one (warning if it is outside the stated range).
// Returns the same object with each scalar replaced by its value.
const isScalar = (o) => o && typeof o === 'object' && 'nominal' in o;
export function resolveRates(raw, overrides = {}, warn = () => {}) {
  if (!raw || typeof raw !== 'object') throw new UsageError('rates: not a JSON object');
  const used = new Set();
  const walk = (node, trail) => {
    if (isScalar(node)) {
      const key = trail.join('.');
      if (!(key in overrides)) return node.nominal;
      used.add(key);
      const v = Number(overrides[key]);
      if (!Number.isFinite(v)) throw new UsageError(`--set ${key}: "${overrides[key]}" is not a number`);
      if (Array.isArray(node.range) && (v < node.range[0] || v > node.range[1])) warn(`--set ${key}=${v} is outside the stated range [${node.range}]`);
      return v;
    }
    if (Array.isArray(node) || node === null || typeof node !== 'object') return node;
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, [...trail, k])]));
  };
  const out = walk(raw, []);
  const unknown = Object.keys(overrides).filter((k) => !used.has(k));
  if (unknown.length) throw new UsageError(`--set: no scalar parameter named ${unknown.join(', ')}`);
  return out;
}

// What the simulation does with each (resolved) number:
//   editKindShare.{insertOnly,removeOnly,replace,noop}  share of ALL edits of each kind; sets how often each event is drawn
//   insertedChars.shareExactlyOne                       share of all edits inserting exactly one character
//   insertedChars.multiCharQuantiles                    size of the other inserts (>= 2 characters), [[p, n], ...]
//   deletionRuns.lengthQuantiles                        edits in a run of consecutive remove-only edits
//   deletionRuns.shareRetyped                           share of runs whose next edit is an insert at the same place
//   deletionRuns.removedCharsPerEdit                    characters one remove-only edit takes out (not measured; calibrated)
//   gapMs.quantiles                                     gap before each edit, long tail included
//   burstCharsPerMinute                                 speed of single-character typing in bursts (gaps under 2 s)
//   editsPerFinalChar                                   target for the whole file; the realised value is not forced
export function validateRates(r) {
  const k = r.editKindShare;
  if (!k || ['insertOnly', 'removeOnly', 'replace', 'noop'].some((n) => !(k[n] >= 0))) throw new UsageError('rates: editKindShare needs insertOnly, removeOnly, replace, noop (each >= 0)');
  if (Math.abs(sum({ a: k.insertOnly, b: k.removeOnly, c: k.replace, d: k.noop }) - 1) > 0.01) throw new UsageError('rates: editKindShare must sum to 1');
  const one = r.insertedChars?.shareExactlyOne;
  if (!(one > 0 && one <= k.insertOnly + k.replace)) throw new UsageError('rates: insertedChars.shareExactlyOne must be in (0, insertOnly + replace]');
  checkTable('insertedChars.multiCharQuantiles', r.insertedChars.multiCharQuantiles?.quantiles);
  if (r.insertedChars.multiCharQuantiles.quantiles[0][1] < 2) throw new UsageError('rates: insertedChars.multiCharQuantiles must start at 2 characters or more');
  const d = r.deletionRuns;
  checkTable('deletionRuns.lengthQuantiles', d?.lengthQuantiles?.quantiles);
  if (!(d.shareRetyped >= 0 && d.shareRetyped <= 1)) throw new UsageError('rates: deletionRuns.shareRetyped must be in [0, 1]');
  if (!(d.removedCharsPerEdit >= 1)) throw new UsageError('rates: deletionRuns.removedCharsPerEdit must be >= 1');
  checkTable('gapMs.quantiles', r.gapMs?.quantiles);
  if (!(r.burstCharsPerMinute > 0)) throw new UsageError('rates: burstCharsPerMinute must be positive');
  return r;
}

export const BURST_GAP_MS = 2000; // a gap under this is within a burst of typing (the measurement's definition)

// Single-character typing in bursts runs at `charsPerMinute`, which the gap table alone does not fix. Gaps before a
// plain one-character insert are the table's gaps times a factor, chosen here so that the mean of the gaps that stay
// under BURST_GAP_MS is 60000 / charsPerMinute (the way the speed is measured).
export function burstScaleFor(table, charsPerMinute) {
  const draw = sampler(table);
  const us = Array.from({ length: 20000 }, (_, j) => (j + 0.5) / 20000);
  const meanBurst = (m) => {
    let n = 0;
    let t = 0;
    for (const u of us) {
      const g = draw(u) * m;
      if (g < BURST_GAP_MS) {
        n += 1;
        t += g;
      }
    }
    return t / n;
  };
  const target = 60000 / charsPerMinute;
  let lo = 0.01;
  let hi = 20;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (meanBurst(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Inverse CDF through [[p, value], ...]: linear in log(value), which suits long-tailed quantities.
function sampler(table) {
  return (u) => {
    let i = 1;
    while (i < table.length - 1 && u > table[i][0]) i += 1;
    const [p0, v0] = table[i - 1];
    const [p1, v1] = table[i];
    return v0 * (v1 / v0) ** ((u - p0) / (p1 - p0));
  };
}

// The draw probabilities that give the measured edit-kind shares. Per unit of edits: a run of mean length L produces
// L remove-only edits; after it, with probability shareRetyped the next edit is forced to be an insert (a retype), else
// a no-op edit is emitted (the typist went elsewhere); a rewrite is two replace edits (to different text and back).
export function eventWeights(rates, meanRunLength) {
  const k = rates.editKindShare;
  const rho = rates.deletionRuns.shareRetyped;
  const run = k.removeOnly / meanRunLength;
  const rewrite = k.replace / 2;
  const weights = { type: k.insertOnly - run * rho, run, rewrite, noop: k.noop - run * (1 - rho) };
  if (weights.type < 0 || weights.noop < 0) throw new UsageError('rates: editKindShare is inconsistent with deletionRuns (runs would need more retypes or no-ops than there are edits of that kind)');
  const total = weights.type + weights.run + weights.rewrite + weights.noop;
  return { weights, cum: [weights.type / total, (weights.type + weights.run) / total, (weights.type + weights.run + weights.rewrite) / total] };
}

/**
 * Simulate typing `paragraphs` and hand the file to `write` in chunks.
 *
 * @param {object} o
 * @param {string[]} o.paragraphs Plain-text paragraphs (already cut to the wanted fraction).
 * @param {object} o.rates Validated rates.
 * @param {number} o.seed PRNG seed.
 * @param {number} o.startMs Epoch ms of the first entry.
 * @param {(chunk: string) => void} o.write Receives the file in order.
 * @returns {{chars: number, entries: number}}
 */
export function generate({ paragraphs, rates, seed, startMs, write }) {
  const rnd = mulberry32(seed);
  const gap = sampler(rates.gapMs.quantiles);
  const runLength = sampler(rates.deletionRuns.lengthQuantiles.quantiles);
  const multiChars = sampler(rates.insertedChars.multiCharQuantiles.quantiles);
  const rho = rates.deletionRuns.shareRetyped;
  const pOne = rates.insertedChars.shareExactlyOne / (rates.editKindShare.insertOnly + rates.editKindShare.replace);
  const logQ = rates.deletionRuns.removedCharsPerEdit > 1 ? Math.log(1 - 1 / rates.deletionRuns.removedCharsPerEdit) : 0;
  let meanRun = 0;
  for (let j = 0; j < 10000; j += 1) meanRun += Math.round(runLength((j + 0.5) / 10000));
  const { cum, weights } = eventWeights(rates, meanRun / 10000);
  // The typist must move forward on balance, or the text never finishes: characters typed per draw against characters
  // taken out per draw (a run's edits each take out removedCharsPerEdit; the retyping that follows is typing too).
  let meanMulti = 0;
  for (let j = 0; j < 10000; j += 1) meanMulti += Math.round(multiChars((j + 0.5) / 10000));
  const typedPerType = pOne + (1 - pOne) * (meanMulti / 10000);
  const net = weights.type * typedPerType - weights.run * (meanRun / 10000) * rates.deletionRuns.removedCharsPerEdit;
  if (!(net > 0.02 * (weights.type + weights.run + weights.rewrite + weights.noop))) {
    throw new UsageError('rates: the typist would delete as much as it types, so the text would never be finished (lower removedCharsPerEdit or the remove-only share, or raise the insert sizes)');
  }
  const burstScale = burstScaleFor(rates.gapMs.quantiles, rates.burstCharsPerMinute);

  let buf = '';
  const emit = (str) => {
    buf += str;
    if (buf.length >= FLUSH_AT) {
      write(buf);
      buf = '';
    }
  };

  // The final HTML is known before any keystroke, so `text` (which precedes `history` in the file) streams first.
  let chars = 0;
  emit(`${VERSION_HEADER}\n{"text":"`);
  for (const para of paragraphs) {
    let html = '<p>';
    for (const c of para) html += escapeChar(c);
    html += '</p>';
    emit(JSON.stringify(html).slice(1, -1));
    chars += para.length;
  }
  emit('","history":[');

  let entries = 0;
  let clock = startMs;
  let htmlLen = 0; // length of the HTML string before the next entry
  let base = 1; // ProseMirror position where the current paragraph's content starts
  let inPara = 0; // text length of the current paragraph, in ProseMirror units
  const record = (inserted, front, end, burst = false) => {
    if (entries > 0) clock += Math.max(1, Math.round(gap(rnd()) * (burst ? burstScale : 1)));
    emit(`${entries > 0 ? ',' : ''}{"inserted":${JSON.stringify(inserted)},"front":${front},"end":${end},"t":"${new Date(clock).toISOString()}","pos":${base + inPara}}`);
    entries += 1;
  };
  const escaped = (cs) => cs.map(escapeChar).join('');
  const pmLen = (cs) => cs.reduce((n, c) => n + c.length, 0);
  // Replace the last `removed` characters (an array) with the `put` characters (an array, possibly empty), or append when
  // none is removed. Every edit is at the end of the text, so the tail is always `</p>`.
  const edit = (removed, put) => {
    const out = escaped(removed);
    const inn = escaped(put);
    inPara += pmLen(put) - pmLen(removed);
    if (htmlLen === 0) {
      record(`<p>${inn}</p>`, 0, 0);
      htmlLen = 7 + inn.length;
    } else {
      record(inn, htmlLen - 4 - out.length, 4, removed.length === 0 && put.length === 1);
      htmlLen += inn.length - out.length;
    }
  };
  // Text that differs from `cs` at both ends, so the editor's diff of the swap is exactly this edit.
  const otherThan = (cs, n) => {
    const c = ['·', '§'].find((x) => x !== cs[0] && x !== cs[cs.length - 1]);
    return Array(n).fill(c);
  };
  const insertLength = () => (rnd() < pOne ? 1 : Math.round(multiChars(rnd())));

  paragraphs.forEach((para, k) => {
    if (k > 0) {
      base += inPara + 2;
      inPara = 0;
      record('<p></p>', htmlLen, 0);
      htmlLen += 7;
    }
    const cs = Array.from(para);
    let typed = 0;
    let forceType = false;
    while (typed < cs.length) {
      const u = rnd();
      let kind = forceType || u < cum[0] ? 'type' : u < cum[1] ? 'run' : u < cum[2] ? 'rewrite' : 'noop';
      forceType = false;
      if (entries === 0 || (typed === 0 && (kind === 'run' || kind === 'rewrite'))) kind = 'type';
      if (kind === 'type') {
        const n = Math.min(insertLength(), cs.length - typed);
        edit([], cs.slice(typed, typed + n));
        typed += n;
      } else if (kind === 'noop') {
        record('', htmlLen, 0);
      } else if (kind === 'rewrite') {
        const r = Math.min(insertLength(), typed);
        const orig = cs.slice(typed - r, typed);
        const wrong = otherThan(orig, insertLength());
        edit(orig, wrong);
        edit(wrong, orig);
      } else {
        let left = Math.round(runLength(rnd()));
        while (left > 0 && typed > 0) {
          const take = Math.min(logQ === 0 ? 1 : 1 + Math.floor(Math.log(1 - rnd()) / logQ), typed);
          edit(cs.slice(typed - take, typed), []);
          typed -= take;
          left -= 1;
        }
        if (rnd() < rho) forceType = true;
        else record('', htmlLen, 0);
      }
    }
  });

  emit(']}');
  write(buf);
  return { chars, entries };
}

function parseArgs(argv, env) {
  const a = { text: env.MIDST_LONG_TEXT || DEFAULT_TEXT, rates: DEFAULT_RATES, seed: '1', fraction: '1', out: null, start: '2026-01-01T00:00:00.000Z' };
  const overrides = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'set' && argv[i + 1] !== undefined) {
      const m = /^([\w.]+)=(.+)$/.exec(argv[i + 1]);
      if (!m) throw new UsageError(`--set needs path=value (e.g. burstCharsPerMinute=280); got "${argv[i + 1]}"`);
      overrides[m[1]] = m[2];
    } else if (!argv[i].startsWith('--') || !(key in a) || argv[i + 1] === undefined) {
      throw new UsageError(`unknown or incomplete option "${argv[i]}"`);
    } else {
      a[key] = argv[i + 1];
    }
  }
  if (!a.out) throw new UsageError('--out <path> is required (write outside the repo, e.g. under the cache directory)');
  const seed = Number(a.seed);
  if (!Number.isInteger(seed)) throw new UsageError(`--seed must be an integer; got "${a.seed}"`);
  const startMs = Date.parse(a.start);
  if (Number.isNaN(startMs)) throw new UsageError(`--start must be an ISO time; got "${a.start}"`);
  return { ...a, seed, startMs, overrides, fraction: parseFraction(a.fraction) };
}

export function main(argv, env = process.env, stdout = console.log, stderr = console.error) {
  const a = parseArgs(argv, env);
  const out = path.resolve(a.out);
  if (out === REPO || out.startsWith(REPO + path.sep)) throw new UsageError(`--out ${out} is inside the repository; generated poems never live here`);
  if (!fs.existsSync(a.text)) {
    throw new UsageError(`source text not found at ${a.text}: run "node tools/fetch_clarissa.mjs" once to build the verified cache, or pass --text / MIDST_LONG_TEXT; this tool never downloads`);
  }
  let rates;
  try {
    rates = JSON.parse(fs.readFileSync(a.rates, 'utf8'));
  } catch (e) {
    throw new UsageError(`cannot read rates file ${a.rates}: ${e.message}`);
  }
  rates = validateRates(resolveRates(rates, a.overrides, stderr));
  const paragraphs = leadingParagraphs(paragraphsOf(fs.readFileSync(a.text, 'utf8')), a.fraction);

  const t0 = process.hrtime.bigint();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const fd = fs.openSync(out, 'w');
  let bytes = 0;
  let r;
  try {
    r = generate({
      paragraphs, rates, seed: a.seed, startMs: a.startMs,
      write: (chunk) => {
        bytes += fs.writeSync(fd, chunk);
      },
    });
  } finally {
    fs.closeSync(fd);
  }
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  stdout(`chars=${r.chars} entries=${r.entries} bytes=${bytes} seconds=${secs.toFixed(1)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`generate_long_midst: ${e.message}`);
      process.exit(2);
    }
    throw e;
  }
}
