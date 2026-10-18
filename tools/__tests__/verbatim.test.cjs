// verbatim.mjs must be able to fail. A throwaway editor repository and a throwaway format root stand in for the real
// two, so each case changes one thing and the check is run as an app's CI runs it: as a command.
const fs = require("fs"),
  os = require("os"),
  path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const script = path.join(__dirname, "..", "verbatim.mjs");
const MARK = "zqmarker";

// Editor files as committed. util.ts holds an excluded declaration, as the real one does.
const EDITOR_A = `import x from 'x';\n// keeps ${MARK}\nexport const one = 1;\n\nexport const two = () => 2;\n`;
const EDITOR_UTIL = `import a from 'a';\nexport const keep = 1;\n\nexport const dropped = () => 0;\n\nexport const last = 3;\n`;
const OURS_A = EDITOR_A;
const OURS_UTIL = `import b from './b';\nexport const keep = 1;\n\nexport const last = 3;\n`;

let tmp, editor, commit;
const git = (...args) =>
  execFileSync(
    "git",
    [
      "-C",
      editor,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.invalid",
      ...args,
    ],
    { encoding: "utf8" },
  );

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "midst-verbatim-"));
  editor = path.join(tmp, "editor");
  fs.mkdirSync(path.join(editor, "x"), { recursive: true });
  fs.writeFileSync(path.join(editor, "x", "a.ts"), EDITOR_A);
  fs.writeFileSync(path.join(editor, "x", "util.ts"), EDITOR_UTIL);
  git("init", "-q", "-b", "main");
  git("add", "x");
  git("commit", "-q", "-m", "editor");
  commit = git("rev-parse", "HEAD").trim();
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// A format root with the given contents of src/a.ts and src/convert.ts.
function run({ a = OURS_A, convert = OURS_UTIL, excluded = ["dropped"] } = {}) {
  const root = fs.mkdtempSync(path.join(tmp, "root-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "a.ts"), a);
  fs.writeFileSync(path.join(root, "src", "convert.ts"), convert);
  fs.writeFileSync(
    path.join(root, "src", "MOVED_FROM.json"),
    JSON.stringify({
      editorCommit: commit,
      files: { "src/a.ts": "x/a.ts", "src/convert.ts": "x/util.ts" },
      excludedFromConvert: excluded,
    }),
  );
  const r = spawnSync(process.execPath, [script, "--root", root], {
    encoding: "utf8",
    env: { ...process.env, MIDST_EDITOR_SRC: editor },
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

describe("the verbatim check", () => {
  it("passes when every statement is the editor's, whatever the imports", () => {
    const r = run();
    expect(r.out).toContain("verbatim OK: 2 files match");
    expect(r.status).toBe(0);
  });

  // The positive control.
  it("fails when one character of one statement changes, naming the statement and not its text", () => {
    const r = run({ a: OURS_A.replace("=> 2", "=> 3") });
    expect(r.status).toBe(1);
    expect(r.out).toContain("statement 1 (two) differs");
    expect(r.out).not.toContain("=> 3");
  });

  it("fails when only a comment on a statement changes", () => {
    const r = run({ a: OURS_A.replace(`keeps ${MARK}`, "keeps nothing") });
    expect(r.status).toBe(1);
    expect(r.out).toContain("statement 0 (one) differs");
    expect(r.out).not.toContain(MARK);
  });

  it("fails when a statement is added or removed", () => {
    expect(run({ a: `${OURS_A}export const three = 3;\n` }).status).toBe(1);
    expect(
      run({ a: OURS_A.replace("\nexport const two = () => 2;\n", "") }).status,
    ).toBe(1);
  });

  it("fails when a statement that should have been left out is still there", () => {
    const r = run({
      convert: OURS_UTIL.replace(
        "export const last",
        "export const dropped = () => 0;\n\nexport const last",
      ),
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain("statement counts differ");
  });

  it("fails when an excluded name is not in the editor file, since it would exclude nothing", () => {
    const r = run({ excluded: ["dropped", "neverThere"] });
    expect(r.status).toBe(1);
    expect(r.out).toContain(
      "excluded names not found in the editor file: neverThere",
    );
  });

  it("reports drift without failing on it", () => {
    const r = run();
    expect(r.out).toContain("drift: x/a.ts");
    expect(r.status).toBe(0);
  });
});
