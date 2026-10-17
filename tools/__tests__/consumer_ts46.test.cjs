// consumer-ts46 must be able to fail. Positive controls, each on a copy of a fresh build: a library whose subpaths
// resolve only through `exports` (which TypeScript 4.6 with moduleResolution "node" ignores), and one whose
// declarations use syntax newer than 4.6.
const fs = require("fs"),
  os = require("os"),
  path = require("path");
const { execFileSync } = require("child_process");
const { checkConsumer } = require("../consumer-ts46.cjs");

const root = path.join(__dirname, "..", "..");
let tmp, dist;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "midst-consumer-test-"));
  dist = path.join(tmp, "dist");
  execFileSync(
    process.execPath,
    [path.join(root, "tools", "build-lib.mjs"), "--out", dist],
    { stdio: "pipe" },
  );
}, 120000);
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("the TypeScript 4.6 consumer check", () => {
  it("passes on the built library", () => {
    const r = checkConsumer(dist);
    expect(r.output).toBe("");
    expect(r.ok).toBe(true);
  }, 120000);

  it("fails when a subpath resolves only through `exports`", () => {
    const r = checkConsumer(dist, {
      mutate: (pkg) => {
        // Move every entry out of the package root and point `exports` at the new place: no directory is left
        // at the subpath, as a library with an `exports` map and nothing else would have.
        fs.mkdirSync(path.join(pkg, "lib"));
        const manifest = JSON.parse(
          fs.readFileSync(path.join(pkg, "package.json"), "utf8"),
        );
        for (const name of ["history", "extensions", "convert"]) {
          fs.renameSync(path.join(pkg, name), path.join(pkg, "lib", name));
          for (const cond of Object.keys(manifest.exports[`./${name}`])) {
            manifest.exports[`./${name}`][cond] = manifest.exports[`./${name}`][
              cond
            ].replace("./", "./lib/");
          }
        }
        fs.writeFileSync(
          path.join(pkg, "package.json"),
          JSON.stringify(manifest),
        );
      },
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("TS2307");
  }, 120000);

  it("fails on declaration syntax newer than TypeScript 4.6", () => {
    const r = checkConsumer(dist, {
      mutate: (pkg) =>
        fs.appendFileSync(
          path.join(pkg, "history", "index.d.ts"),
          "export declare function later<const T>(x: T): T;\n",
        ),
    });
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/error TS\d+/);
  }, 120000);
});
