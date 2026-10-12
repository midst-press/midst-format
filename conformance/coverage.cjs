// How much of midst-editor's converter (src/main/util.ts) do the conformance runs execute?
//
//   node conformance/coverage.cjs [corpus dir]        default: fixtures/synthetic
//
// Runs verify_all.cjs under c8 (V8 coverage) against out/converter.cjs, which build:harness bundles from
// util.ts with a source map, and reports against util.ts. PRINTS NUMBERS AND CODE IDENTIFIERS ONLY:
// verify_all's own output is discarded (on the real archive it names poems), and coverage data holds
// positions and counts, never content. Safe to run on the real corpus; nothing it writes holds poem text.
//
// ONE TRAP, MEASURED: c8 reports util.ts line by line, and counts every line that is NOT in the bundle as
// covered. esbuild drops the exports the converter does not use (the open/save half of util.ts), so the
// raw figure credits code that never ran. This script takes the bundled lines from the source map and
// reports those; lines outside the bundle are reported as NOT covered, because conformance never runs them.
//
// Writes coverage/converter-istanbul.json (istanbul format, corrected the same way) for a merged report.
// Exit: 0, or 1 when a control fails, or 2 on a usage or harness error.
const fs = require('fs'),
  os = require('os'),
  path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BUNDLE_MAP = path.join(ROOT, 'out', 'converter.cjs.map');
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// The 1-based source lines of `source` that have any mapping in a source map (standard base64 VLQ).
function mappedLines(map, sourceIndex) {
  const lines = new Set();
  let src = 0,
    line = 0;
  for (const genLine of map.mappings.split(';')) {
    for (const seg of genLine.split(',')) {
      if (!seg) continue;
      const vals = [];
      let v = 0,
        shift = 0;
      for (const ch of seg) {
        const d = B64.indexOf(ch);
        v |= (d & 31) << shift;
        if (d & 32) shift += 5;
        else {
          vals.push(v & 1 ? -(v >> 1) : v >> 1);
          v = 0;
          shift = 0;
        }
      }
      if (vals.length < 4) continue; // a segment with no source position
      src += vals[1];
      line += vals[2];
      if (src === sourceIndex) lines.add(line + 1);
    }
  }
  return lines;
}

// Run verify_all under c8 over `corpus`; return util.ts's entry from the istanbul JSON.
function run(corpus) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'midst-cov-'));
  try {
    const r = spawnSync(
      process.execPath,
      [
        require.resolve('c8/bin/c8.js'),
        '--allowExternal',
        '--exclude-after-remap',
        '--include',
        '**/src/main/util.ts',
        '--reporter=json',
        `--reports-dir=${path.join(tmp, 'report')}`,
        `--temp-directory=${path.join(tmp, 'v8')}`,
        process.execPath,
        path.join(__dirname, 'verify_all.cjs'),
      ],
      { cwd: ROOT, env: { ...process.env, MIDST_CORPUS: corpus, MIDST_OUT: path.join(tmp, 'out') }, stdio: 'ignore' },
    );
    const file = path.join(tmp, 'report', 'coverage-final.json');
    if (!fs.existsSync(file)) throw new Error(`c8 wrote no report (exit ${r.status})`);
    const all = JSON.parse(fs.readFileSync(file, 'utf8'));
    const key = Object.keys(all).find((k) => k.endsWith(path.join('src', 'main', 'util.ts')));
    if (!key) throw new Error('util.ts is not in the coverage report');
    return { entry: all[key], verifyExit: r.status };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true }); // the conversions are poems: never left behind
  }
}

// c8 gives one statement per source line. hits[line] = count, for bundled lines only.
function lineHits(entry, bundled) {
  const hits = new Map();
  for (const [i, loc] of Object.entries(entry.statementMap)) if (bundled.has(loc.start.line)) hits.set(loc.start.line, entry.s[i]);
  return hits;
}

function main() {
  const corpus = path.resolve(process.argv[2] || path.join(ROOT, 'fixtures', 'synthetic'));
  if (!fs.existsSync(BUNDLE_MAP)) throw new Error('out/converter.cjs.map is missing: run build:harness first');
  const map = JSON.parse(fs.readFileSync(BUNDLE_MAP, 'utf8'));
  const si = map.sources.findIndex((s) => s.endsWith(path.join('src', 'main', 'util.ts')));
  if (si < 0) throw new Error('util.ts is not a source of the bundle');
  const bundled = mappedLines(map, si);

  const { entry, verifyExit } = run(corpus);
  const hits = lineHits(entry, bundled);
  const covered = [...hits.values()].filter((n) => n > 0).length;
  const uncovered = [...hits].filter(([, n]) => n === 0).map(([l]) => l);
  const fileLines = Object.keys(entry.statementMap).length;
  const br = Object.values(entry.b).flat();
  const fns = Object.entries(entry.fnMap).map(([i, f]) => [f.name, entry.f[i]]);
  const source = fs.readFileSync(entry.path, 'utf8');
  const exported = [...source.matchAll(/^export const (\w+)/gm)].map((m) => m[1]);
  const inBundle = new Set(fns.map(([n]) => n));
  const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : 'n/a');

  console.log(`corpus: ${path.relative(ROOT, corpus) || corpus}   verify_all exit ${verifyExit}`);
  console.log(`util.ts, the part bundled into the converter: lines ${covered} of ${hits.size} (${pct(covered, hits.size)}%)`);
  console.log(`  branches ${br.filter((n) => n > 0).length} of ${br.length} (${pct(br.filter((n) => n > 0).length, br.length)}%)   functions ${fns.filter(([, n]) => n > 0).length} of ${fns.length}`);
  console.log(`  uncovered lines: ${uncovered.join(', ') || 'none'}`);
  console.log(`util.ts as a whole: lines ${covered} of ${fileLines} (${pct(covered, fileLines)}%); ${fileLines - hits.size} lines are not in the bundle and never run here`);
  console.log(`  exports not in the bundle: ${exported.filter((n) => !inBundle.has(n)).join(', ') || 'none'}`);

  // The istanbul JSON, with every line outside the bundle set to 0 hits (c8 had them as covered).
  const fixed = JSON.parse(JSON.stringify(entry));
  for (const [i, loc] of Object.entries(fixed.statementMap)) if (!bundled.has(loc.start.line)) fixed.s[i] = 0;
  fs.mkdirSync(path.join(ROOT, 'coverage'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'coverage', 'converter-istanbul.json'), JSON.stringify({ [fixed.path]: fixed }));
  console.log('wrote coverage/converter-istanbul.json');

  // CONTROLS, on the synthetic corpus: the instrument must be able to say "not covered".
  //   1  the line that copies a draft marker runs only for a poem that has one. With the whole corpus it
  //      is covered; with synthetic--meta (the only fixture with a marker) left out it must be uncovered.
  //   2  a line outside the bundle must never be counted as covered by this script.
  const marker = source.split('\n').findIndex((l) => /index:\s*timelineIndex/.test(l)) + 1;
  if (!marker) throw new Error('control: the draft-marker line was not found in util.ts');
  const synthetic = path.join(ROOT, 'fixtures', 'synthetic');
  const without = fs.mkdtempSync(path.join(os.tmpdir(), 'midst-cov-ctl-'));
  let ok = true;
  try {
    for (const f of fs.readdirSync(synthetic)) if (f !== 'synthetic--meta.midst.zip') fs.copyFileSync(path.join(synthetic, f), path.join(without, f));
    const withAll = lineHits(run(synthetic).entry, bundled).get(marker);
    const withoutMeta = lineHits(run(without).entry, bundled).get(marker);
    const c1 = withAll > 0 && withoutMeta === 0;
    const outside = Object.values(entry.statementMap).find((loc) => !bundled.has(loc.start.line));
    const c2 = !outside || !hits.has(outside.start.line);
    console.log(`control 1 (draft-marker line ${marker}: covered with the marker fixture, uncovered without): ${c1 ? 'holds' : `FAILED (${withAll}, ${withoutMeta})`}`);
    console.log(`control 2 (a line outside the bundle is not counted): ${c2 ? 'holds' : 'FAILED'}`);
    ok = c1 && c2;
  } finally {
    fs.rmSync(without, { recursive: true, force: true });
  }
  process.exit(ok ? 0 : 1);
}
try {
  main();
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
