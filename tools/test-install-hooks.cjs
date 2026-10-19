// tools/install-hooks.cjs: a clone cannot be left without its git hooks.
//
//     node --test tools/test-install-hooks.cjs
//
// node:test, not jest, so the same file runs here, where there is no jest, and in each repository that copies
// it (midst-infra #37). It builds stand-in clones in a temporary directory and runs git in them.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A commit hook runs with variables git sets for the repository being committed to (GIT_INDEX_FILE among them).
// Left in, git would read this repository's index inside the stand-in clones, so the tests would pass in CI and
// fail on a real commit. All of them go, not a list of known ones (as tools/unittest_without_git_env.sh does).
Object.keys(process.env)
  .filter((name) => name.startsWith('GIT_'))
  .forEach((name) => delete process.env[name]);

const { ensureHooks, missingHooks, MARK } = require('./install-hooks.cjs');

const SCRIPT = path.join(__dirname, 'install-hooks.cjs');
let work;
let repo;
let fakeBin;
let emptyBin;
let gitOnlyBin;

// A stand-in for pre-commit: `pre-commit install` writes the three hooks the way the real one marks
// them. FAKE_PRECOMMIT=one writes only the first; FAKE_PRECOMMIT=fail writes nothing and fails.
const FAKE = `#!/bin/sh
[ "$FAKE_PRECOMMIT" = fail ] && { echo "Cowardly refusing to install hooks" >&2; exit 1; }
hooks=$(git rev-parse --git-path hooks)
mkdir -p "$hooks"
echo "# ${MARK}" > "$hooks/pre-commit"
[ "$FAKE_PRECOMMIT" = one ] || echo "# ${MARK}" > "$hooks/commit-msg"
[ "$FAKE_PRECOMMIT" = one ] || echo "# ${MARK}" > "$hooks/pre-push"
`;

const which = (name) => spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();

beforeEach(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-')));
  repo = path.join(work, 'repo');
  fakeBin = path.join(work, 'bin');
  emptyBin = path.join(work, 'empty');
  gitOnlyBin = path.join(work, 'git-only');
  [repo, fakeBin, emptyBin, gitOnlyBin].forEach((dir) => fs.mkdirSync(dir));
  fs.writeFileSync(path.join(fakeBin, 'pre-commit'), FAKE, { mode: 0o755 });
  // git and nothing else: the command needs git to find its clone, and must not find a pre-commit.
  fs.symlinkSync(which('git'), path.join(gitOnlyBin, 'git'));
  spawnSync('git', ['init', '-q'], { cwd: repo });
});
afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

// The environment a contributor has: not CI, with the stand-in pre-commit first on PATH.
const withFake = (extra = {}) => ({
  PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
  ...extra,
});
const hook = (name) => path.join(repo, '.git', 'hooks', name);

describe('missingHooks', () => {
  it('names all three hooks in a new clone', () => {
    assert.deepEqual(missingHooks(repo), ['pre-commit', 'commit-msg', 'pre-push']);
  });

  it('does not count a hook that pre-commit did not write', () => {
    fs.mkdirSync(path.dirname(hook('pre-commit')), { recursive: true });
    fs.writeFileSync(hook('pre-commit'), '#!/bin/sh\nexit 0\n');
    assert.ok(missingHooks(repo).includes('pre-commit'));
  });
});

describe('ensureHooks', () => {
  it('installs all three in a clone that has none, and says so', () => {
    assert.deepEqual(ensureHooks(repo, { env: withFake() }), {
      ok: true,
      message: 'Installed the git hooks: pre-commit, commit-msg, pre-push.',
    });
    assert.deepEqual(missingHooks(repo), []);
  });

  it('says nothing and changes nothing when all three are already installed', () => {
    ensureHooks(repo, { env: withFake() });
    const before = fs.statSync(hook('pre-commit')).mtimeMs;
    assert.deepEqual(ensureHooks(repo, { env: { PATH: emptyBin } }), { ok: true, message: '' });
    assert.equal(fs.statSync(hook('pre-commit')).mtimeMs, before);
  });

  it('installs the one that is missing when only one is', () => {
    ensureHooks(repo, { env: withFake() });
    fs.rmSync(hook('commit-msg'));
    assert.equal(ensureHooks(repo, { env: withFake() }).message, 'Installed the git hooks: commit-msg.');
    assert.deepEqual(missingHooks(repo), []);
  });

  it('fails, and says how to get pre-commit, when it is not on PATH', () => {
    const result = ensureHooks(repo, { env: { PATH: emptyBin } });
    assert.equal(result.ok, false);
    assert.match(result.message, /pre-commit was not found/);
    assert.match(result.message, /brew install pre-commit/);
    assert.equal(missingHooks(repo).length, 3);
  });

  it('fails with pre-commit’s own words when the install fails', () => {
    const result = ensureHooks(repo, { env: withFake({ FAKE_PRECOMMIT: 'fail' }) });
    assert.equal(result.ok, false);
    assert.match(result.message, /Cowardly refusing/);
  });

  it('fails when the install leaves a hook missing, naming it', () => {
    const result = ensureHooks(repo, { env: withFake({ FAKE_PRECOMMIT: 'one' }) });
    assert.equal(result.ok, false);
    assert.match(result.message, /missing: commit-msg, pre-push/);
  });

  it('with checkOnly, installs nothing and says what to run', () => {
    const result = ensureHooks(repo, { env: withFake(), checkOnly: true });
    assert.equal(result.ok, false);
    assert.match(result.message, /missing: pre-commit, commit-msg, pre-push/);
    assert.match(result.message, /node tools\/install-hooks\.cjs/);
    assert.equal(missingHooks(repo).length, 3);
  });

  it('does nothing in CI, which runs the checks itself', () => {
    assert.deepEqual(ensureHooks(repo, { env: withFake({ CI: 'true' }) }), { ok: true, message: '' });
    assert.equal(missingHooks(repo).length, 3);
  });

  it('does nothing where there is no clone', () => {
    const plain = path.join(work, 'plain');
    fs.mkdirSync(plain);
    // GIT_CEILING_DIRECTORIES is not needed: the temporary directory is outside any repository.
    assert.deepEqual(ensureHooks(plain, { env: withFake() }), { ok: true, message: '' });
  });

  it('does nothing in a directory that is inside some other repository', () => {
    const inner = path.join(repo, 'vendored');
    fs.mkdirSync(inner);
    assert.deepEqual(ensureHooks(inner, { env: withFake() }), { ok: true, message: '' });
    assert.equal(missingHooks(repo).length, 3);
  });

  it('installs into the shared hooks directory from a worktree', () => {
    const run = (args) => spawnSync('git', args, { cwd: repo });
    run(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'first']);
    const tree = path.join(work, 'tree');
    run(['worktree', 'add', '-q', tree]);
    assert.equal(ensureHooks(tree, { env: withFake() }).ok, true);
    assert.deepEqual(missingHooks(tree), []);
    assert.deepEqual(missingHooks(repo), []);
  });
});

describe('the command', () => {
  // The command checks the clone it lives in, so these run a copy of it placed in the stand-in clone.
  const runCopy = (args, env) => {
    fs.mkdirSync(path.join(repo, 'tools'));
    const copy = path.join(repo, 'tools', 'install-hooks.cjs');
    fs.copyFileSync(SCRIPT, copy);
    return spawnSync(process.execPath, [copy, ...args], { encoding: 'utf8', env });
  };

  it('installs the hooks, says so on stdout, and exits 0', () => {
    const result = runCopy([], withFake());
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'Installed the git hooks: pre-commit, commit-msg, pre-push.\n');
    assert.equal(result.stderr, '');
  });

  it('when it cannot install them, exits 1 and prints why on stderr', () => {
    const result = runCopy([], { PATH: gitOnlyBin });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /pre-commit was not found/);
    assert.match(result.stderr, /brew install pre-commit/);
    assert.equal(result.stdout, '');
  });

  it('when the install fails, exits 1 and prints pre-commit’s own words on stderr', () => {
    const result = runCopy([], withFake({ FAKE_PRECOMMIT: 'fail' }));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Cowardly refusing/);
    assert.equal(result.stdout, '');
  });

  it('with --check and the hooks missing, installs nothing, exits 1 and prints what is missing on stderr', () => {
    const result = runCopy(['--check'], withFake());
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing: pre-commit, commit-msg, pre-push/);
    assert.equal(result.stdout, '');
    assert.equal(missingHooks(repo).length, 3);
  });

  it('this clone has its hooks, or this is CI', () => {
    // The command run where it lives checks this repository. A commit here runs its hooks, so they are
    // installed; CI sets CI.
    const result = spawnSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  });
});
