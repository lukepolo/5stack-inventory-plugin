// Run the actual decompile pool with a recording CLI. A failed model must stop
// the pipeline before merge/stamp, while an all-noise success must still pass.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const source = readFileSync(new URL('../scripts/extract-models.sh', import.meta.url), 'utf8');
const start = source.indexOf('SHARDS="$WORK/raw_shards"');
const end = source.indexOf('\n# The model key table', start);
assert(start >= 0 && end > start);
// The final fi belongs to the outer step-selection guard, before this block.
const pool = source.slice(start, end).replace(/\nfi\s*$/, '\n');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'extract-shards-check-'));
const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
const cli = `#!/usr/bin/env bash
set -u
dir='' out=''
while (( $# )); do
 case "$1" in
  -f) dir=$2; shift 2 ;;
  -o) out=$2; shift 2 ;;
  *) shift ;;
 esac
done
mkdir -p "$out"
printf '%s\\n' "$dir" >> "$EXTRACT_SHARD_TRACE"
case "$EXTRACT_SHARD_CASE" in
 noise) echo 'Only VCS file versions are supported'; exit 0 ;;
 silent) exit 0 ;;
 fail) echo 'decompiler failed'; exit 1 ;;
 fail-noise) echo 'Only VCS file versions are supported'; exit 7 ;;
 killed) kill -KILL $$ ;;
 concurrent)
  case "$dir" in
   */first/) sleep 0.1; echo 'decompiler failed'; exit 1 ;;
   */second/) sleep 3; touch "$EXTRACT_SHARD_SLOW_DONE" ;;
  esac ;;
esac
echo 'model exported'
`;
const results = [];
try {
  for (const mode of ['normal', 'noise', 'silent', 'fail', 'fail-noise', 'killed', 'grep-error', 'sed-error', 'concurrent']) {
    const dir = path.join(scratch, mode); mkdirSync(dir);
    const bin = path.join(dir, 'bin'); mkdirSync(bin);
    const fakeCli = path.join(bin, 'source2-cli'); writeFileSync(fakeCli, cli, { mode: 0o755 });
    if (mode === 'grep-error') writeFileSync(path.join(bin, 'grep'), '#!/usr/bin/env bash\nexit 2\n', { mode: 0o755 });
    if (mode === 'sed-error') writeFileSync(path.join(bin, 'sed'), '#!/usr/bin/env bash\nexit 1\n', { mode: 0o755 });
    const trace = path.join(dir, 'calls'); const slow = path.join(dir, 'slow-done');
    const program = `set -euo pipefail
WORK=${quote(dir)}
RAW="$WORK/raw"; mkdir -p "$RAW"
VPK="$WORK/fixture.vpk"
CLI=${quote(fakeCli)}
WEAPON_DIRS=(weapons/models/first/ weapons/models/second/ ${mode === 'concurrent' ? 'weapons/models/third/' : ''})
read_jobs() { echo ${mode === 'concurrent' ? 2 : 1}; }
prog() { :; }
${pool}
echo PIPELINE_AFTER_DECOMPILE
`;
    const run = spawnSync('bash', ['-c', program], { encoding: 'utf8', timeout: 12000, env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, EXTRACT_SHARD_CASE: mode, EXTRACT_SHARD_TRACE: trace, EXTRACT_SHARD_SLOW_DONE: slow } });
    assert.ifError(run.error);
    const success = ['normal', 'noise', 'silent'].includes(mode);
    if (success) {
      assert.equal(run.status, 0, `${mode}: ${run.stderr}`);
      assert.match(run.stdout, /PIPELINE_AFTER_DECOMPILE/);
      assert.equal(readFileSync(trace, 'utf8').trim().split('\n').length, 2);
    } else {
      assert.equal(run.status, 1, `${mode}: ${run.stderr}`);
      assert.doesNotMatch(run.stdout, /PIPELINE_AFTER_DECOMPILE/);
      assert.match(run.stderr, /model decompile shard\(s\) failed/);
      const failed = path.join(dir, 'raw_shards', '.failed', 'weapons_models_first_');
      assert(existsSync(failed), `${mode}: missing failure marker`);
      assert(!existsSync(path.join(dir, 'raw_shards', '.done', 'weapons_models_first_')));
      if (mode === 'concurrent') {
        assert(existsSync(slow), 'must wait for the already-running shard');
        assert.doesNotMatch(readFileSync(trace, 'utf8'), /third/);
      } else assert.equal(readFileSync(trace, 'utf8').trim().split('\n').length, 1, 'must not launch the next shard after failure');
      if (mode === 'killed') assert.match(readFileSync(failed, 'utf8'), /^137 /);
    }
    results.push(mode); console.log(`ok ${mode}`);
  }
  console.log(`all ${results.length} actual decompile-pool checks pass`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
