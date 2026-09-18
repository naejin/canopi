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
# It writes the report the runner's final gate reads.
make_stub_dir() {
  local dir="$1"
  mkdir -p "$dir"
  cat > "$dir/stub.sh" <<'STUB'
#!/usr/bin/env bash
# Echo the invocation so the test can prove the runner really called it, then
# honour the requested status and emit a summary when one was asked for.
echo "stub: $*" >> "$STUB_LOG"
out=""
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  if [ "${args[$i]}" = "--out" ]; then out="${args[$((i + 1))]}"; fi
done
# ``STUB_NO_SUMMARY=1`` withholds the aggregate report entirely, so the runner's
# "no aggregate produced" path can be exercised.
if [ "${STUB_NO_SUMMARY:-0}" = "1" ] && [[ "$out" == *q-summary.json ]]; then
  exit "${STUB_STATUS:-0}"
fi
if [ -n "$out" ]; then
  mkdir -p "$(dirname "$out")"
  result="${STUB_SUMMARY_RESULT:-pass}"
  printf '{"experiment":"stub","result":"%s","failures":[],"assertions":[{"name":"a","ok":true,"detail":"d"}],"requiredBehavior":"x","implementationExercised":"y","commands":[],"fixtures":[],"measurementLocations":[],"limitations":[]}\n' \
    "$result" > "$out"
fi
exit "${STUB_STATUS:-0}"
STUB
  chmod +x "$dir/stub.sh"
}

run_runner() {
  local scratch="$1" status="$2" summary="$3" no_summary="${4:-0}"
  local stubdir="$scratch/stub"
  make_stub_dir "$stubdir"
  mkdir -p "$scratch/out"
  # One interpreter for both node and python roles: the runner's behaviour under
  # test is its exit handling, not which interpreter it invokes.
  (
    export QUAL_PY="$stubdir/stub.sh"
    export QUAL_NODE="$stubdir/stub.sh"
    export STUB_STATUS="$status"
    export STUB_SUMMARY_RESULT="$summary"
    export STUB_LOG="$scratch/calls.log"
    export STUB_NO_SUMMARY="$no_summary"
    : > "$STUB_LOG"
    bash "$RUNNER" "$scratch" > "$scratch/runner.out" 2> "$scratch/runner.err"
    echo $?
  )
}

echo "=== runner exit handling ==="

# 1. All steps succeed and the aggregate qualifies: exit zero.
scratch=$(mktemp -d)
status=$(run_runner "$scratch" 0 pass)
check "all steps succeed and aggregate passes" 0 "$status"
if grep -q "qualification aggregate: pass" "$scratch/runner.out"; then
  echo "ok   - agent run reports the passing aggregate"
  PASS=$((PASS + 1))
else
  echo "FAIL - agent run did not report the passing aggregate"
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

# 3. Every step succeeds but the aggregate is not a pass: exit non-zero.
#    This is the case the previous runner got wrong: the final pretty-print
#    succeeded, so the process exited zero.
scratch=$(mktemp -d)
status=$(run_runner "$scratch" 0 inconclusive)
check "non-passing aggregate exits non-zero" 1 "$status"
rm -rf "$scratch"

# 4. Every step succeeds and no aggregate summary is produced: exit non-zero.
scratch=$(mktemp -d)
status=$(run_runner "$scratch" 0 pass 1)
check "missing aggregate summary exits non-zero" 1 "$status"
rm -rf "$scratch"

# 5. A failing step whose aggregate also fails: exit non-zero (fail precedence).
scratch=$(mktemp -d)
status=$(run_runner "$scratch" 1 fail)
check "failing steps and failing aggregate exit non-zero" 1 "$status"
rm -rf "$scratch"

echo
echo "runner exit handling: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
