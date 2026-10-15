#!/usr/bin/env node
// Builds the verified text cache that tools/generate_long_midst.mjs reads. This is the ONLY place anything is
// downloaded. The nine Gutenberg volumes and the sha256 of the concatenated, normalised text are pinned in
// tools/clarissa_source.json; on a mismatch (Gutenberg can revise a file) nothing is written.
//
//   node tools/fetch_clarissa.mjs [--cache-dir <dir>] [--raw-dir <dir of v1.txt..v9.txt, instead of downloading>]
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MANIFEST = path.join(HERE, 'clarissa_source.json');
export const DEFAULT_CACHE = path.join(os.homedir(), 'ai/ClaudeInstanceHomeOffices/cora-2f1e43dc/midst-cache/clarissa');

export class FetchError extends Error {}

// One volume without its Gutenberg header and footer.
export function stripVolume(raw) {
  const t = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const start = /^\*\*\* START OF[^\n]*\n/m.exec(t);
  const end = /^\*\*\* END OF/m.exec(t);
  if (!start || !end || end.index < start.index) throw new FetchError('a volume has no "*** START OF" / "*** END OF" markers');
  return t.slice(start.index + start[0].length, end.index).trim();
}

export const assemble = (rawVolumes) => `${rawVolumes.map(stripVolume).join('\n\n')}\n`;
export const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

/**
 * Assemble the volumes, verify against the manifest's sha256, and only then write clarissa.txt and SOURCE.txt.
 *
 * @param {object} o
 * @param {string[]} o.rawVolumes Raw Gutenberg texts, in volume order.
 * @param {object} o.manifest Parsed clarissa_source.json.
 * @param {string} o.cacheDir Where clarissa.txt and SOURCE.txt go.
 * @returns {{text: string, sha256: string}}
 */
export function verifyAndWrite({ rawVolumes, manifest, cacheDir }) {
  if (rawVolumes.length !== manifest.volumes.length) throw new FetchError(`expected ${manifest.volumes.length} volumes, got ${rawVolumes.length}`);
  const text = assemble(rawVolumes);
  const got = sha256(text);
  if (got !== manifest.sha256) {
    throw new FetchError(`sha256 mismatch: the assembled text is ${got}, the manifest pins ${manifest.sha256}. Gutenberg may have revised a volume; nothing was written. Review the change, then update clarissa_source.json deliberately.`);
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'clarissa.txt'), text);
  const lines = manifest.volumes.map((v) => `vol ${v.volume}: ${v.url} (ebook ${v.ebook})`);
  fs.writeFileSync(path.join(cacheDir, 'SOURCE.txt'), `${manifest.title}\n${manifest.normalisation}\n${lines.join('\n')}\nclarissa.txt sha256: ${got} (verified against tools/clarissa_source.json)\n`);
  return { text, sha256: got };
}

async function main(argv) {
  let cacheDir = DEFAULT_CACHE;
  let rawDir = null;
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === '--cache-dir' && argv[i + 1]) cacheDir = argv[i + 1];
    else if (argv[i] === '--raw-dir' && argv[i + 1]) rawDir = argv[i + 1];
    else throw new FetchError(`unknown or incomplete option "${argv[i]}"`);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const rawVolumes = [];
  for (const v of manifest.volumes) {
    if (rawDir) {
      rawVolumes.push(fs.readFileSync(path.join(rawDir, `v${v.volume}.txt`), 'utf8'));
    } else {
      const res = await fetch(v.url);
      if (!res.ok) throw new FetchError(`${v.url}: HTTP ${res.status}`);
      rawVolumes.push(await res.text());
    }
  }
  const { text, sha256: h } = verifyAndWrite({ rawVolumes, manifest, cacheDir });
  console.log(`wrote ${path.join(cacheDir, 'clarissa.txt')}: ${text.length} characters, sha256 ${h} verified`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (e instanceof FetchError) {
      console.error(`fetch_clarissa: ${e.message}`);
      process.exit(2);
    }
    throw e;
  });
}
