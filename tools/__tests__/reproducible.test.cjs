// reproducible.mjs must be able to say "differs": two directories that differ in one byte, one name, or one file.
const fs = require("fs"),
  os = require("os"),
  path = require("path");
const { execFileSync } = require("child_process");

const script = path.join(__dirname, "..", "reproducible.mjs");
const compare = (a, b) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { compareDirs } from ${JSON.stringify(script)}; console.log(JSON.stringify(compareDirs(${JSON.stringify(a)}, ${JSON.stringify(b)})))`,
      ],
      {
        encoding: "utf8",
      },
    ),
  );

describe("comparing two builds", () => {
  let tmp, a, b;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "midst-compare-"));
    [a, b] = ["a", "b"].map((d) => {
      fs.mkdirSync(path.join(tmp, d, "sub"), { recursive: true });
      fs.writeFileSync(path.join(tmp, d, "x.txt"), "same");
      fs.writeFileSync(path.join(tmp, d, "sub", "y.txt"), "same");
      return path.join(tmp, d);
    });
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("finds identical directories identical, files in subdirectories included", () => {
    expect(compare(a, b)).toEqual({ compared: 2, differing: [] });
  });

  it("finds a one-byte difference", () => {
    fs.writeFileSync(path.join(b, "sub", "y.txt"), "samf");
    expect(compare(a, b)).toEqual({
      compared: 2,
      differing: [path.join("sub", "y.txt")],
    });
  });

  it("finds a file in one directory and not the other", () => {
    fs.writeFileSync(path.join(b, "extra.txt"), "same");
    expect(compare(a, b).differing).toEqual(["extra.txt"]);
  });
});
