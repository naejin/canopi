#!/usr/bin/env bash
# Behaviour tests for the qualification runner's exit handling.
#
# The runner is exercised with small deterministic stubs rather than real browser
# launches or large fixtures, so the test is fast and never touches the private
# evidence directory. Every stub writes into a fresh temporary output root.
#
# Run directly:  bash scripts/raster-qualification/tests/test_runner_exit.sh
# Also invoked by test_runner_exit.py so the suite covers it.
set -uo pipefail

HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER="$HARNESS/run_all_experiments.sh"
PASS=0
FAIL=0

check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "ok   - $name (exit $actual)"
    PASS=$((PASS + 1))
  else
    echo "FAIL - $name: expected exit $expected, got $actual"
    FAIL=$((FAIL + 1))
  fi
}

# A stub interpreter that records the call and exits with a controllable status.
# It emits the artifacts the runner's later steps read: an experiment summary for
# ``compare``, an evidence bundle for ``gate-assemble`` and a decision for ``gate``.
make_stub_dir() {
  local dir="$1"
  mkdir -p "$dir"
  cat > "$dir/stub.sh" <<'STUB'
#!/usr/bin/env bash
# Echo the invocation so the test can prove the runner really called it, then
# honour the requested status and emit the artifact the requested step produces.
echo "stub: $*" >> "$STUB_LOG"
out=""
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  if [ "${args[$i]}" = "--out" ]; then out="${args[$((i + 1))]}"; fi
done

# Which subcommand is this? The runner routes experiment steps, the aggregate
# comparison, bundle assembly and the gate through the same interpreter override.
sub=""
for arg in "${args[@]}"; do
  case "$arg" in
    compare|gate-assemble|gate) sub="$arg"; break ;;
  esac
done

# ``STUB_NO_SUMMARY=1`` withholds the aggregate report entirely, so the runner's
# "no aggregate produced" path can be exercised.
if [ "${STUB_NO_SUMMARY:-0}" = "1" ] && [[ "$out" == *q-summary.json ]]; then
  exit "${STUB_STATUS:-0}"
fi

if [ "$sub" = "gate" ]; then
  # The gate's status is its eligibility decision, not a step failure.
  if [[ "$out" == *q-decision.json || -n "$out" ]]; then
    mkdir -p "$(dirname "$out")"
    printf '{"result":"%s","requirements":[]}\n' \
      "${STUB_GATE_RESULT:-pass}" > "$out"
  fi
  exit "${STUB_GATE_STATUS:-0}"
fi

if [ -n "$out" ]; then
  mkdir -p "$(dirname "$out")"
  if [ "$sub" = "gate-assemble" ]; then
    # A minimal bundle the gate stub is handed; its content is not what this
    # suite tests, only that the runner assembled one and then gated it.
    printf '{"generatedAt":0,"environment":{},"route":{},"requirements":{}}\n' > "$out"
  else
    result="${STUB_SUMMARY_RESULT:-pass}"
    printf '{"experiment":"stub","result":"%s","failures":[],"assertions":[{"name":"a","ok":true,"detail":"d"}],"requiredBehavior":"x","implementationExercised":"y","commands":[],"fixtures":[],"measurementLocations":[],"limitations":[]}\n' \
      "$result" > "$out"
  fi
fi
exit "${STUB_STATUS:-0}"
STUB
  chmod +x "$dir/stub.sh"

  # The decision stub records its own invocation so the test can prove the runner
  # really invoked the TypeScript path with the assembled report directory.
  cat > "$dir/decision.mjs" <<'DECISION'
#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs';
const argv = process.argv.slice(2);
appendFileSync(process.env.STUB_LOG, `decision: ${argv.join(' ')}\n`);
const outIndex = argv.indexOf('--out');
const out = outIndex === -1 ? '' : argv[outIndex + 1];
if (out && out.length > 0) {
  writeFileSync(out, `${JSON.stringify({
    version: 1,
    verdict: process.env.STUB_GATE_RESULT ?? 'pass',
    requirements: [],
  }, null, 2)}\n`);
}
process.exit(Number.parseInt(process.env.STUB_GATE_STATUS ?? '0', 10));
DECISION
  chmod +x "$dir/decision.mjs"
}

# ``gate_status`` is the eligibility decision the gate step reports, kept separate
# from ``status`` (a step failure) because the two are different findings.
# The decision step is a Node CLI, so the runner is exercised with two stubs: a
# shell stub for the Python producers and a Node stub for the TypeScript decision.
run_runner() {
  local scratch="$1" status="$2" summary="$3" no_summary="${4:-0}"
  local gate_status="${5:-0}" gate_result="${6:-pass}"
  local stubdir="$scratch/stub"
  make_stub_dir "$stubdir"
  mkdir -p "$scratch/out"
  (
    export QUAL_PY="$stubdir/stub.sh"
    export QUAL_NODE="$stubdir/stub.sh"
    # A compiler stub that succeeds without compiling: this suite tests exit
    # handling, not the build. The real build is covered by the TypeScript tests.
    export QUAL_TSC="$stubdir/stub.sh"
    export QUAL_NODE_BIN="$stubdir/decision.mjs"
    export STUB_STATUS="$status"
    export STUB_SUMMARY_RESULT="$summary"
    export STUB_LOG="$scratch/calls.log"
    export STUB_NO_SUMMARY="$no_summary"
    export STUB_GATE_STATUS="$gate_status"
    export STUB_GATE_RESULT="$gate_result"
    : > "$STUB_LOG"
    bash "$RUNNER" "$scratch" > "$scratch/runner.out" 2> "$scratch/runner.err"
    echo $?
  )
}

echo "=== runner exit handling ==="

# 1. All steps succeed and the gate reports eligibility: exit zero.
scratch=$(mktemp -d)
status=$(run_runner "$scratch" 0 pass 0 0 pass)
check "all steps succeed and the gate passes" 0 "$status"
if grep -q -- "decision: .*--reports .*out" "$scratch/calls.log"; then
  echo "ok   - the runner invoked the decision path over the report directory"
  PASS=$((PASS + 1))
else
  echo "FAIL - the runner never invoked the decision path"
  FAIL=$((FAIL + 1))
fi
if grep -q -- "--contract scripts/raster-qualification/requirements.json" "$scratch/calls.log"; then
  echo "ok   - the decision path was given the authoritative contract"
  PASS=$((PASS + 1))
else
  echo "FAIL - the decision path was not given the contract"
  FAIL=$((FAIL + 1))
fi
if [ -f "$scratch/out/q-decision.json" ]; then
  echo "ok   - a decision document was written"
  PASS=$((PASS + 1))
else
  echo "FAIL - no decision document was written"
  FAIL=$((FAIL + 1))
fi
rm -rf "$scratch"

# 2. One command fails: exit non-zero, with the diagnostic summary retained.
scratch=$(mktemp -d)
status=$(run_runner "$scratch" 1 pass)
check "one failing command exits non-zero despite a passing aggregate" 1 "$status"
if grep -q "step(s)" "$scratch/runner.err"; then
  echo "ok   - diagnostic summary names the failing steps"
  PASS=$((PASS + 1))
else
  echo "FAIL - diagnostic summary missing"
  FAIL=$((FAIL + 1))
fi
if [ -s "$scratch/runner.out" ]; then
  echo "ok   - verdict summary still printed"
  PASS=$((PASS + 1))
else
  echo "FAIL - verdict summary was suppressed"
  FAIL=$((FAIL + 1))
fi
rm -rf "$scratch"

# 3. Every step succeeds and every experiment passes, but the requirement gate
#    does not find the evidence eligible: exit non-zero. This is the bypass the
#    consolidated review found: the run ended at the experiment summary, so it
#    could finish zero without ever asking whether the evidence satisfies Q.
scratch=$(mktemp -d)
status=$(run_runner "$scratch" 0 pass 0 1 inconclusive)
check "ineligible gate exits non-zero despite a passing experiment set" 1 "$status"
if grep -q "decision:" "$scratch/calls.log"; then
  echo "ok   - the decision path was the deciding step"
  PASS=$((PASS + 1))
else
  echo "FAIL - the decision path was never invoked"
  FAIL=$((FAIL + 1))
fi
rm -rf "$scratch"

# 4. The gate reports a measured violation: exit non-zero.
scratch=$(mktemp -d)
status=$(run_runner "$scratch" 0 pass 0 1 fail)
check "failing gate exits non-zero" 1 "$status"
rm -rf "$scratch"

# 5. Every step succeeds and no aggregate summary is produced: exit non-zero.
scratch=$(mktemp -d)
status=$(run_runner "$scratch" 0 pass 1)
check "missing aggregate summary exits non-zero" 1 "$status"
rm -rf "$scratch"

# 6. A failing step whose aggregate also fails: exit non-zero (fail precedence).
scratch=$(mktemp -d)
status=$(run_runner "$scratch" 1 fail)
check "failing steps and failing aggregate exit non-zero" 1 "$status"
rm -rf "$scratch"

# 7. Every step succeeds, the experiment aggregate is not a pass, but the gate
#    would have said eligible: the gate is authoritative for eligibility, and the
#    step failures are what make the run fail. Neither may be silently ignored.
scratch=$(mktemp -d)
status=$(run_runner "$scratch" 0 inconclusive 0 0 pass)
check "inconclusive experiment set still ends at the gate" 0 "$status"
if grep -q "warning: experiment aggregate is not a pass" "$scratch/runner.err"; then
  echo "ok   - the disagreement between summary and gate is reported"
  PASS=$((PASS + 1))
else
  echo "FAIL - a summary that disagrees with an eligible gate was silent"
  FAIL=$((FAIL + 1))
fi
rm -rf "$scratch"

echo
echo "runner exit handling: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
