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
//   editor lines   the CONVERTED frame loaded into a real TipTap editor (same extensions as midst-editor,
//                  ProseMirror's own CSS) in the same page, measured the same way. Rendered, not modelled.
//
// Prints counts and fixture names only, never frame content. Exit 1 on any difference.
//   node conformance/render_lines.cjs <dir of .midst.zip>   searched recursively. CI: fixtures only.
// The real archive runs ONLY locally, and is reported by number, never by name.
const fs = require('fs'),
  path = require('path'),
  os = require('os');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const esbuild = require('esbuild');
const { normalise } = require('./normalise.cjs');

const LINE = 20;
const CSS = `* { margin: 0; padding: 0; border: 0; }
#c, #e { width: 100000px; font: 16px/${LINE}px monospace; }
#c *, #e * { line-height: ${LINE}px; }
#e .ProseMirror { outline: none; }`;

function framesOf(zip) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-'));
  try {
    execFileSync('unzip', ['-q', '-j', '-o', zip, '-x', '__MACOSX/*', '-d', tmp], { stdio: 'ignore' });
    const found = fs.readdirSync(tmp).filter((n) => n.endsWith('.midst') && !n.startsWith('._'));
    if (found.length !== 1) throw new Error(`expected 1 .midst entry, found ${found.length}`);
    return JSON.parse(fs.readFileSync(path.join(tmp, found[0]), 'utf8')).editorTimelineFrames;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node conformance/render_lines.cjs <dir of .midst.zip>');
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
    console.error(`no .midst.zip files in ${dir}`);
    process.exit(2);
  }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pmCss = fs.readFileSync(require.resolve('prosemirror-view/style/prosemirror.css'), 'utf8');
  const bundle = esbuild.buildSync({
    entryPoints: [path.join(__dirname, 'render_editor_entry.mjs')],
    bundle: true,
    format: 'iife',
    write: false,
    logLevel: 'error',
  }).outputFiles[0].text;
  await page.setContent(`<!doctype html><style>${pmCss}\n${CSS}</style><div id="c"></div><div id="e"></div>`);
  await page.addScriptTag({ content: bundle });
  const editorHeight = async (h) => page.evaluate((x) => window.renderEditor(x), h);
  // Positive control: the measurement must be able to tell one line from two.
  const probe = async (h) => page.evaluate((x) => {
    const c = document.getElementById('c');
    c.innerHTML = x;
    return c.getBoundingClientRect().height;
  }, h);
  const one = await probe('<p>a</p>'),
    two = await probe('<p>a</p><p>b</p>');
  if (Math.round(one / LINE) !== 1 || Math.round(two / LINE) !== 2) throw new Error(`control failed: ${one} ${two}`);
  const e1 = await editorHeight('<p>a</p>'),
    e2 = await editorHeight('<p>a</p><p>b</p>');
  if (Math.round(e1 / LINE) !== 1 || Math.round(e2 / LINE) !== 2) throw new Error(`editor control failed: ${e1} ${e2}`);

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
      const b = Math.round((await probe(f.content)) / LINE);
      const e = Math.round((await editorHeight(normalise(f.content))) / LINE);
      if (b !== e) {
        diff++;
        if (e > b) more++;
        else fewer++;
      }
    }
    if (diff) bad++;
    const name = label(z, i);
    const want = known ? (known[name]?.differ ?? 0) : 0;
    if (known && diff !== want) unexpected++;
    const mark = known && diff !== want ? ` UNEXPECTED (known: ${want})` : known && diff ? ' (known)' : '';
    console.log(`${diff ? 'DIFF' : 'SAME'} ${name.padEnd(44)} frames:${frames.length} differ:${diff} editorMore:${more} editorFewer:${fewer}${mark}`);
  }
  await browser.close();
  console.log(`\n${zips.length - bad} of ${zips.length} show the same lines in the editor as in a browser`);
  if (known) console.log(`${unexpected} unexpected against ${process.argv[ki + 1]}`);
  process.exit((known ? unexpected : bad) ? 1 : 0);
}
main().catch((e) => {
  console.error(e.constructor.name);
  process.exit(2);
});
