conditional approve (with conditions: close these specification contradictions before build)

1. **High — Revision-3 probe gate incomplete.** [plan.md:97](/home/homelab/Projects/nulo/.claude/worktrees/single-sim-estimates/implementations-plan/single-sim-estimates/plan.md:97) promises inertness, but the A1 gate at line 98 checks counts/ownership only. A stubbed, validation-skipping simulation could preserve counts and still influence PR2. Add the architecture’s explicit option assertions for every unchanged route.

2. **High — measurement fork is not reflected in the checkpoint.** [plan.md:103](/home/homelab/Projects/nulo/.claude/worktrees/single-sim-estimates/implementations-plan/single-sim-estimates/plan.md:103) globally gates A2/B2 together. Split it: free shapes 1–4 plus Sponsored canary gate B2; funded shapes 5–6 plus fragmented-note canary gate A2. Otherwise “no key” paradoxically says both “proceed A2” and “defer A2.”

3. **Medium — stale Ask-4 contracts remain.** Goal line 26 and ledger row 2 make A2 unconditional; ledger row 9 still says “proceed-without”; the `/goal` seed only recognizes measurement-failure deferral, not no-key deferral. Supersede/conditionalize them under ledger #11.

4. **Medium — clamp adoption is inconsistent.** [plan.md:46](/home/homelab/Projects/nulo/.claude/worktrees/single-sim-estimates/implementations-plan/single-sim-estimates/plan.md:46) omits Embedded/NO_FROM and incorrectly references Ask 3. Align it with Ask 2/ledger #14.

Ready to build once those four textual gates are corrected; the revised underlying design is sound.