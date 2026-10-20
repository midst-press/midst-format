// A conversion runs without yielding, so whatever it holds per frame it holds for the whole poem. TipTap 3's server
// build opened a happy-dom window per call and closed it asynchronously, and a real poem of thousands of frames ran
// out of memory at 4 GB (#102). The converter, bundled from source here, converts a long synthetic poem under a heap
// a few hundred frames of that would exhaust. No poem data: the frames are invented.
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const esbuild = require("esbuild");

const FRAMES = 3000;
const HEAP_MB = 256;

const poem = JSON.stringify({
  editorTimelineFrames: Array.from({ length: FRAMES }, (_, i) => ({
    content: Array.from(
      { length: 1 + (i % 40) },
      (_, k) => `<p>zq ${k}&nbsp;line\tof ${i}</p>`,
    ).join(""),
    lineNumber: i % 40,
    timestamp: 1600000000000 + i * 1000,
  })),
});

test(`a ${FRAMES}-frame poem converts within a ${HEAP_MB} MB heap`, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "many-frames-"));
  try {
    const converter = path.join(dir, "converter.cjs");
    esbuild.buildSync({
      entryPoints: [path.join(__dirname, "..", "src", "convert.ts")],
      outfile: converter,
      bundle: true,
      platform: "node",
      format: "cjs",
      logLevel: "error",
    });
    const input = path.join(dir, "poem.json");
    fs.writeFileSync(input, poem);
    const r = spawnSync(
      process.execPath,
      [
        `--max-old-space-size=${HEAP_MB}`,
        "-e",
        "const h = JSON.parse(require(process.argv[1]).convertMidstFile(require('fs').readFileSync(process.argv[2], 'utf8'))).history; process.stdout.write(String(h.length));",
        converter,
        input,
      ],
      { encoding: "utf8" },
    );
    // Only the last lines of stderr: a heap failure names itself there, and nothing in it is poem data.
    expect({ status: r.status, stderr: r.stderr.split("\n").slice(-4).join("\n") }).toEqual({ status: 0, stderr: "" });
    expect(r.stdout).toBe(String(FRAMES));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 120000);
