#!/usr/bin/env node
// Aggregate typing-behaviour measurements over a corpus of *.midst.zip files.
// Prints ONE JSON object of aggregates. Never prints text, names, titles, paths
// or per-file error messages: failures are only counted.
//
// Usage: node tools/measure_typing_rates.mjs <corpus-dir>

import { readdirSync, statSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Common prefix/suffix diff, as the editor does it. */
export function diffFrames(a, b) {
  const min = Math.min(a.length, b.length);
  let front = 0;
  while (front < min && a.charCodeAt(front) === b.charCodeAt(front)) front++;
  let end = 0;
  while (end < min - front && a.charCodeAt(a.length - 1 - end) === b.charCodeAt(b.length - 1 - end)) end++;
  return { front, end, removed: a.length - front - end, inserted: b.length - front - end };
}

export function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function quantiles(values, qs) {
  const s = Float64Array.from(values).sort();
  const out = { n: s.length };
  for (const q of qs) out[`p${Math.round(q * 100)}`] = quantile(s, q);
  return out;
}

export const BIG_EDIT_CHARS = 1000;
export const MIDST_VERSION_HEADER = "midstVersion: 1";

function newAcc() {
  return {
    edits: 0, insertedSum: 0, removedSum: 0, insertedOne: 0, noops: 0,
    insertOnly: 0, removeOnly: 0, replace: 0, nonPositiveGaps: 0, negativeGaps: 0, burstN: 0, burstMs: 0, burstAnyN: 0, burstAnyMs: 0,
    delRuns: 0, delRunsRetyped: 0, delRunLengths: [], insertedPerEdit: [], gaps: [],
  };
}

const SUM_KEYS = ["edits", "insertedSum", "removedSum", "insertedOne", "noops", "insertOnly", "removeOnly", "replace", "nonPositiveGaps", "negativeGaps", "burstN", "burstMs", "burstAnyN", "burstAnyMs", "delRuns", "delRunsRetyped"];
const LIST_KEYS = ["delRunLengths", "insertedPerEdit", "gaps"];

function mergeAcc(into, from) {
  for (const k of SUM_KEYS) into[k] += from[k];
  for (const k of LIST_KEYS) for (const v of from[k]) into[k].push(v);
}

/** Per-poem state for one accumulator: the open deletion run. */
function newRun() { return { len: 0, lastFront: -1 }; }

function closeRun(acc, run, next) {
  if (run.len > 0) {
    acc.delRunLengths.push(run.len);
    acc.delRuns++;
    if (next && next.inserted > 0 && next.front === run.lastFront) acc.delRunsRetyped++;
  }
  run.len = 0;
}

function addEdit(acc, run, e, gap) {
  if (gap !== null) {
    if (gap > 0) acc.gaps.push(gap);
    else {
      acc.nonPositiveGaps++;
      if (gap < 0) acc.negativeGaps++;
    }
  }
  if (gap !== null && gap > 0 && gap < 2000 && e.inserted === 1) {
    acc.burstAnyN++;
    acc.burstAnyMs += gap;
    if (e.removed === 0) {
      acc.burstN++;
      acc.burstMs += gap;
    }
  }
  acc.edits++;
  acc.insertedSum += e.inserted;
  acc.removedSum += e.removed;
  acc.insertedPerEdit.push(e.inserted);
  if (e.inserted === 1) acc.insertedOne++;
  if (e.removed === 0 && e.inserted === 0) acc.noops++;
  else if (e.removed === 0) acc.insertOnly++;
  else if (e.inserted === 0) acc.removeOnly++;
  else acc.replace++;
  if (e.removed > 0 && e.inserted === 0) {
    run.len++;
    run.lastFront = e.front;
  } else {
    closeRun(acc, run, e);
  }
}

/**
 * Feed a sequence of edits ({front, removed, inserted, ts}) into the "all" and "typing" accumulators.
 * "typing" leaves out whole-document rewrites (inserted or removed > BIG_EDIT_CHARS) and their gaps.
 * Returns the number of big edits.
 */
export function analyseEdits(edits, all, typing) {
  const runAll = newRun();
  const runTyping = newRun();
  let prevTs = edits.length > 0 && Number.isFinite(edits[0].baseTs) ? edits[0].baseTs : null;
  let big = 0;
  for (const e of edits) {
    const gap = prevTs !== null && Number.isFinite(e.ts) ? e.ts - prevTs : null;
    if (Number.isFinite(e.ts)) prevTs = e.ts;
    addEdit(all, runAll, e, gap);
    if (e.inserted > BIG_EDIT_CHARS || e.removed > BIG_EDIT_CHARS) {
      big++;
      closeRun(typing, runTyping, null);
    } else {
      addEdit(typing, runTyping, e, gap);
    }
  }
  closeRun(all, runAll, null);
  closeRun(typing, runTyping, null);
  return big;
}

/** Format B: edits from consecutive whole-document frames. Returns {edits, finalLen}. */
export function editsFromFrames(frames) {
  const edits = [];
  let prev = null;
  let baseTs = NaN;
  for (const f of frames) {
    const content = typeof f?.content === "string" ? f.content : "";
    const t = Number(f?.timestamp);
    if (prev === null) baseTs = t;
    else {
      const d = diffFrames(prev, content);
      // baseTs (the first frame's time) lets the first edit have a gap, as every later edit does.
      edits.push({ front: d.front, removed: d.removed, inserted: d.inserted, ts: t, ...(edits.length === 0 ? { baseTs } : {}) });
    }
    prev = content;
  }
  return { edits, finalLen: prev === null ? 0 : prev.length, lengthMismatch: false };
}

/** Format C: edits from already-diffed history entries {front, inserted, end, t, pos}. */
export function editsFromHistory(history, text) {
  const edits = [];
  let len = 0;
  let bad = false;
  for (const h of history) {
    const ins = typeof h.inserted === "string" ? h.inserted.length : 0;
    const removed = len - h.front - h.end;
    if (!(removed >= 0)) bad = true;
    const r = Math.max(0, removed);
    const t = typeof h.t === "number" ? h.t : Date.parse(h.t);
    edits.push({ front: h.front, removed: r, inserted: ins, ts: t });
    len = len - r + ins;
  }
  const finalLen = typeof text === "string" ? text.length : len;
  return { edits, finalLen, lengthMismatch: bad || (typeof text === "string" && len !== text.length) };
}

class Failure extends Error {
  constructor(kind) { super(kind); this.kind = kind; }
}

/** Recursively collect candidate files; other extensions are counted, never named. */
export function findFiles(dir, out) {
  // An unreadable directory is counted, never thrown: the error text would carry a path from the real archive.
  let names;
  try { names = readdirSync(dir); } catch { out.unreadableDirs++; return out; }
  for (const name of names) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { out.other++; continue; }
    if (st.isDirectory()) findFiles(p, out);
    else if (name.endsWith(".midst.zip")) out.zips.push(p);
    else if (name.endsWith(".midst")) out.plain.push(p);
    else out.other++;
  }
  return out;
}

function unzipFailure(err) {
  if (err && typeof err.status === "number") return `unzip_exit_${err.status}`;
  if (err && err.code === "ENOBUFS") return "unzip_output_too_large";
  if (err && err.code) return `unzip_${err.code}`;
  return "unzip_other";
}

function parseC(buf) {
  const text = buf.toString("utf8");
  const nl = text.indexOf("\n");
  const header = (nl < 0 ? text : text.slice(0, nl)).replace(/\r$/, "");
  let body;
  let headerless = false;
  if (header.startsWith("midstVersion:")) {
    if (header !== MIDST_VERSION_HEADER) throw new Failure("c_unsupported_version");
    body = nl < 0 ? "" : text.slice(nl + 1);
  } else {
    // No version header: accept a bare JSON object that has a history array (format B has none).
    headerless = true;
    body = text;
  }
  let j;
  try { j = JSON.parse(body); } catch { if (headerless) return null; throw new Failure("c_json_parse_error"); }
  if (!j || !Array.isArray(j.history)) {
    if (headerless) return null;
    throw new Failure("c_no_history");
  }
  j.headerless = headerless;
  return j;
}

/** Returns {edits, finalLen, lengthMismatch, frames} or null when the content is no known format. Throws Failure. */
function readOne(path, isZip) {
  let buffers;
  if (isZip) {
    let list;
    try {
      list = execFileSync("unzip", ["-Z1", path], { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] })
        .split("\n").filter((n) => n && !n.endsWith("/"));
    } catch (err) { throw new Failure(unzipFailure(err)); }
    buffers = [];
    for (const entry of list) {
      try {
        buffers.push(execFileSync("unzip", ["-p", path, entry], { maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"] }));
      } catch (err) { throw new Failure(unzipFailure(err)); }
    }
    if (buffers.length === 0) throw new Failure("zip_empty");
  } else {
    try { buffers = [readFileSync(path)]; } catch (err) { throw new Failure(`read_${err?.code ?? "error"}`); }
  }
  let sawJsonParseError = false;
  for (const raw of buffers) {
    const asC = parseC(raw);
    if (asC) {
      const r = editsFromHistory(asC.history, asC.text);
      return { ...r, frames: asC.history.length + 0, format: asC.headerless ? "C_no_header" : "C" };
    }
    let j;
    try { j = JSON.parse(raw.toString("utf8")); } catch { sawJsonParseError = true; continue; }
    if (j && Array.isArray(j.editorTimelineFrames)) {
      const r = editsFromFrames(j.editorTimelineFrames);
      return { ...r, frames: j.editorTimelineFrames.length, format: "B" };
    }
  }
  if (sawJsonParseError) throw new Failure("json_parse_error");
  return null;
}

function bump(map, k) { map[k] = (map[k] ?? 0) + 1; }

function summarise(t, totalFinalChars, perPoem) {
  const e = t.edits || 1;
  const gaps = t.gaps;
  const gshare = (ms) => (gaps.length ? gaps.filter((g) => g > ms).length / gaps.length : null);
  return {
    totalEdits: t.edits,
    editsPerFinalChar: {
      corpus: totalFinalChars ? t.edits / totalFinalChars : null,
      acrossPoems: quantiles(perPoem, [0.1, 0.5, 0.9]),
    },
    editKindShare: { insertOnly: t.insertOnly / e, removeOnly: t.removeOnly / e, replace: t.replace / e, noop: t.noops / e },
    removedToInsertedCharRatio: t.insertedSum ? t.removedSum / t.insertedSum : null,
    totalInsertedChars: t.insertedSum,
    totalRemovedChars: t.removedSum,
    insertedCharsPerEdit: quantiles(t.insertedPerEdit, [0.1, 0.5, 0.9, 0.99]),
    shareEditsInsertedLengthOne: t.insertedOne / e,
    deletionRuns: {
      count: t.delRuns,
      lengthQuantiles: quantiles(t.delRunLengths, [0.1, 0.5, 0.9, 0.99]),
      shareFollowedByInsertAtSamePlace: t.delRuns ? t.delRunsRetyped / t.delRuns : null,
    },
    singleCharBurstTyping: {
      definition: "edits with removed=0 and inserted=1 whose positive gap to the previous edit is under 2 s",
      count: t.burstN,
      charsPerMinute: t.burstMs ? t.burstN / (t.burstMs / 60000) : null,
      anyRemovedVariant: { count: t.burstAnyN, charsPerMinute: t.burstAnyMs ? t.burstAnyN / (t.burstAnyMs / 60000) : null },
    },
    gapMs: {
      positiveCount: gaps.length,
      nonPositiveCount: t.nonPositiveGaps,
      negativeGapsClamped: t.negativeGaps,
      quantiles: quantiles(gaps, [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99]),
      shareOver: { "2s": gshare(2000), "10s": gshare(10000), "60s": gshare(60000), "10min": gshare(600000), "1h": gshare(3600000) },
    },
  };
}

/** Measure a list of {path, isZip}; returns the aggregate result object. Never names a file. */
export function measure(files, otherCount = 0) {
  const all = newAcc();
  const typing = newAcc();
  const perPoemAll = [];
  const perPoemTyping = [];
  const failuresByKind = {};
  const skippedByKind = {};
  const formats = {};
  let read = 0, skipped = otherCount, failed = 0, totalFrames = 0, totalFinalChars = 0, big = 0, lengthMismatchPoems = 0;
  if (otherCount) skippedByKind.non_midst_extension = otherCount;
  for (const f of files) {
    try {
      const r = readOne(f.path, f.isZip);
      if (!r) { skipped++; bump(skippedByKind, "unknown_format"); continue; }
      const pa = newAcc();
      const pt = newAcc();
      big += analyseEdits(r.edits, pa, pt);
      read++;
      bump(formats, r.format);
      if (r.lengthMismatch) lengthMismatchPoems++;
      totalFrames += r.frames;
      totalFinalChars += r.finalLen;
      if (r.finalLen > 0) { perPoemAll.push(pa.edits / r.finalLen); perPoemTyping.push(pt.edits / r.finalLen); }
      mergeAcc(all, pa);
      mergeAcc(typing, pt);
    } catch (err) {
      failed++;
      bump(failuresByKind, err instanceof Failure ? err.kind : "other_error");
    }
  }
  return {
    poems: { filesConsidered: files.length + otherCount, read, skipped, failed, readByFormat: formats },
    failuresByKind,
    skippedByKind,
    lengthMismatchPoems,
    totalFramesOrEntries: totalFrames,
    totalFinalChars,
    wholeDocumentRewrites: { thresholdChars: BIG_EDIT_CHARS, count: big, shareOfEdits: all.edits ? big / all.edits : null },
    all: summarise(all, totalFinalChars, perPoemAll),
    typingOnly: summarise(typing, totalFinalChars, perPoemTyping),
  };
}

function main() {
  const dir = process.argv[2];
  if (!dir) { process.stderr.write("usage: measure_typing_rates.mjs <corpus-dir>\n"); process.exit(2); }
  try { readdirSync(dir); } catch (e) { process.stderr.write(`cannot read the corpus directory you gave (${e.code})\n`); process.exit(2); }
  const found = findFiles(dir, { zips: [], plain: [], other: 0, unreadableDirs: 0 });
  const files = [...found.zips.map((path) => ({ path, isZip: true })), ...found.plain.map((path) => ({ path, isZip: false }))];
  const result = measure(files, found.other);
  result.unreadableDirs = found.unreadableDirs;
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
