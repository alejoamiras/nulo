# Phase 2 ✓ — apps move + workspace glob
git mv packages/{extension,faucet,landing,playground} -> apps/ (after mkdir apps; first attempt failed — no dest dir).
Workspace glob package.json:4-6 ["packages/*"] -> ["apps/*","packages/*"].
bun install re-resolved member paths; bun.lock diff = member re-sort only (apps/* sorts first), ZERO resolved-version churn. frozen 0, 11 @nulo members.
NOTE (plan design): typecheck/lint/CI are RED from here until Phases 3-6 repath tsconfig/biome/tests/CI; G2 gates ONLY the install.
