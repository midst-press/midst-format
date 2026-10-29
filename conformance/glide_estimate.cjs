// How long replay waits for glides, per poem, estimated from the edit history alone (midst-editor #26).
//
//   node conformance/glide_estimate.cjs <corpus dir> [--top N] [--titles FILE]
//
// Counts only: nothing here plays a poem. The method is the one in midst-editor #26's body (violet-14057653,
// 12 Oct), rebuilt because the script that first ran it lived in /private/tmp and was reaped:
//   - each step's place is the first offset it changed (`front`), the place follow.ts glides to;
//   - a jump is the number of paragraphs between two consecutive steps' places, turned into screens at the
//     poem's own font size (meta.fontSize, else the player's 14px), at 1.5 line spacing and one line per
//     paragraph. Wrapped paragraphs make real jumps longer, so every distance is a floor;
//   - a jump over 0.35 of a screen leaves the comfortable band (follow.ts MARGIN 0.15 either side of the
//     centred point), so it glides, for glideMs(distance, 440): the website's 440px view;
//   - playback shows one step every 60ms, and waits while a glide runs.
//
// NO POEM DATA ON STDOUT (midst-format #7, #41). A poem is named by its index in sorted archive order, as
// verify_all.cjs numbers them, and by a hash of its zip. Its title is written only with --titles, and only to
// that file, so published titles can be matched before anything is shown elsewhere.
const fs = require('fs'),
  path = require('path'),
  os = require('os'),
  crypto = require('crypto');
const { execFileSync } = require('child_process');

const VIEW_PX = 440;
const STEP_MS = 60;
const LINE_SPACING = 1.5;
const DEFAULT_FONT_PX = 14;
// follow.ts: MARGIN 0.15, so a point more than 0.5 - 0.15 of a screen from the centre is outside the band.
const BAND_SCREENS = 0.35;
// follow.ts glideMs, with PEAK_VIEWPORTS_PER_S 5; src/__tests__/followGlideEstimate.test.ts holds the two equal.
const PEAK_VIEWPORTS_PER_S = 5;
const glideMs = (distance, viewport) =>
  Math.max(250, (2 * distance * 1000) / (PEAK_VIEWPORTS_PER_S * Math.max(1, viewport)));

// src/convert.ts VERSION_HEADER, with the line ending: a byte order mark is allowed, and \r\n as well as \n.
const CURRENT_HEADER = /^\uFEFF?midstVersion: \S+?\r?\n/;

const step = (text, c) => text.slice(0, c.front) + c.inserted + text.slice(text.length - c.end);

/** The paragraph a place in the HTML is in: how many paragraphs close before it. */
function paragraphAt(html, offset) {
  let n = 0;
  for (let i = html.indexOf('</p>'); i !== -1 && i < offset; i = html.indexOf('</p>', i + 4)) n++;
  return n;
}

/** The estimate for one converted poem: its history and its font size. */
function estimate(history, fontSize) {
  const lineScreens = ((Number.isFinite(fontSize) && fontSize > 0 ? fontSize : DEFAULT_FONT_PX) * LINE_SPACING) / VIEW_PX;
  let text = '', last = null, largest = 0, glides = 0, pauseMs = 0;
  for (const c of history) {
    text = step(text, c);
    const here = paragraphAt(text, c.front);
    if (last !== null) {
      const screens = Math.abs(here - last) * lineScreens;
      if (screens > largest) largest = screens;
      if (screens > BAND_SCREENS) {
        glides++;
        pauseMs += glideMs(screens * VIEW_PX, VIEW_PX);
      }
    }
    last = here;
  }
  const baseMs = history.length * STEP_MS;
  return { steps: history.length, largest, glides, baseMs, pauseMs, multiple: baseMs ? pauseMs / baseMs : 0 };
}

function readPoem(zip, convertMidstFile) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'midst-glide-'));
  try {
    // As trajectory.cjs: extract everything and pick the .midst off disk (midst-format #6).
    execFileSync('unzip', ['-q', '-j', '-o', zip, '-x', '__MACOSX/*', '-d', tmp], { stdio: 'pipe' });
    const cands = fs.readdirSync(tmp).filter((n) => n.endsWith('.midst') && !n.startsWith('._'));
    if (cands.length !== 1) throw new Error(`expected one .midst in the zip, found ${cands.length}`);
    const bytes = fs.readFileSync(path.join(tmp, cands[0]));
    const raw = bytes.toString('utf8');
    // A file already in the current format (`midstVersion: <version>` on its first line, then the document) is read
    // as it is; only an old one is converted. Published timelapses are current (midst-editor #350).
    const header = CURRENT_HEADER.exec(raw);
    const converted = JSON.parse(header ? raw.slice(header[0].length) : convertMidstFile(raw));
    // The .midst inside, hashed: two zips of the same poem can differ only in their wrapping (midst-editor #350).
    const midstHash = crypto.createHash('sha256').update(bytes).digest('hex');
    return { history: converted.history, meta: converted.meta ?? {}, midstHash };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Every .midst.zip under the corpus, in the sorted order that gives each poem its index (index = position + 1). */
function archiveZips(corpus) {
  const zips = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.midst.zip')) zips.push(p);
    }
  })(corpus);
  return zips.sort();
}

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))];

function main(argv, { convertMidstFile = null, log = console.log, err = console.error } = {}) {
  const corpus = argv[0];
  const topAt = argv.indexOf('--top');
  const top = topAt === -1 ? 10 : Number(argv[topAt + 1]);
  const titlesAt = argv.indexOf('--titles');
  const titlesFile = titlesAt === -1 ? null : argv[titlesAt + 1];
  if (!corpus || !fs.existsSync(corpus) || !Number.isInteger(top) || top < 1 || (titlesAt !== -1 && !titlesFile)) {
    err('usage: node conformance/glide_estimate.cjs <corpus dir> [--top N] [--titles FILE]');
    return 2;
  }
  const zips = archiveZips(corpus);
  if (zips.length === 0) {
    err(`no .midst.zip found under the corpus directory`);
    return 2;
  }
  // Required where used, so a usage error is reported without a built harness; a test passes its own.
  const convert = convertMidstFile ?? require('../out/converter.cjs').convertMidstFile;
  const rows = [], titles = {}, failed = [];
  zips.forEach((zip, i) => {
    const index = i + 1;
    const hash = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex').slice(0, 12);
    try {
      const { history, meta } = readPoem(zip, convert);
      rows.push({ index, hash, ...estimate(history, meta.fontSize) });
      titles[index] = typeof meta.title === 'string' ? meta.title : null;
    } catch (error) {
      // The error's class only: a message may quote the file.
      failed.push({ index, hash, error: error?.constructor?.name ?? 'Error' });
    }
  });
  if (titlesFile) fs.writeFileSync(titlesFile, JSON.stringify(titles, null, 1));

  const f = (n, d = 1) => n.toFixed(d);
  log(`poems ${zips.length}, estimated ${rows.length}, could not be read ${failed.length}`);
  for (const r of failed) log(`  #${r.index} ${r.hash}: not read (${r.error})`);
  const byLargest = [...rows].sort((a, b) => b.largest - a.largest || a.index - b.index);
  log(`\nTop ${Math.min(top, rows.length)} by largest jump`);
  log('index  zip hash      largest jump (screens)  longest glide (s)  glides  base playback (s)  pause / base');
  for (const r of byLargest.slice(0, top)) {
    log(
      `#${String(r.index).padEnd(4)} ${r.hash}  ${f(r.largest).padStart(22)}  ${f(r.largest > BAND_SCREENS ? glideMs(r.largest * VIEW_PX, VIEW_PX) / 1000 : 0, 2).padStart(17)}` +
        `  ${String(r.glides).padStart(6)}  ${f(r.baseMs / 1000, 0).padStart(17)}  ${f(r.multiple, 2).padStart(11)}x`,
    );
  }
  if (rows.length === 0) return 1;
  const col = (k) => rows.map((r) => r[k]).sort((a, b) => a - b);
  const largest = col('largest'), glides = col('glides'), base = col('baseMs'), mult = col('multiple');
  log('\nAcross the corpus      median    90th   worst');
  log(`largest jump (screens) ${f(quantile(largest, 0.5)).padStart(7)} ${f(quantile(largest, 0.9)).padStart(7)} ${f(largest[largest.length - 1]).padStart(7)}`);
  log(`glides per poem        ${String(quantile(glides, 0.5)).padStart(7)} ${String(quantile(glides, 0.9)).padStart(7)} ${String(glides[glides.length - 1]).padStart(7)}`);
  log(`base playback (s)      ${f(quantile(base, 0.5) / 1000, 0).padStart(7)} ${f(quantile(base, 0.9) / 1000, 0).padStart(7)} ${f(base[base.length - 1] / 1000, 0).padStart(7)}`);
  log(`pause / base           ${f(quantile(mult, 0.5), 2).padStart(7)} ${f(quantile(mult, 0.9), 2).padStart(7)} ${f(mult[mult.length - 1], 2).padStart(7)}`);
  log(`jumps over 5 screens: ${rows.filter((r) => r.largest > 5).length} poems; over 10: ${rows.filter((r) => r.largest > 10).length}`);
  return failed.length ? 1 : 0;
}

module.exports = { estimate, paragraphAt, glideMs, main, archiveZips, readPoem, BAND_SCREENS, VIEW_PX, STEP_MS };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
