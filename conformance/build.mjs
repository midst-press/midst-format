import * as esbuild from 'esbuild';
import path from 'path';
import fsp from 'fs';
import { createRequire } from 'module';
// Errors are logged as JSONL on stderr (log.cjs, midst-format #38); stdout is the report.
const { logEvent, installUncaughtHandler } = createRequire(import.meta.url)('./log.cjs');
installUncaughtHandler();
const here = import.meta.dirname;
const stub = (f) => path.join(here, 'stubs', f);
// The converter is imported from midst-editor's real source, never copied.
// Set MIDST_EDITOR_SRC to the midst-editor checkout root.
const editor = process.env.MIDST_EDITOR_SRC;
if (!editor) {
  console.log('MIDST_EDITOR_SRC is not set: point it at a midst-editor checkout.');
  logEvent('error', 'build-env-not-set');
  process.exit(2);
}
// Resolved against the working directory: the value is written into an import in conformance/, where a relative
// path would otherwise be read from the wrong place.
const utilPath = path.join(path.resolve(editor), 'src', 'main', 'util');
fsp.writeFileSync(path.join(here, 'entry.generated.ts'),
  `import { convertMidstFile } from ${JSON.stringify(utilPath)};\nexport { convertMidstFile };\n`);

const plugin = {
  name: 'harness-stubs',
  setup(b) {
    b.onResolve({ filter: /^electron$/ },                 () => ({ path: stub('electron.js') }));
    b.onResolve({ filter: /^\.\/store$/ },                () => ({ path: stub('store.js') }));
    b.onResolve({ filter: /^renderer\/tracking\/utils$/ },() => ({ path: stub('tracking-utils.js') }));
  },
};
let r;
try {
  r = await esbuild.build({
  entryPoints: [path.join(here,'entry.generated.ts')],
  bundle: true, platform: 'node', format: 'cjs',
  outfile: path.join(here,'..','out','converter.cjs'),
  // Silent: esbuild would write its own messages to stderr, which carries only the JSONL log. Its warnings and
  // errors are printed below, on stdout.
  plugins: [plugin], logLevel: 'silent', metafile: true,
  // A source map lets coverage of this bundle be reported against midst-editor's util.ts (coverage.cjs).
  sourcemap: true,
  external: ['@tiptap/*', 'node-html-parser'],
  });
} catch (e) {
  for (const m of (e.errors || [])) console.log('ERROR:', m.text, '|', m.location ? `${m.location.file}:${m.location.line}` : '');
  logEvent('error', 'build-error', { count: (e.errors || []).length });
  process.exit(1);
}
for (const m of r.warnings) console.log('WARNING:', m.text, '|', m.location ? `${m.location.file}:${m.location.line}` : '');
// Record exactly which real source files went into the bundle -- provenance, not a claim.
const ins = Object.keys(r.metafile.inputs).filter(p => p.includes(path.join('src','main','util')));
console.log('REAL app sources bundled:', ins);
