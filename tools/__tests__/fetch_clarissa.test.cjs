/**
 * @jest-environment node
 */
// tools/fetch_clarissa.mjs: the text cache is only ever written from volumes that hash to the pinned value. No network:
// tiny INVENTED volumes, and a manifest whose hash is either right for them or deliberately wrong.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const esbuild = require('esbuild');

const SOURCE = path.join(__dirname, '..', 'fetch_clarissa.mjs');
const MANIFEST = path.join(__dirname, '..', 'clarissa_source.json');
let work;
let tool;

const volume = (n) => `﻿Header of invented volume ${n}\r\n*** START OF THE PROJECT GUTENBERG EBOOK INVENTED ***\r\n\r\nFirst paragraph ${n}.\r\n\r\nSecond & third <paragraph> ${n}.\r\n\r\n*** END OF THE PROJECT GUTENBERG EBOOK INVENTED ***\r\nFooter ${n}\r\n`;
const EXPECTED = (n) => `First paragraph ${n}.\n\nSecond & third <paragraph> ${n}.`;

beforeAll(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fetchclar-')));
  const bundle = path.join(work, 'tool.cjs');
  esbuild.buildSync({
    entryPoints: [SOURCE], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent',
    define: { 'import.meta.url': JSON.stringify(pathToFileURL(SOURCE).href) },
  });
  tool = require(bundle);
});
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

const manifestFor = (raws, sha) => ({
  title: 'invented', normalisation: 'n/a', sha256: sha ?? tool.sha256(tool.assemble(raws)),
  volumes: raws.map((_, i) => ({ volume: i + 1, ebook: i, url: `https://example.invalid/${i}` })),
});

test('stripVolume drops BOM, header, footer and CRLF', () => {
  expect(tool.stripVolume(volume(1))).toBe(EXPECTED(1));
});
test('a volume without Gutenberg markers is refused', () => {
  expect(() => tool.stripVolume('just text')).toThrow(/START OF/);
});
test('assemble joins volumes by one blank line and ends with one newline', () => {
  expect(tool.assemble([volume(1), volume(2)])).toBe(`${EXPECTED(1)}\n\n${EXPECTED(2)}\n`);
});

test('a text that hashes to the pinned value is written, with SOURCE.txt', () => {
  const raws = [volume(1), volume(2)];
  const dir = path.join(work, 'ok');
  const r = tool.verifyAndWrite({ rawVolumes: raws, manifest: manifestFor(raws), cacheDir: dir });
  expect(fs.readFileSync(path.join(dir, 'clarissa.txt'), 'utf8')).toBe(tool.assemble(raws));
  expect(fs.readFileSync(path.join(dir, 'SOURCE.txt'), 'utf8')).toContain(r.sha256);
});

test('a wrong hash is refused and nothing is written', () => {
  const raws = [volume(1), volume(2)];
  const dir = path.join(work, 'wrong');
  expect(() => tool.verifyAndWrite({ rawVolumes: raws, manifest: manifestFor(raws, 'f'.repeat(64)), cacheDir: dir })).toThrow(/sha256 mismatch/);
  expect(fs.existsSync(dir)).toBe(false);
});

test('a revised volume (one character changed) no longer verifies', () => {
  const raws = [volume(1), volume(2)];
  const manifest = manifestFor(raws);
  const dir = path.join(work, 'revised');
  expect(() => tool.verifyAndWrite({ rawVolumes: [raws[0], raws[1].replace('third', 'thirds')], manifest, cacheDir: dir })).toThrow(/sha256 mismatch/);
  expect(fs.existsSync(dir)).toBe(false);
});

test('the wrong number of volumes is refused', () => {
  const raws = [volume(1), volume(2)];
  expect(() => tool.verifyAndWrite({ rawVolumes: [raws[0]], manifest: manifestFor(raws), cacheDir: path.join(work, 'few') })).toThrow(/expected 2 volumes/);
});

test('the command line, given invented volumes, refuses against the real pinned hash and leaves the cache empty', () => {
  const raw = path.join(work, 'raw');
  fs.mkdirSync(raw);
  for (let i = 1; i <= 9; i += 1) fs.writeFileSync(path.join(raw, `v${i}.txt`), volume(i));
  const cache = path.join(work, 'cli-cache');
  const r = spawnSync('node', [SOURCE, '--raw-dir', raw, '--cache-dir', cache], { encoding: 'utf8' });
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/sha256 mismatch/);
  expect(fs.existsSync(cache)).toBe(false);
});

test('the committed manifest pins nine volumes, their URLs and a sha256', () => {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  expect(m.volumes.map((v) => v.volume)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  m.volumes.forEach((v) => expect(v.url).toBe(`https://www.gutenberg.org/cache/epub/${v.ebook}/pg${v.ebook}.txt`));
  expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
});
