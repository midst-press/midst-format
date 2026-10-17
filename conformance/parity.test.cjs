// parity.cjs must be able to say DIFFER. Stand-in converters stand where the editor's and the library's would, so
// the subject here is the comparison, not the converter. The inputs are the synthetic fixtures, read by verifyZip.
const path = require("path");
const { runParity, summarise, line } = require("./parity.cjs");
const { normalise } = require("./normalise.cjs");

const zips = [
  "synthetic--plain-typing",
  "synthetic--two-lines",
  "synthetic--tabs",
].map((n) =>
  path.join(__dirname, "..", "fixtures", "synthetic", `${n}.midst.zip`),
);
const run = (editorConvert, libConvert, inputs = zips) =>
  runParity(inputs, { editorConvert, libConvert, normalise });
const echo = (s) => `{"converted":${JSON.stringify(s)}}`;
const throwing = (name) => () => {
  const e = new Error("a message that must not matter");
  e.name = name;
  throw e;
};

describe("parity", () => {
  it("agrees when both converters give the same output for every input", () => {
    const results = run(echo, echo);
    expect(results.map((r) => r.agree)).toEqual([true, true, true]);
    expect(summarise(results).exitCode).toBe(0);
  });

  // The positive control: a converter that differs, even by one character, on one input only.
  it("says DIFFER for the one input on which the converters differ, and fails", () => {
    let calls = 0;
    const lib = (s) => (++calls === 2 ? echo(s) + " " : echo(s));
    const results = run(echo, lib);
    expect(results.map((r) => r.agree)).toEqual([true, false, true]);
    expect(results.map(line)).toEqual(["#01 agree", "#02 DIFFER", "#03 agree"]);
    expect(summarise(results)).toMatchObject({ differ: 1, exitCode: 1 });
  });

  it("compares the names of the errors when both throw", () => {
    expect(
      run(throwing("SyntaxError"), throwing("SyntaxError")).every(
        (r) => r.agree,
      ),
    ).toBe(true);
    expect(
      run(throwing("SyntaxError"), throwing("TypeError")).some((r) => r.agree),
    ).toBe(false);
  });

  it("says DIFFER when only one converter throws", () => {
    expect(run(echo, throwing("TypeError")).some((r) => r.agree)).toBe(false);
    expect(run(throwing("TypeError"), echo).some((r) => r.agree)).toBe(false);
  });

  it("counts an input that never reached the converter as DIFFER, and says so", () => {
    const results = run(echo, echo, [
      path.join(__dirname, "no-such-archive.midst.zip"),
    ]);
    expect(results).toEqual([{ index: 1, agree: false, compared: false }]);
    expect(summarise(results)).toMatchObject({
      differ: 1,
      notCompared: 1,
      exitCode: 1,
    });
  });

  it("fails when there is nothing to compare", () => {
    expect(summarise([]).exitCode).toBe(1);
  });

  it("prints an index and a verdict, nothing else", () => {
    for (const r of run(echo, echo))
      expect(line(r)).toMatch(/^#\d\d (agree|DIFFER)$/);
  });
});
