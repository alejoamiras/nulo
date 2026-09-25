#!/usr/bin/env bash
# The halmos gate from _bridge-contracts.yml at the freeze SHA, over a colour-stripped log: each
# expected count bound to its contract, every committed proof passed by name, nothing else ran,
# nothing failed. halmos prints no grand total, so counts alone would miss a deleted or renamed proof.
#
#   halmos-proofs.sh <halmos-log>
set -uo pipefail

log=$1
fail=0
while read -r n contract; do
  grep -qE "^Running ${n} tests for .*:${contract}\$" "$log" || {
    echo "halmos: expected ${n} symbolic proofs in ${contract}"
    fail=1
  }
done <<'EXPECTED'
8 FormalRouterTest
2 FormalFactoryTest
2 FormalCloneTest
EXPECTED

while read -r proof; do
  grep -qE "^\[PASS\] ${proof}\(" "$log" || {
    echo "halmos: symbolic proof ${proof} did not pass (missing, renamed, or failed)"
    fail=1
  }
done <<'PROOFS'
check_bridge_conservesUserFunds
check_bridge_rejectsForeignPortal
check_bridgeWithFuel_conservesUserFunds
check_bridgeWithFuel_fuelOnly_conservesUserFunds
check_bridgeWithFuel_identity_conservesUserFunds
check_bridgeWithFuel_partialRejectsFeeJuicePortal
check_deposit_revertsWhenPaused
check_predictPortal_isCreate2OfInitcode
check_setPaused_revertsForNonOwner
check_setSwapTarget_revertsForNonOwner
check_sweep_revertsForNonOwner
check_withdraw_revertsWhenPaused
PROOFS

summaries=$(grep -c '^Symbolic test result: ' "$log" || true)
if [ "$summaries" -ne 3 ]; then
  echo "halmos: expected 3 proof contracts to run, saw ${summaries}"
  fail=1
fi
if grep -qE '^Symbolic test result: [0-9]+ passed; [1-9]' "$log"; then
  echo "halmos: a symbolic proof failed"
  fail=1
fi
[ "$fail" -eq 0 ] && echo "halmos: 12 proofs passed by name across 3 contracts"
exit "$fail"
