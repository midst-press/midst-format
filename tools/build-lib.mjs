// Builds the library in src/ into dist/ (midst-format #50, docs/LIBRARY.md): one directory per entry point,
// each holding CommonJS, an ES module and declarations, so a subpath resolves without package.json `exports`
// (TypeScript 4.6 with moduleResolution "node" ignores `exports`).
//
//   node tools/build-lib.mjs [--out <dir>]      default: dist
//
// The output is deterministic: no source maps, no timestamps, a fixed order of files and keys. The apps
// rebuild a tag and compare it byte for byte (tools/reproducible.mjs holds that here).
import * as esbuild from "esbuild";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRIES = ["history", "extensions", "convert", "follow", "build-label"];
// An entry point's directory is its source file's name, except where the subpath is spelled differently.
const SOURCE = { "build-label": "buildLabel" };
export const sourceOf = (name) => SOURCE[name] ?? name;
// Entries another entry imports. They stay external, so their code exists once.
const INTERNAL = ["history", "extensions"];
const PEERS = ["@tiptap/core", "@tiptap/html", "@tiptap/starter-kit"];
const FORMATS = [
  { format: "cjs", file: "index.cjs" },
  { format: "esm", file: "index.mjs" },
];

// Declaration files name their sibling entries as './history'; in dist/ each entry has its own directory.
// A relative specifier that is neither is a new dependency this script does not know how to place: fail.
export function rewriteDeclarationSpecifiers(text, name) {
  const found = [];
  const out = text.replace(
    /(from\s+|import\(\s*)(['"])(\.{1,2}\/[^'"]*)\2/g,
    (whole, lead, quote, spec) => {
      found.push(spec);
      const sibling = INTERNAL.find((e) => spec === `./${e}`);
      if (!sibling)
        throw new Error(`${name}.d.ts: unexpected relative specifier ${spec}`);
      return `${lead}${quote}../${sibling}${quote}`;
    },
  );
  return { text: out, rewritten: found.length };
}

// In `convert`, './history' and './extensions' become the sibling entry's file for the format being built.
const internalImports = (file) => ({
  name: "internal-entries",
  setup(b) {
    b.onResolve({ filter: /^\.\/(history|extensions)$/ }, (args) => ({
      path: `../${args.path.slice(2)}/${file}`,
      external: true,
    }));
  },
});

// The packages a bundle carries code from (#80), by the metafile's inputs: a path's last node_modules/<name>, or
// node_modules/@scope/<name>. TipTap stays external, so it is never an input.
export function bundledPackages(inputPaths) {
  const found = new Map();
  for (const input of inputPaths) {
    const m = input.replace(/\\/g, "/").match(/^(.*node_modules\/)((?:@[^/]+\/)?[^/]+)\//);
    if (m) found.set(m[2], m[1] + m[2]);
  }
  return found;
}

const LICENCE_FILE = /^(licen[cs]e|copying)(\.(md|txt))?$/i;

// THIRD_PARTY_NOTICES.md: every bundled package's name, version and licence text, in name order. The licences
// (MIT, BSD) require the notice in every copy, and the apps ship this build. A package with no licence file
// fails the build rather than ship without its notice.
export function thirdPartyNotices(packages, base = root) {
  const parts = [
    "# Third-party notices",
    "",
    "This build of @midst-press/midst-format includes code from the packages below. Each one's licence and",
    "copyright notice follows, as its licence requires.",
  ];
  for (const name of [...packages.keys()].sort()) {
    const dir = path.join(base, packages.get(name));
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const file = fs.readdirSync(dir).filter((f) => LICENCE_FILE.test(f)).sort()[0];
    if (!file) throw new Error(`${name} is bundled but has no licence file to carry`);
    const text = fs.readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n").trimEnd();
    parts.push("", `## ${name} ${manifest.version} (${manifest.license ?? "see below"})`, "", "```", text, "```");
  }
  return `${parts.join("\n")}\n`;
}

async function bundle(outDir, name, { format, file }) {
  const result = await esbuild.build({
    entryPoints: [path.join(root, "src", `${sourceOf(name)}.ts`)],
    outfile: path.join(outDir, name, file),
    bundle: true,
    format,
    platform: "neutral",
    target: "es2019",
    sourcemap: false,
    legalComments: "none",
    external: ["@tiptap/*"],
    plugins: [internalImports(file)],
    // Warnings and errors are thrown below, so none is lost to a stream nobody reads.
    logLevel: "silent",
    metafile: true,
  });
  return Object.keys(result.metafile.inputs);
}

function emitDeclarations(outDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "midst-dts-"));
  try {
    const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
    execFileSync(
      process.execPath,
      [tsc, "-p", path.join(root, "tsconfig.lib.json"), "--outDir", tmp],
      {
        cwd: root,
        stdio: "inherit",
      },
    );
    let rewritten = 0;
    for (const name of ENTRIES) {
      const source = fs.readFileSync(
        path.join(tmp, `${sourceOf(name)}.d.ts`),
        "utf8",
      );
      const r = rewriteDeclarationSpecifiers(source, name);
      rewritten += r.rewritten;
      fs.writeFileSync(path.join(outDir, name, "index.d.ts"), r.text);
    }
    return rewritten;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export async function buildLib(outDir) {
  const rootPackage = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const name of ENTRIES)
    fs.mkdirSync(path.join(outDir, name), { recursive: true });

  const inputs = [];
  for (const name of ENTRIES)
    for (const f of FORMATS) inputs.push(...(await bundle(outDir, name, f)));
  const packages = bundledPackages(inputs);
  fs.writeFileSync(
    path.join(outDir, "THIRD_PARTY_NOTICES.md"),
    thirdPartyNotices(packages),
  );
  const rewritten = emitDeclarations(outDir);

  for (const name of ENTRIES) {
    fs.writeFileSync(
      path.join(outDir, name, "package.json"),
      `${JSON.stringify({ main: "index.cjs", module: "index.mjs", types: "index.d.ts" }, null, 2)}\n`,
    );
  }
  const exportsMap = Object.fromEntries(
    ENTRIES.map((name) => [
      `./${name}`,
      {
        types: `./${name}/index.d.ts`,
        import: `./${name}/index.mjs`,
        require: `./${name}/index.cjs`,
      },
    ]),
  );
  const peerDependencies = Object.fromEntries(
    PEERS.map((p) => [p, rootPackage.dependencies[p]]),
  );
  fs.writeFileSync(
    path.join(outDir, "package.json"),
    `${JSON.stringify(
      {
        name: rootPackage.name,
        version: rootPackage.version,
        private: true,
        peerDependencies,
        // Only `convert` needs @tiptap/html. Optional, so an app that takes `history` and `extensions` (web)
        // is not given it by npm, which installs every required peer (clement-7074f29f, review of #54).
        peerDependenciesMeta: { "@tiptap/html": { optional: true } },
        exports: exportsMap,
      },
      null,
      2,
    )}\n`,
  );
  return {
    entries: ENTRIES.length,
    formats: FORMATS.length,
    declarationSpecifiersRewritten: rewritten,
    bundledPackages: packages.size,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const i = process.argv.indexOf("--out");
  const outDir = path.resolve(
    i > 0 ? process.argv[i + 1] : path.join(root, "dist"),
  );
  try {
    const r = await buildLib(outDir);
    console.log(
      `built ${r.entries} entry points x ${r.formats} formats, plus declarations (${r.declarationSpecifiersRewritten} specifiers rewritten), and the notices of ${r.bundledPackages} bundled packages`,
    );
    console.log(`output: ${path.relative(root, outDir) || "."}`);
  } catch (e) {
    console.log(
      `build-lib FAILED: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(1);
  }
}
