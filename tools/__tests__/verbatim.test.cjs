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
// A file of a later move, committed after the first move's files were deleted from the editor.
const EDITOR_B = `export const b = 'b';\n`;

let tmp, editor, commit, laterCommit;
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
  // The editor then drops the first move's files and gains another, as it did after #50.
  git("rm", "-q", "x/a.ts", "x/util.ts");
  fs.mkdirSync(path.join(editor, "x"), { recursive: true });
  fs.writeFileSync(path.join(editor, "x", "b.ts"), EDITOR_B);
  git("add", "x");
  git("commit", "-q", "-m", "later");
  laterCommit = git("rev-parse", "HEAD").trim();
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Two moves, as MOVED_FROM.json holds them: a.ts and convert.ts from the first commit, b.ts from the later one.
const moves = (excluded, later = laterCommit) => ({
  moves: [
    {
      editorCommit: commit,
      files: { "src/a.ts": "x/a.ts", "src/convert.ts": "x/util.ts" },
      excludedFromConvert: excluded,
    },
    { editorCommit: later, files: { "src/b.ts": "x/b.ts" } },
  ],
});

// A format root with the given contents of src/a.ts, src/convert.ts and src/b.ts.
function run({
  a = OURS_A,
  convert = OURS_UTIL,
  b = EDITOR_B,
  excluded = ["dropped"],
  movedFrom,
} = {}) {
  const root = fs.mkdtempSync(path.join(tmp, "root-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "a.ts"), a);
  fs.writeFileSync(path.join(root, "src", "convert.ts"), convert);
  fs.writeFileSync(path.join(root, "src", "b.ts"), b);
  fs.writeFileSync(
    path.join(root, "src", "MOVED_FROM.json"),
    JSON.stringify(movedFrom ?? moves(excluded)),
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
    expect(r.out).toContain("verbatim OK: 3 files match");
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

  // The first move's files are gone at the later commit, so reading every file at one commit cannot pass.
  it("reads each file at its own move's commit", () => {
    const r = run();
    expect(r.out).toContain(`src/a.ts <- x/a.ts at ${commit}`);
    expect(r.out).toContain(`src/b.ts <- x/b.ts at ${laterCommit}`);
    const oneCommit = run({ movedFrom: moves(["dropped"], commit) });
    expect(oneCommit.status).toBe(1);
  });

  it("fails when a file of a later move changes", () => {
    const r = run({ b: EDITOR_B.replace("'b'", "'c'") });
    expect(r.status).toBe(1);
    expect(r.out).toContain("statement 0 (b) differs");
  });

  it("fails when a move names no editor commit", () => {
    const m = moves(["dropped"]);
    delete m.moves[1].editorCommit;
    const r = run({ movedFrom: m });
    expect(r.status).toBe(1);
    expect(r.out).toContain("names no editor commit for src/b.ts");
  });

  // The shape before moves: one commit for every file. Read now, it lists nothing, and must not pass.
  it("fails on a MOVED_FROM.json with no moves", () => {
    const r = run({
      movedFrom: {
        editorCommit: commit,
        files: { "src/a.ts": "x/a.ts" },
      },
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain("MOVED_FROM.json lists no files");
  });
});
