#!/usr/bin/env bash
# TEMPORARY detached-run wrapper (never committed): the harness's background
# tasks get SIGTERMed mid-run in this session, so the FULL network suite runs
# setsid-detached with its own pgid + log; the session polls the log.
cd "$(dirname "$0")/../.." || exit 1
LOG="$1"
setsid env NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1 bun run e2e:agent >"$LOG" 2>&1 &
PID=$!
PGID=$(ps -o pgid= -p "$PID" | tr -d ' ')
echo "$PGID" > "$LOG.pgid"
echo "detached pid=$PID pgid=$PGID log=$LOG"
