// The library as midst-web consumes it (midst-format #50, docs/LIBRARY.md): TypeScript 4.6 with
// moduleResolution "node", which ignores package.json `exports`. A small project imports every export of each
// subpath of dist/ and must type-check. A check of the .d.ts syntax alone could not see a subpath that does not
// resolve.
//
//   node tools/consumer-ts46.cjs [--dist <dir>]      default: dist (npm run build:lib first)
//
// skipLibCheck: TipTap and ProseMirror's own declarations do not type-check under 4.6 (measured), and an app has to skip
// them too. Resolution errors (TS2307) and the use of our types in index.ts are still checked, and so is the syntax of our
// .d.ts files.
//
// TypeScript 4.6.3 is the devDependency `typescript-4.6`; the root `typescript` (5.5.3) builds the library.
const fs = require("fs"),
  os = require("os"),
  path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const SUBPATHS = ["history", "extensions", "convert"];

// What a subpath exports, read from its declarations (the CommonJS build needs TipTap to load): values, types, and
// whether there is a default. Read from the build, so a new export is imported too.
function exportsOf(dist, name) {
  const dts = fs.readFileSync(path.join(dist, name, "index.d.ts"), "utf8");
  const names = (re) => [...dts.matchAll(re)].map((m) => m[1]);
  return {
    named: names(/^export declare (?:const|function|class) (\w+)/gm),
    hasDefault: /^export default /m.test(dts),
    types: names(/^export (?:interface|type) (\w+)/gm),
  };
}

function consumerSource(dist) {
  const lines = [];
  for (const name of SUBPATHS) {
    const e = exportsOf(dist, name);
    const spec = `@midst-press/midst-format/${name}`;
    const names = [...e.named, ...e.types];
    const bindings = [
      e.hasDefault ? `${name}Default` : null,
      names.length ? `{ ${names.join(", ")} }` : null,
    ].filter(Boolean);
    lines.push(`import ${bindings.join(", ")} from '${spec}';`);
    if (e.types.length)
      lines.push(`export type Types_${name} = [${e.types.join(", ")}];`);
  }
  // One value from each subpath, used.
  lines.push(
    "export const change: ChangeObj = compareStrings('a', 'ab', 0);",
    'export const replayed: string = step("a", change);',
    "export const extensionCount: number = extensionsDefault.length;",
    'export const version: string = getFileVersion("midstVersion: 1\\n{}");',
  );
  return `${lines.join("\n")}\n`;
}

// Returns { ok, output }. `dist` is copied into a temporary node_modules, so the check sees what an app that
// vendored it sees.
function checkConsumer(dist, { mutate } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "midst-consumer-"));
  try {
    const pkg = path.join(tmp, "node_modules", "@midst-press", "midst-format");
    fs.mkdirSync(path.dirname(pkg), { recursive: true });
    fs.cpSync(dist, pkg, { recursive: true });
    // The consumer's own TipTap: the library's peers, which are format's own.
    fs.mkdirSync(path.join(tmp, "node_modules", "@tiptap"));
    for (const e of fs.readdirSync(
      path.join(root, "node_modules", "@tiptap"),
    )) {
      fs.symlinkSync(
        path.join(root, "node_modules", "@tiptap", e),
        path.join(tmp, "node_modules", "@tiptap", e),
        "dir",
      );
    }
    // The imports are read before `mutate` changes the copy: the program must still ask for every subpath.
    const source = consumerSource(dist);
    if (mutate) mutate(pkg);
    fs.writeFileSync(path.join(tmp, "index.ts"), source);
    fs.writeFileSync(
      path.join(tmp, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          moduleResolution: "node",
          module: "esnext",
          target: "es2019",
          strict: true,
          noEmit: true,
          types: [],
          skipLibCheck: true,
        },
        files: ["index.ts"],
      }),
    );
    const tsc = path.join(root, "node_modules", "typescript-4.6", "bin", "tsc");
    const run = spawnSync(process.execPath, [tsc, "-p", tmp], {
      encoding: "utf8",
    });
    return { ok: run.status === 0, output: (run.stdout + run.stderr).trim() };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  const i = process.argv.indexOf("--dist");
  const dist = path.resolve(
    i > 0 ? process.argv[i + 1] : path.join(root, "dist"),
  );
  if (!fs.existsSync(path.join(dist, "package.json"))) {
    console.log(
      `consumer-ts46: ${path.relative(root, dist)} is not built; run npm run build:lib`,
    );
    return 2;
  }
  const version = require(
    path.join(root, "node_modules", "typescript-4.6", "package.json"),
  ).version;
  const sources = consumerSource(dist)
    .split("\n")
    .filter((l) => l.startsWith("import ")).length;
  const r = checkConsumer(dist);
  console.log(
    `consumer-ts46: TypeScript ${version}, moduleResolution node, ${sources} subpaths imported`,
  );
  if (r.output) console.log(r.output);
  console.log(r.ok ? "consumer-ts46 OK" : "consumer-ts46 FAILED");
  return r.ok ? 0 : 1;
}

module.exports = { checkConsumer, consumerSource };

if (require.main === module) process.exitCode = main();
