// Exercise the real schema loader and final progress/stamp code in Bash.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const source = readFileSync(new URL('../scripts/extract-models.sh', import.meta.url), 'utf8');
const between = (a, b) => {
  const start = source.indexOf(a); const end = source.indexOf(b, start);
  assert(start >= 0 && end > start); return source.slice(start, end);
};
const schema = between('echo "--- Reading the econ schema', '\n# ---- Glove model key');
const progress = between('fmt_dur() {', '\n# ---- Step selection');
const completion = source.slice(source.indexOf('json_num() {'));
const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
const root = mkdtempSync(path.join(os.tmpdir(), 'extract-completion-'));
const run = (program, env = {}) => {
  const result = spawnSync('bash', ['-c', `set -euo pipefail\n${program}`], { encoding: 'utf8', timeout: 10000, env: { ...process.env, ...env } });
  assert.ifError(result.error); return result;
};
try {
  for (const mode of ['single-match', 'old-output-file', 'missing', 'empty', 'cli-fails']) {
    const dir = path.join(root, mode); mkdirSync(dir);
    if (mode === 'old-output-file') writeFileSync(path.join(dir, 'raw_items'), 'previous single-file output');
    const cli = path.join(dir, 'cli');
    writeFileSync(cli, `#!/usr/bin/env bash
set -eu
out=''
while (( $# )); do
 if [[ "$1" == -o ]]; then out=$2; shift 2; else shift; fi
done
[[ "$MODE" != cli-fails ]] || exit 7
[[ "$MODE" != missing ]] || exit 0
if [[ -d "$out" ]]; then
 mkdir -p "$out/scripts/items"
 file="$out/scripts/items/items_game.txt"
else
 file="$out"
fi
if [[ "$MODE" == empty ]]; then : >"$file"; else printf '"items_game" { "pet_definitions" {} }' >"$file"; fi
`, { mode: 0o755 });
    const result = run(`WORK=${quote(dir)}\nCLI=${quote(cli)}\nVPK=fixture.vpk\n${schema}\ntest -s "$ITEMS_GAME"\necho SCHEMA_READABLE`, { MODE: mode });
    const success = ['single-match', 'old-output-file'].includes(mode);
    if (success) {
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /SCHEMA_READABLE/);
      assert(existsSync(path.join(dir, 'raw_items/scripts/items/items_game.txt')));
    } else {
      assert.notEqual(result.status, 0, mode);
      assert.doesNotMatch(result.stdout, /SCHEMA_READABLE/);
      if (mode !== 'cli-fails') assert.match(result.stderr, /Econ schema missing or empty/);
    }
    console.log(`ok schema ${mode}`);
  }
  for (const mode of ['full', 'scoped', 'bundle', 'stamp-fails', 'bundle-fails']) {
    const dir = path.join(root, mode); mkdirSync(dir);
    const dest = path.join(dir, 'models'); mkdirSync(dest);
    const stamp = path.join(dest, 'extract-version.json');
    if (mode === 'stamp-fails') mkdirSync(stamp);
    else writeFileSync(stamp, '{"version":17}\n');
    const bin = path.join(dir, 'bin'); mkdirSync(bin);
    if (mode === 'bundle-fails') writeFileSync(path.join(bin, 'tar'), '#!/usr/bin/env bash\nexit 9\n', { mode: 0o755 });
    const out = ['bundle', 'bundle-fails'].includes(mode) ? '' : dir;
    const result = run(`cd ${quote(dir)}
WORK=${quote(dir)}
OUT_DIR=${quote(out)}
DEST=${quote(dest)}
RUN_START=$(date +%s)
STEP_START=$RUN_START
STEP_NAME=''
declare -a STEP_TIMES=()
GAME_BUILD=123; GAME_PATCH=1.2; GAME_DATE=today; EXTRACT_VERSION=34
PARTIAL_RUN=${mode === 'scoped' ? 1 : 0}
${progress}
for id in "${'${STEPS[@]}'}"; do prog "$id" done; done
step viewmodel-anims
${completion}
echo COMPLETION_REACHED
`, { PATH: bin + path.delimiter + process.env.PATH });
    const success = !mode.endsWith('fails');
    const report = JSON.parse(readFileSync(path.join(dir, 'extract-progress.json'), 'utf8'));
    const final = report.steps.find((s) => s.name === 'stamp');
    if (success) {
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /COMPLETION_REACHED/);
      assert(report.steps.every((s) => s.state === 'done'), mode);
      assert.equal(typeof final.seconds, 'number');
      assert.equal(JSON.parse(readFileSync(stamp, 'utf8')).version, mode === 'scoped' ? 17 : 34);
      if (mode === 'bundle') assert(existsSync(path.join(dir, 'cs2-models-glb.tar.gz')));
    } else {
      assert.notEqual(result.status, 0, mode);
      assert.doesNotMatch(result.stdout, /COMPLETION_REACHED/);
      assert.equal(final.state, 'running');
    }
    console.log(`ok completion ${mode}`);
  }
  console.log('all 10 actual schema/completion checks pass');
} finally { rmSync(root, { recursive: true, force: true }); }
