import * as esbuild from 'esbuild';
import path from 'path';
import fsp from 'fs';
import { createRequire } from 'module';
// Errors are logged as JSONL on stderr (log.cjs, midst-format #38); stdout is the report.
const { logEvent, installUncaughtHandler } = createRequire(import.meta.url)('./log.cjs');
installUncaughtHandler();
const here = import.meta.dirname;
// The converter under test is this repository's own src/convert.ts (the library's source), never a copy.
const convertPath = path.join(here, '..', 'src', 'convert');
fsp.writeFileSync(path.join(here, 'entry.generated.ts'),
  `import { convertMidstFile } from ${JSON.stringify(convertPath)};\nexport { convertMidstFile };\n`);

let r;
try {
  r = await esbuild.build({
  entryPoints: [path.join(here,'entry.generated.ts')],
  bundle: true, platform: 'node', format: 'cjs',
  outfile: path.join(here,'..','out','converter.cjs'),
  // Silent: esbuild would write its own messages to stderr, which carries only the JSONL log. Its warnings and
  // errors are printed below, on stdout.
  logLevel: 'silent', metafile: true,
  // A source map lets coverage of this bundle be reported against src/convert.ts (coverage.cjs).
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
const ins = Object.keys(r.metafile.inputs).filter(p => p.includes(path.join('src','convert')));
console.log('Library sources bundled:', ins);
