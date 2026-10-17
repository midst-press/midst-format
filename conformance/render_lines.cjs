// Does the converted poem show the same number of lines as the old app showed?
//
// The old app displayed each format-B frame as HTML in a browser. Some frames are malformed (a bare
// <br> between paragraphs, an empty <p></p>, nested <p>, hidden selection markers), and no regex says
// how a browser draws those. So this RENDERS each source frame in Chromium and counts visible lines,
// and counts the lines the editor will show for the converted frame. A difference means the poet
// would see a line appear or vanish.
//
//   browser lines  the frame's HTML in a very wide box, every margin and padding 0, line-height 20px:
//                  height / 20. Nothing wraps, so the count is lines, not layout.
//   editor lines   the CONVERTED frame (convertMidstFile's history, replayed) loaded into a real TipTap editor (same extensions as midst-editor,
//                  ProseMirror's own CSS) in the same page, measured the same way. Rendered, not modelled.
//
// Prints counts and fixture names only, never frame content. Exit 1 on any difference.
//   node conformance/render_lines.cjs <dir of .midst.zip>   searched recursively. CI: fixtures only.
// The real archive runs ONLY locally, and is reported by number, never by name.
const fs = require('fs'),
  path = require('path'),
  os = require('os');
const { execFileSync } = require('child_process');
// Errors are logged as JSONL on stderr (log.cjs, midst-format #38); stdout is the report.
const { logEvent, installUncaughtHandler, reportHarnessError } = require('./log.cjs');
installUncaughtHandler();
// The ACTUAL converter (built from midst-editor's util.ts by build:harness), replayed frame by frame:
// the editor is shown what conversion produced, not a re-parse of the source.
// Both are required where they are used, so a usage error is reported without a built harness or a browser.
const converter = () => require('../out/converter.cjs').convertMidstFile;
const step = (acc, c) => acc.slice(0, c.front) + c.inserted + acc.slice(acc.length - c.end);

function framesOf(zip) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-'));
  try {
    execFileSync('unzip', ['-q', '-j', '-o', zip, '-x', '__MACOSX/*', '-d', tmp], { stdio: 'ignore' });
    const found = fs.readdirSync(tmp).filter((n) => n.endsWith('.midst') && !n.startsWith('._'));
    if (found.length !== 1) throw new Error(`expected 1 .midst entry, found ${found.length}`);
    const raw = fs.readFileSync(path.join(tmp, found[0]), 'utf8');
    const frames = JSON.parse(raw).editorTimelineFrames;
    const { history } = JSON.parse(converter()(raw));
    let acc = '';
    const converted = history.map((c) => (acc = step(acc, c)));
    if (converted.length !== frames.length) throw new Error(`history ${converted.length} != frames ${frames.length}`);
    return frames.map((f, i) => ({ content: f.content, converted: converted[i] }));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.log('usage: node conformance/render_lines.cjs <dir of .midst.zip>');
    logEvent('error', 'usage');
    process.exit(2);
  }
  const zips = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.midst.zip')) zips.push(p);
    }
  })(dir);
  zips.sort();
  // Our own fixtures are named; anything else (the real archive) is reported by number only.
  const label = (z, i) => {
    const n = path.basename(z, '.midst.zip');
    return /^(synthetic|html-shape)--/.test(n) ? n : `#${String(i + 1).padStart(2, '0')}`;
  };
  if (zips.length === 0) {
    console.log(`no .midst.zip files in ${dir}`);
    logEvent('error', 'no-poems');
    process.exit(2);
  }
  const r = await require('./render_page.cjs').openRenderer();

  // KNOWN differences, a ratchet: --known FILE maps fixture name -> expected differing-frame count.
  // Any count that CHANGES fails, so a regression and a fix both demand an edit here, with a reason.
  const ki = process.argv.indexOf('--known');
  const known = ki > 0 ? JSON.parse(fs.readFileSync(process.argv[ki + 1], 'utf8')) : null;
  let bad = 0,
    unexpected = 0;
  for (const [i, z] of zips.entries()) {
    const frames = framesOf(z);
    let diff = 0,
      more = 0,
      fewer = 0;
    for (const f of frames) {
      const b = await r.browserLines(f.content);
      const e = await r.editorLines(f.converted);
      if (b !== e) {
        diff++;
        if (e > b) more++;
        else fewer++;
      }
    }
    if (diff) bad++;
    const name = label(z, i);
    // Direction matters as much as count: a flip from editorMore to editorFewer is a different defect.
    const k = (known && known[name]) || { differ: 0, editorMore: 0, editorFewer: 0 };
    const want = `${k.differ}/${k.editorMore ?? 0}/${k.editorFewer ?? 0}`;
    const got = `${diff}/${more}/${fewer}`;
    if (known && got !== want) unexpected++;
    const mark = known && got !== want ? ` UNEXPECTED (known differ/more/fewer: ${want})` : known && diff ? ' (known)' : '';
    console.log(`${diff ? 'DIFF' : 'SAME'} ${name.padEnd(44)} frames:${frames.length} differ:${diff} editorMore:${more} editorFewer:${fewer}${mark}`);
  }
  await r.close();
  console.log(`\n${zips.length - bad} of ${zips.length} show the same lines in the editor as in a browser (source white-space: ${r.SOURCE_WS})`);
  if (known) console.log(`${unexpected} unexpected against ${process.argv[ki + 1]}`);
  process.exit((known ? unexpected : bad) ? 1 : 0);
}
main().catch((e) => {
  reportHarnessError(e);
  process.exit(2);
});
