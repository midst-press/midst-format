// build-lib.mjs: the declaration rewrite, and a library with its entry points built once, not copied into each other.
// The rewrite is exercised with text of its own: the declarations tsc emits for the current sources name no sibling.
const fs = require("fs"),
  os = require("os"),
  path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..", "..");
const run = (code) =>
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { rewriteDeclarationSpecifiers } from ${JSON.stringify(path.join(root, "tools", "build-lib.mjs"))}; ${code}`,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
const rewrite = (text) =>
  JSON.parse(
    run(
      `console.log(JSON.stringify(rewriteDeclarationSpecifiers(${JSON.stringify(text)}, 'convert')))`,
    ),
  );

describe("declaration specifiers", () => {
  it("points a sibling entry at its directory, in imports and in import types", () => {
    const r = rewrite(
      "import { ChangeObj } from './history';\nexport declare const x: import('./extensions').Y;\n",
    );
    expect(r.text).toBe(
      "import { ChangeObj } from '../history';\nexport declare const x: import('../extensions').Y;\n",
    );
    expect(r.rewritten).toBe(2);
  });

  it("leaves a package specifier alone", () => {
    expect(rewrite("import { Extension } from '@tiptap/core';\n")).toEqual({
      text: "import { Extension } from '@tiptap/core';\n",
      rewritten: 0,
    });
  });

  it("fails on a relative specifier it cannot place", () => {
    expect(() => rewrite("import { Z } from './elsewhere';\n")).toThrow(
      /unexpected relative specifier \.\/elsewhere/,
    );
  });
});

describe("the built library", () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "midst-build-test-"));
  afterAll(() => fs.rmSync(dist, { recursive: true, force: true }));
  beforeAll(
    () =>
      execFileSync(
        process.execPath,
        [path.join(root, "tools", "build-lib.mjs"), "--out", dist],
        { stdio: "pipe" },
      ),
    120000,
  );

  it("holds history and extensions code once: convert imports the sibling build, in each format", () => {
    const cjs = fs.readFileSync(
      path.join(dist, "convert", "index.cjs"),
      "utf8",
    );
    const esm = fs.readFileSync(
      path.join(dist, "convert", "index.mjs"),
      "utf8",
    );
    expect(cjs).toContain('require("../history/index.cjs")');
    expect(cjs).toContain('require("../extensions/index.cjs")');
    expect(esm).toContain('from "../history/index.mjs"');
    expect(esm).toContain('from "../extensions/index.mjs"');
    expect(cjs).not.toContain("StarterKit.configure");
    expect(cjs).not.toContain("compareStrings = ");
  });

  it("leaves TipTap to the app", () => {
    const cjs = fs.readFileSync(
      path.join(dist, "convert", "index.cjs"),
      "utf8",
    );
    expect(cjs).toContain('require("@tiptap/html")');
    expect(
      fs.readFileSync(path.join(dist, "extensions", "index.mjs"), "utf8"),
    ).toContain('from "@tiptap/starter-kit"');
  });

  it("has a directory per entry point with its own manifest, and no source maps", () => {
    for (const name of [
      "history",
      "extensions",
      "convert",
      "follow",
      "build-label",
    ]) {
      const files = fs.readdirSync(path.join(dist, name)).sort();
      expect(files).toEqual([
        "index.cjs",
        "index.d.ts",
        "index.mjs",
        "package.json",
      ]);
      expect(
        JSON.parse(
          fs.readFileSync(path.join(dist, name, "package.json"), "utf8"),
        ),
      ).toEqual({
        main: "index.cjs",
        module: "index.mjs",
        types: "index.d.ts",
      });
    }
  });

  it("names the package from the root manifest, with the TipTap peers at the root's versions", () => {
    const rootPkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    );
    const pkg = JSON.parse(
      fs.readFileSync(path.join(dist, "package.json"), "utf8"),
    );
    expect(pkg).toMatchObject({
      name: rootPkg.name,
      version: rootPkg.version,
      private: true,
    });
    expect(pkg.peerDependencies).toEqual({
      "@tiptap/core": rootPkg.dependencies["@tiptap/core"],
      "@tiptap/html": rootPkg.dependencies["@tiptap/html"],
      "@tiptap/starter-kit": rootPkg.dependencies["@tiptap/starter-kit"],
    });
    // Only @tiptap/html is optional: the other two are needed by `extensions`, which web takes.
    expect(pkg.peerDependenciesMeta).toEqual({
      "@tiptap/html": { optional: true },
    });
    expect(Object.keys(pkg.exports)).toEqual([
      "./history",
      "./extensions",
      "./convert",
      "./follow",
      "./build-label",
    ]);
  });

  // The player helpers came from the editor importing nothing, and the build must not give them anything.
  it("builds follow and build-label with no imports, and the CommonJS build-label runs", () => {
    for (const name of ["follow", "build-label"]) {
      expect(
        fs.readFileSync(path.join(dist, name, "index.cjs"), "utf8"),
      ).not.toMatch(/require\(/);
      expect(
        fs.readFileSync(path.join(dist, name, "index.mjs"), "utf8"),
      ).not.toMatch(/^import /m);
    }
    const { buildLabel, isPreRelease } = require(
      path.join(dist, "build-label", "index.cjs"),
    );
    expect(buildLabel({})).toBe("Development build");
    expect(isPreRelease("v1.0.0")).toBe(false);
  });

  // #80: the bundled packages' licences (MIT, BSD) require their notice in every copy, and the apps ship this build.
  it("carries the licence of every package whose code it bundles, word for word", () => {
    const notices = fs.readFileSync(path.join(dist, "THIRD_PARTY_NOTICES.md"), "utf8");
    const named = [...notices.matchAll(/^## (\S+) /gm)].map((m) => m[1]);
    // convert bundles parse5 and its entities since #79; a change to that list should change this line too.
    expect(named).toEqual(["entities", "parse5"]);
    for (const name of named) {
      const dir = path.join(root, "node_modules", name);
      const licence = fs.readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
      const text = fs.readFileSync(path.join(dir, licence), "utf8").replace(/\r\n/g, "\n").trimEnd();
      expect([name, notices.includes(text)]).toEqual([name, true]);
    }
  });
});

describe("bundled packages and their notices", () => {
  const notices = (packages, base) =>
    run(`import { thirdPartyNotices } from ${JSON.stringify(path.join(root, "tools", "build-lib.mjs"))}; console.log(thirdPartyNotices(new Map(${JSON.stringify(packages)}), ${JSON.stringify(base)}))`);
  const found = (inputs) =>
    JSON.parse(run(`const { bundledPackages } = await import(${JSON.stringify(path.join(root, "tools", "build-lib.mjs"))}); console.log(JSON.stringify([...bundledPackages(${JSON.stringify(inputs)})]))`));

  it("names each package directory once, scoped ones included, from the innermost node_modules", () => {
    expect(
      found([
        "src/convert.ts",
        "node_modules/parse5/dist/index.js",
        "node_modules/parse5/dist/tokenizer/index.js",
        "node_modules/@zq/qz-lib/index.js",
        "node_modules/parse5/node_modules/entities/lib/decode.js",
      ]),
    ).toEqual([
      ["node_modules/parse5", "parse5"],
      ["node_modules/@zq/qz-lib", "@zq/qz-lib"],
      ["node_modules/parse5/node_modules/entities", "entities"],
    ]);
  });

  // #86: keyed by name, the second copy's path overwrote the first, and one version's licence stood for both.
  it("keeps two copies of one package as two packages", () => {
    expect(
      found([
        "node_modules/entities/lib/decode.js",
        "node_modules/parse5/node_modules/entities/lib/decode.js",
      ]),
    ).toEqual([
      ["node_modules/entities", "entities"],
      ["node_modules/parse5/node_modules/entities", "entities"],
    ]);
  });

  it("gives each copy of one package its own notice, with its own version and licence", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "midst-notices-"));
    try {
      for (const [dir, version] of [["node_modules/zq", "2.0.0"], ["node_modules/qx/node_modules/zq", "1.0.0"]]) {
        fs.mkdirSync(path.join(base, dir), { recursive: true });
        fs.writeFileSync(path.join(base, dir, "package.json"), `{"version":"${version}","license":"MIT"}`);
        fs.writeFileSync(path.join(base, dir, "LICENSE"), `Zq ${version} licence, copyright Qz ${version}`);
      }
      const out = notices([["node_modules/zq", "zq"], ["node_modules/qx/node_modules/zq", "zq"]], base);
      expect([...out.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual(["zq 1.0.0 (MIT)", "zq 2.0.0 (MIT)"]);
      expect(out).toContain("## zq 1.0.0 (MIT)\n\n```\nZq 1.0.0 licence, copyright Qz 1.0.0\n```");
      expect(out).toContain("## zq 2.0.0 (MIT)\n\n```\nZq 2.0.0 licence, copyright Qz 2.0.0\n```");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("refuses a bundled package that has no licence file, so nothing ships without its notice", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "midst-notices-"));
    try {
      fs.mkdirSync(path.join(base, "node_modules", "zq"), { recursive: true });
      fs.writeFileSync(path.join(base, "node_modules", "zq", "package.json"), '{"version":"1.0.0"}');
      expect(() => notices([["node_modules/zq", "zq"]], base)).toThrow(/zq \(node_modules\/zq\) is bundled but has no licence file/);
      fs.writeFileSync(path.join(base, "node_modules", "zq", "LICENSE.md"), "Zq licence\r\n");
      expect(notices([["node_modules/zq", "zq"]], base)).toContain("## zq 1.0.0 (see below)\n\n```\nZq licence\n```");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
