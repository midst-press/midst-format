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
});
