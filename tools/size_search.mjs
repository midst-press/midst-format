#!/usr/bin/env node
// By-hand driver for midst-editor #34: how long a poem do the editor and the web player cope with? It generates a
// long poem (tools/generate_long_midst.mjs), runs each app's opt-in e2e/size-limits.spec.ts on it, applies the
// PROVISIONAL thresholds below, and halves the length until a level passes everything. Nothing calls it: no workflow,
// no npm script.
//
//   node tools/size_search.mjs [--editor ../midst-editor] [--web ../midst-web] [--seed 1]
//                              [--results DIR] [--start 1] [--level-timeout-min 60] [--web-port 8197]
//                              [--no-rerun] [--keep-files]
//
// Both repos must be ready to run their e2e: the editor built (`npm run build`, Electron installed by
// `node tools/install-electron.cjs`), the web's dependencies installed. The driver starts the web's own
// `npm run e2e:serve` once (which builds the site and its synthetic fixtures) and the web spec reuses it.
//
// EVERY run's full output goes to a log file under the results dir; a failure prints the step, its own error text
// and the log path. Nothing is discarded.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FORMAT = path.resolve(HERE, '..');

// PROVISIONAL (Stuart's, until he changes them). Each is applied to its own measured number.
export const THRESHOLDS = {
  openMs: { max: 5000, label: 'editor open < 5 s' },
  keystrokeP95Ms: { max: 100, label: 'editor keystroke-to-DOM p95 < 100 ms' },
  saveMs: { max: 2000, label: 'editor save < 2 s' },
  // "Keep their set pace": achieved frame rate at least this share of the set rate.
  paceShare: { min: 0.9, label: 'achieved play rate >= 90% of set' },
  sliderMs: { max: 250, label: 'slider response p95 < 250 ms' },
};

// How many samples each spec is meant to take (the editor's KEYS and SLIDER_POSITIONS, the web's SCRUB_POSITIONS).
// A step that died part-way leaves fewer, and a p95 over the survivors must not pass.
export const EXPECTED_SAMPLES = { keys: 100, positions: 6 };

const usage = () => {
  console.error('usage: node tools/size_search.mjs [--editor DIR] [--web DIR] [--seed N] [--results DIR] [--start 1] ' +
    '[--level-timeout-min 60] [--web-port 8197] [--no-rerun] [--keep-files]');
  process.exit(2);
};

function parseArgs(argv) {
  const o = {
    editor: path.resolve(FORMAT, '../midst-editor'),
    web: path.resolve(FORMAT, '../midst-web'),
    seed: 1,
    results: null,
    start: '1',
    levelTimeoutMin: 60,
    webPort: 8197,
    rerun: true,
    keepFiles: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const val = () => {
      i += 1;
      if (argv[i] === undefined) usage();
      return argv[i];
    };
    if (a === '--editor') o.editor = path.resolve(val());
    else if (a === '--web') o.web = path.resolve(val());
    else if (a === '--seed') o.seed = Number(val());
    else if (a === '--results') o.results = path.resolve(val());
    else if (a === '--start') o.start = val();
    else if (a === '--level-timeout-min') o.levelTimeoutMin = Number(val());
    else if (a === '--web-port') o.webPort = Number(val());
    else if (a === '--no-rerun') o.rerun = false;
    else if (a === '--keep-files') o.keepFiles = true;
    else usage();
  }
  if (!Number.isFinite(o.seed) || !Number.isFinite(o.levelTimeoutMin) || !Number.isFinite(o.webPort)) usage();
  if (!o.results) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    // A per-user cache, never inside a repository: the generated poems run to a gigabyte.
    const cache = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
    o.results = path.join(cache, 'midst-format', 'size-search', stamp);
  }
  return o;
}

const fractionLevels = (start) => {
  const m = /^(\d+)(?:\/(\d+))?$/.exec(start);
  if (!m) throw new Error(`--start must be 1, 1/2, 1/4, ...; got "${start}"`);
  const first = Number(m[2] ?? 1) / Number(m[1]);
  if (!Number.isInteger(first) || first < 1) throw new Error(`--start must be 1, 1/2, 1/4, ...; got "${start}"`);
  return first;
};
const fractionString = (denominator) => (denominator === 1 ? '1' : `1/${denominator}`);

// Run a command with all output in a log file. Resolves with the exit status, never throws; a timeout kills the
// whole process group and says so in the log.
function run(cmd, args, { cwd, env, log, timeoutMs }) {
  return new Promise((resolve) => {
    const fd = fs.openSync(log, 'a');
    fs.writeSync(fd, `\n$ (cd ${cwd}) ${cmd} ${args.join(' ')}\n`);
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', fd, fd], detached: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      fs.writeSync(fd, `\n[size_search] TIMEOUT after ${Math.round(timeoutMs / 1000)} s: killing the process group\n`);
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (e) {
        fs.writeSync(fd, `[size_search] kill failed: ${e.message}\n`);
      }
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      fs.writeSync(fd, `[size_search] could not start ${cmd}: ${e.message}\n`);
      fs.closeSync(fd);
      resolve({ code: null, signal: null, timedOut, error: e.message });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      fs.closeSync(fd);
      resolve({ code, signal, timedOut });
    });
  });
}

const readLogTail = (log, n = 25) => {
  const lines = fs.readFileSync(log, 'utf8').split('\n');
  return lines.slice(-n).join('\n');
};

function httpStatus(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function startWebServer(o, env) {
  if ((await httpStatus(o.webPort)) !== null) {
    throw new Error(`port ${o.webPort} already answers: pick another with --web-port (this driver will not reuse a server it did not start)`);
  }
  const log = path.join(o.results, 'web-server.log');
  const fd = fs.openSync(log, 'a');
  const child = spawn('npm', ['run', 'e2e:serve'], {
    cwd: o.web, env: { ...env, MIDST_E2E_PORT: String(o.webPort) }, stdio: ['ignore', fd, fd], detached: true,
  });
  let exited = null;
  child.on('close', (code) => { exited = code; });
  const stop = () => {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch (e) {
      if (e.code !== 'ESRCH') console.error(`could not stop the web server (pid ${child.pid}): ${e.message}`);
    }
  };
  const deadline = Date.now() + 15 * 60_000;
  for (;;) {
    // A server that never became ready is stopped before the error goes up, so it does not keep the port.
    if (exited !== null) {
      stop();
      throw new Error(`the web server exited with ${exited} before it was ready; log: ${log}\n${readLogTail(log)}`);
    }
    if (Date.now() > deadline) {
      stop();
      throw new Error(`the web server was not ready after 15 min; log: ${log}\n${readLogTail(log)}`);
    }
    // eslint-disable-next-line no-await-in-loop
    if ((await httpStatus(o.webPort)) === 200) break;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 2000); });
  }
  return stop;
}

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const round = (x, d = 1) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);

// Pull the numbers the thresholds read out of the two result files. Anything missing is null, and a null fails.
export function judge(ed, wb) {
  const es = ed?.steps ?? {};
  const ws = wb?.steps ?? {};
  const erep = es.replay ?? {};
  const wpl = ws.play ?? {};
  const m = {
    editorOpenMs: num(es.openMs),
    // Thresholds read the DOM numbers ("the editor DOM showing it"); the screen numbers include a ~50 ms floor from
    // the animation-frame timer in this setup and are reported beside them.
    editorKeystrokeDomP50Ms: num(es.keystrokeDomMs?.p50),
    editorKeystrokeDomP95Ms: num(es.keystrokeDomMs?.p95),
    editorKeystrokeDomMaxMs: num(es.keystrokeDomMs?.max),
    editorKeystrokeScreenP95Ms: num(es.keystrokeScreenMs?.p95),
    editorSaveMs: num(es.saveMs),
    editorSavePrepMs: num(es.savePrepMs),
    editorSaveFromTimerMs: num(es.saveFromTimerMs),
    editorStoreConfigMB: es.storeConfigBytes ? round(es.storeConfigBytes / 1e6) : null,
    replayOpenMs: num(erep.openMs),
    replaySetFps: num(erep.setFps),
    replayAchievedFps: num(erep.achievedFps),
    replaySliderP50Ms: num(erep.sliderDomMs?.p50),
    replaySliderP95Ms: num(erep.sliderDomMs?.p95),
    replaySliderMaxMs: num(erep.sliderDomMs?.max),
    replaySliderScreenP95Ms: num(erep.sliderScreenMs?.p95),
    webLoadMs: num(ws.loadMs),
    webSetFps: num(wpl.setFps),
    webAchievedFps: num(wpl.achievedFps),
    webScrubP50Ms: num(ws.scrubDomMs?.p50),
    webScrubP95Ms: num(ws.scrubDomMs?.p95),
    webScrubMaxMs: num(ws.scrubDomMs?.max),
    webScrubScreenP95Ms: num(ws.scrubScreenMs?.p95),
  };
  const lt = (v, max) => v !== null && v < max;
  const full = (d, n) => typeof d?.n === 'number' && d.n >= n;
  const clean = (r) => !!r && Array.isArray(r.failures) && r.failures.length === 0;
  const pace = (a, s) => a !== null && s !== null && a >= THRESHOLDS.paceShare.min * s;
  const crashed = (r) => !r || r.failures?.some((f) => f.step === 'crash' || f.step === 'harness');
  const checks = {
    editorOpen: lt(m.editorOpenMs, THRESHOLDS.openMs.max),
    editorKeystroke: lt(m.editorKeystrokeDomP95Ms, THRESHOLDS.keystrokeP95Ms.max) && full(es.keystrokeDomMs, EXPECTED_SAMPLES.keys),
    editorSave: lt(m.editorSaveMs, THRESHOLDS.saveMs.max),
    replayPace: pace(m.replayAchievedFps, m.replaySetFps),
    replaySlider: lt(m.replaySliderP95Ms, THRESHOLDS.sliderMs.max) && full(erep.sliderDomMs, EXPECTED_SAMPLES.positions),
    webPace: pace(m.webAchievedFps, m.webSetFps),
    webScrub: lt(m.webScrubP95Ms, THRESHOLDS.sliderMs.max) && full(ws.scrubDomMs, EXPECTED_SAMPLES.positions),
    editorNoCrash: !crashed(ed),
    webNoCrash: !crashed(wb),
    // Any recorded failure fails the level, whichever step it was in.
    editorNoFailures: clean(ed),
    webNoFailures: clean(wb),
  };
  return { measures: m, checks, pass: Object.values(checks).every(Boolean) };
}

// A spec that exited non-zero, wrote no result, or ran out of time fails the level even if its numbers look fine.
export const levelPasses = (judgement, errors) => judgement.pass && errors.length === 0;

function machine(edResult, wbResult) {
  const cpus = os.cpus();
  let npm = 'unknown';
  try {
    npm = execFileSync('npm', ['-v'], { encoding: 'utf8' }).trim();
  } catch (e) {
    npm = `could not run npm -v: ${e.message}`;
  }
  return {
    os: `${os.type()} ${os.release()} (${os.platform()}/${os.arch()})`,
    cpu: `${cpus[0]?.model} x${cpus.length}`,
    ramGB: Math.round(os.totalmem() / 2 ** 30),
    node: process.version,
    npm,
    electron: edResult?.versions?.electron ?? 'unknown (editor run produced no versions)',
    electronChromium: edResult?.versions?.chromium ?? 'unknown',
    playwrightChromium: wbResult?.browser ?? 'unknown',
  };
}

async function runLevel(o, env, denominator) {
  const fraction = fractionString(denominator);
  const dir = path.join(o.results, `level-1_${denominator}`);
  fs.mkdirSync(dir, { recursive: true });
  const poem = path.join(dir, 'poem.midst');
  const deadline = Date.now() + o.levelTimeoutMin * 60_000;
  const level = { fraction, denominator, dir, errors: [] };
  const fail = (step, text, log) => {
    level.errors.push({ step, text, log });
    console.error(`\nFAILED at level ${fraction}: ${step}\n${text}\nlog: ${log}`);
  };

  const genLog = path.join(dir, 'generate.log');
  const g = await run('node', ['tools/generate_long_midst.mjs', '--seed', String(o.seed), '--fraction', fraction, '--out', poem],
    { cwd: FORMAT, env, log: genLog, timeoutMs: o.levelTimeoutMin * 60_000 });
  const gen = /chars=(\d+) entries=(\d+) bytes=(\d+) seconds=([\d.]+) text=pinned/.exec(fs.existsSync(genLog) ? fs.readFileSync(genLog, 'utf8') : '');
  if (g.code !== 0 || !gen) {
    fail('generate', `exit ${g.code}${g.timedOut ? ' (timeout)' : ''}\n${readLogTail(genLog)}`, genLog);
    level.pass = false;
    level.generateFailed = true;
    return level;
  }
  Object.assign(level, { chars: Number(gen[1]), entries: Number(gen[2]), bytes: Number(gen[3]), generateSeconds: Number(gen[4]) });

  const specs = [
    { name: 'web', repo: o.web, extra: { MIDST_E2E_PORT: String(o.webPort), MIDST_KEY_SCHEME: 'legacy', MIDST_POEM_LIST: 'bundled' } },
    { name: 'editor', repo: o.editor, extra: {} },
  ];
  const results = {};
  for (const s of specs) {
    const log = path.join(dir, `${s.name}.log`);
    const result = path.join(dir, `${s.name}.json`);
    const left = deadline - Date.now();
    if (left <= 0) {
      fail(`${s.name} spec`, `level timeout of ${o.levelTimeoutMin} min used up before this spec started`, log);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const r = await run('npx', ['playwright', 'test', 'e2e/size-limits.spec.ts', '--output', path.join(dir, `${s.name}-pw-output`)], {
      cwd: s.repo,
      env: { ...env, ...s.extra, MIDST_SIZE_FILE: poem, MIDST_SIZE_RESULT: result },
      log,
      timeoutMs: left,
    });
    if (fs.existsSync(result)) {
      try {
        results[s.name] = JSON.parse(fs.readFileSync(result, 'utf8'));
      } catch (e) {
        fail(`${s.name} result unreadable`, e.message, result);
      }
    }
    if (r.code !== 0 || !results[s.name]) {
      const fs2 = results[s.name]?.failures ?? [];
      const text = results[s.name]
        ? fs2.map((f) => `  ${f.step}: ${f.reason}`).join('\n')
        : `no result file written (${r.timedOut ? 'timed out' : `exit ${r.code} signal ${r.signal}`}); end of the log:\n${readLogTail(log)}`;
      fail(`${s.name} spec`, text || `exit ${r.code} with no recorded failure`, log);
    }
  }
  Object.assign(level, { editor: results.editor, web: results.web });
  const j = judge(results.editor, results.web);
  Object.assign(level, j);
  level.pass = levelPasses(j, level.errors);
  if (!o.keepFiles) {
    try {
      fs.unlinkSync(poem);
    } catch (e) {
      console.error(`could not delete ${poem}: ${e.message}`);
    }
  }
  return level;
}

const fmt = (v, d = 0) => (v === null || v === undefined ? 'n/a' : Number(v).toFixed(d));
const mark = (b) => (b ? 'pass' : 'FAIL');

function markdown(o, levels, summary, mach) {
  const rows = [
    ['fraction', (l) => l.fraction],
    ['characters', (l) => (l.chars ?? 'n/a').toLocaleString?.('en') ?? l.chars],
    ['history entries', (l) => (l.entries ?? 'n/a').toLocaleString?.('en') ?? l.entries],
    ['file MB', (l) => fmt(l.bytes / 1e6, 1)],
    ['editor open ms', (l) => fmt(l.measures?.editorOpenMs)],
    ['  open < 5 s', (l) => mark(l.checks?.editorOpen)],
    ['editor key->DOM p50/p95/max ms (screen p95)', (l) => `${fmt(l.measures?.editorKeystrokeDomP50Ms, 1)} / ${fmt(l.measures?.editorKeystrokeDomP95Ms, 1)} / ${fmt(l.measures?.editorKeystrokeDomMaxMs, 1)} (${fmt(l.measures?.editorKeystrokeScreenP95Ms, 1)})`],
    ['  keystroke DOM p95 < 100 ms', (l) => mark(l.checks?.editorKeystroke)],
    ['editor save ms (renderer prep before send; store config MB)', (l) => `${fmt(l.measures?.editorSaveMs)} (${fmt(l.measures?.editorSavePrepMs)}; ${fmt(l.measures?.editorStoreConfigMB, 1)})`],
    ['  save < 2 s', (l) => mark(l.checks?.editorSave)],
    ['replay open ms', (l) => fmt(l.measures?.replayOpenMs)],
    ['replay fps achieved / set', (l) => `${fmt(l.measures?.replayAchievedFps, 2)} / ${fmt(l.measures?.replaySetFps, 2)}`],
    ['  replay pace', (l) => mark(l.checks?.replayPace)],
    ['replay slider p50/p95/max ms', (l) => `${fmt(l.measures?.replaySliderP50Ms)} / ${fmt(l.measures?.replaySliderP95Ms)} / ${fmt(l.measures?.replaySliderMaxMs)} (screen p95 ${fmt(l.measures?.replaySliderScreenP95Ms)})`],
    ['  replay slider < 250 ms', (l) => mark(l.checks?.replaySlider)],
    ['web load ms (no threshold)', (l) => fmt(l.measures?.webLoadMs)],
    ['web fps achieved / set', (l) => `${fmt(l.measures?.webAchievedFps, 2)} / ${fmt(l.measures?.webSetFps, 2)}`],
    ['  web pace', (l) => mark(l.checks?.webPace)],
    ['web scrub p50/p95/max ms', (l) => `${fmt(l.measures?.webScrubP50Ms)} / ${fmt(l.measures?.webScrubP95Ms)} / ${fmt(l.measures?.webScrubMaxMs)} (screen p95 ${fmt(l.measures?.webScrubScreenP95Ms)})`],
    ['  web scrub < 250 ms', (l) => mark(l.checks?.webScrub)],
    ['  editor no crash', (l) => mark(l.checks?.editorNoCrash)],
    ['  web no crash', (l) => mark(l.checks?.webNoCrash)],
    ['  editor: no step failed', (l) => mark(l.checks?.editorNoFailures)],
    ['  web: no step failed', (l) => mark(l.checks?.webNoFailures)],
    ['editor failures (steps)', (l) => (l.editor?.failures ?? []).map((f) => f.step).join(', ') || (l.editor ? 'none' : 'no result')],
    ['web failures (steps)', (l) => (l.web?.failures ?? []).map((f) => f.step).join(', ') || (l.web ? 'none' : 'no result')],
    ['LEVEL', (l) => (l.pass ? 'PASS' : 'FAIL')],
  ];
  const head = `| measure | ${levels.map((l) => `${l.fraction}${l.rerunOf ? ' (rerun)' : ''}`).join(' | ')} |`;
  const sep = `|---|${levels.map(() => '---').join('|')}|`;
  const body = rows.map(([name, f]) => `| ${name} | ${levels.map((l) => f(l)).join(' | ')} |`);
  const failed = levels.filter((l) => l.errors.length)
    .map((l) => `- ${l.fraction}${l.rerunOf ? ' (rerun)' : ''}: ${l.errors.map((e) => `${e.step} [log ${e.log}]`).join('; ')}`);
  return [
    '# Midst size search', '',
    `Run ${new Date().toISOString()}, seed ${o.seed}. Thresholds are provisional (Stuart's).`, '',
    `Machine: ${mach.os}; ${mach.cpu}; ${mach.ramGB} GB RAM; node ${mach.node}; npm ${mach.npm}; Electron ${mach.electron} (Chromium ${mach.electronChromium}); Playwright Chromium ${mach.playwrightChromium}.`, '',
    head, sep, ...body, '',
    `Largest passing level: ${summary.largestPassing ?? 'none'}. Smallest failing level: ${summary.smallestFailing ?? 'none'}.`,
    summary.rerun ? `Rerun of the smallest failing level (${summary.smallestFailing}): ${summary.rerun.pass ? 'PASSED this time (flaky)' : 'failed again'}.` : '',
    '', 'Failure reasons (first 300 characters each):', ...levels.flatMap((l) => ['editor', 'web'].flatMap((a) => (l[a]?.failures ?? []).map((f) => `- ${l.fraction}${l.rerunOf ? ' (rerun)' : ''} ${a} ${f.step}: ${String(f.reason).replace(/\s+/g, ' ').slice(0, 300)}`))), '',
    failed.length ? `Errors:\n${failed.join('\n')}` : 'No step errors.', '',
    `Results dir: ${o.results}`,
  ].join('\n');
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  for (const [name, dir] of [['editor', o.editor], ['web', o.web]]) {
    if (!fs.existsSync(path.join(dir, 'e2e', 'size-limits.spec.ts'))) {
      console.error(`${name} repo ${dir} has no e2e/size-limits.spec.ts (wrong path, or the wrong branch)`);
      process.exit(2);
    }
  }
  fs.mkdirSync(o.results, { recursive: true });
  const env = { ...process.env };
  delete env.CI;
  console.error(`results: ${o.results}`);

  const stopServer = await startWebServer(o, { ...env, MIDST_KEY_SCHEME: 'legacy', MIDST_POEM_LIST: 'bundled' });
  const levels = [];
  // smallestFailing is the boundary: the level just above the largest that passed.
  const summary = { largestPassing: null, smallestFailing: null, rerun: null };
  try {
    let denominator = fractionLevels(o.start);
    for (;;) {
      console.error(`\n=== level ${fractionString(denominator)} ===`);
      // eslint-disable-next-line no-await-in-loop
      const level = await runLevel(o, env, denominator);
      levels.push(level);
      console.error(`level ${level.fraction}: ${level.pass ? 'PASS' : 'FAIL'} ${JSON.stringify(level.checks ?? {})}`);
      if (level.pass) {
        summary.largestPassing = level.fraction;
        break;
      }
      summary.smallestFailing = level.fraction;
      if (level.generateFailed || denominator >= 2 ** 20) {
        console.error('stopping: nothing smaller to try');
        break;
      }
      denominator *= 2;
    }
    // Rerun the failing level next to the boundary: if it passes the second time, the boundary is not where it looks.
    if (o.rerun && summary.smallestFailing) {
      const d = levels.filter((l) => !l.pass).at(-1).denominator;
      console.error(`\n=== rerun of the smallest failing level ${fractionString(d)} ===`);
      const again = await runLevel({ ...o, results: path.join(o.results, 'rerun') }, env, d);
      again.rerunOf = fractionString(d);
      again.fraction = fractionString(d);
      levels.push(again);
      summary.rerun = { pass: again.pass, checks: again.checks };
    }
  } finally {
    stopServer();
  }

  const lastOk = levels.findLast((l) => l.editor || l.web) ?? levels[0];
  const mach = machine(lastOk?.editor, lastOk?.web);
  const out = { machine: mach, thresholds: THRESHOLDS, summary, levels };
  fs.writeFileSync(path.join(o.results, 'results.json'), JSON.stringify(out, null, 2));
  const md = markdown(o, levels, summary, mach);
  fs.writeFileSync(path.join(o.results, 'results.md'), md);
  console.log(md);
  process.exit(summary.largestPassing ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`size_search failed: ${e.stack || e.message}`);
    process.exit(1);
  });
}
