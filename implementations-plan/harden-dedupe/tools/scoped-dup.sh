#!/usr/bin/env bash
# Scoped production duplication: extension src + packages/*/src, tests/e2e/stories excluded, min-tokens 50.
set -euo pipefail
OUT=$(mktemp -d)
paths=(apps/extension/src)
for p in packages/*/src; do paths+=("$p"); done
bunx jscpd@5.0.16 "${paths[@]}" \
  --ignore "**/node_modules/**,**/dist/**,**/*.test.ts,**/*.spec.ts,**/tests/**,**/e2e/**,**/*.stories.ts,**/__fixtures__/**,**/types/*.d.ts" \
  --min-tokens 50 --reporters json,silent --output "$OUT" >/dev/null 2>&1
bun -e "const r=require('$OUT/jscpd-report.json').statistics.total; console.log('lines='+r.lines+' dup='+r.duplicatedLines+' pct='+r.percentage+'% clones='+r.clones)"
