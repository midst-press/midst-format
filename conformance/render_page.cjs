// One Chromium page that measures visible lines two ways, shared by render_lines.cjs and shapes_fuzz.cjs.
//   browser(html)  the HTML as the old app showed it, in a very wide box, line-height 20px: height / 20.
//   editor(html)   the same HTML loaded into a REAL TipTap editor (render_editor_entry.mjs), measured the same way.
// Both controls must tell one line from two before anything is measured.
const fs = require('fs'),
  path = require('path');
const { chromium } = require('playwright');
const esbuild = require('esbuild');

const LINE = 20;
// The old app's white-space on the editing area is not established: its stylesheet sets none that we found.
// The default 'normal' is used; MIDST_SOURCE_WHITE_SPACE=pre-wrap runs the browser side the other way.
const SOURCE_WS = process.env.MIDST_SOURCE_WHITE_SPACE || 'normal';
const CSS = `* { margin: 0; padding: 0; border: 0; }
#c { white-space: ${SOURCE_WS}; }
#c, #e { width: 100000px; font: 16px/${LINE}px monospace; }
/* !important beats inline style="line-height/font-size" in old frames, which would otherwise skew height/20 */
#c *, #e * { line-height: ${LINE}px !important; font-size: 16px !important; }
#e .ProseMirror { outline: none; }`;

async function openRenderer() {
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
  const lines = (px) => Math.round(px / LINE);
  const browserLines = async (h) =>
    lines(
      await page.evaluate((x) => {
        const c = document.getElementById('c');
        c.innerHTML = x;
        return c.getBoundingClientRect().height;
      }, h),
    );
  const editorLines = async (h) => lines(await page.evaluate((x) => window.renderEditor(x), h));
  // Positive controls: each measurement must be able to tell one line from two.
  for (const [name, f] of [
    ['browser', browserLines],
    ['editor', editorLines],
  ]) {
    const one = await f('<p>a</p>'),
      two = await f('<p>a</p><p>b</p>');
    if (one !== 1 || two !== 2) throw new Error(`${name} control failed: ${one} ${two}`);
  }
  return { browserLines, editorLines, close: () => browser.close(), SOURCE_WS };
}
module.exports = { openRenderer };
