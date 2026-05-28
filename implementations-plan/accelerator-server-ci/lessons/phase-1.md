# Phase 1 lessons — accelerator-server CI integration

We are the **first integrators** of the headless `accelerator-server` binary (released by upstream specifically for this work). Every observation lands here so future-us has a real spec, not assumptions.

## Verified BEFORE writing a line of code

### Q1 (origin auth) — RESOLVED via source read

**Source**: `~/projects/aztec-accelerator/packages/accelerator/src-tauri/src/bin/accelerator-server.rs:32-49` + `src/server.rs:203-247`.

With `ALLOWED_ORIGINS` env unset (our chosen config):

- `auth_manager = None`, `config = None` (`accelerator-server.rs:47-49`)
- `is_origin_authorized()` sees `None` → returns `Ok(())` immediately (`server.rs:210`)
- Every `/prove` request is auto-approved regardless of Origin header content
- Confirmed: `chrome-extension://<id>` origin is accepted; no-Origin-header requests also accepted

If we ever lock down `ALLOWED_ORIGINS` (defense in depth):
- A request with NO Origin header → still auto-approved (`server.rs:218: // No Origin header → auto-approve. Browsers always send Origin on cross-origin`)
- A request with an Origin matching the comma-separated allowlist → approved
- An Origin NOT in the allowlist → `tracing::info!(origin = %origin, "Origin not approved (no popup available), denying");` → 403 → SDK silent fallback to WASM. The README's example `ALLOWED_ORIGINS=http://localhost:5173` would hit this for our extension.

### Q5 (SHA-256) — RESOLVED

```
accelerator-server-1.0.1-linux-x86_64.tar.gz
  sha256: 86344c2b778c381d809a6eb6887b8a9b9fe2d0b4714c64c5bd3477f758a0b10f
  size:   1.8 MB (uncompressed binary slightly larger)
```

Cross-checked against the `.sha256` sidecar from the same release. They match — useful sanity check (a sidecar/tarball drift would have indicated upstream packaging error). Note: matching the sidecar is NOT a security guarantee per codex's catch — the repo-pinned hash defends against release-origin tampering; the sidecar match here is a build-time sanity confirmation.

### Q-bonus (server concurrency) — discovered during Q1 source read

`accelerator-server.rs:54`:
```rust
prove_semaphore: Some(Arc::new(tokio::sync::Semaphore::new(1)))
```

**Single-concurrency proving on the server.** `bb` already uses all cores; serializing at the prove level prevents thrash. Implications for us:
- Multiple parallel test executions on the same shard would serialize at the prove endpoint.
- Our `network-e2e` shards already use `fileParallelism: false` (one test file at a time per vitest config), so this is benign.
- If we ever flip to parallel-file vitest, we'd hit this. Document the constraint.

### Q-bonus (log pattern for Layer 3) — discovered during Q1 source read

`server.rs:392`:
```rust
tracing::info!("Received /prove request");
```

With `RUST_LOG=info` (the default `tracing-subscriber` filter when env unset), every `/prove` request emits a line containing the literal string `Received /prove request`.

Other relevant log lines we expect to see:
- `tracing::info!("Accelerator server listening on {addr}");` — startup
- `tracing::info!(version = %v, "Requested Aztec version");` — first prove per version
- `tracing::info!(version = %v, "Version not cached, downloading");` — bb auto-download (should never fire if `BB_BINARY_PATH` works)
- `tracing::info!(version = %v, "Download complete");` — auto-download finished
- `tracing::info!(origin = %origin, "Origin not approved (no popup available), denying");` — 403 path (should never fire with `ALLOWED_ORIGINS` unset)

**Adjustment to plan §4.2**: Layer 3 grep pattern changes from
```
grep -cE 'POST /prove|prove request|prove_request'
```
to the verified literal:
```
grep -c 'Received /prove request'
```
Less brittle.

### Body size limit

`server.rs:119`:
```rust
.layer(DefaultBodyLimit::max(50 * 1024 * 1024)) // 50MB
```

Our proving payloads (msgpack-serialized execution steps) are well under 50MB. Non-issue.

## Open / spike during first CI run

- **Q2 (`BB_BINARY_PATH` on ubuntu-latest)**: setup-aztec composite action installs Aztec CLI; we assume `~/.aztec/current/node_modules/@aztec/bb.js/build/amd64-linux/bb` exists post-install. Will verify with the workflow's "Start accelerator-server" precheck (`if [ ! -x "$BB_BINARY_PATH" ]`). On failure we'll dump the layout and decide between alternative paths.
- **Q3 (glibc compatibility) — RESOLVED**: `file accelerator-server` reports `ELF 64-bit LSB pie executable, x86-64, ..., dynamically linked, ..., for GNU/Linux 3.2.0, BuildID[sha1]=2b1dddf87dc16fd669140f99351927ae72ccbcbb, stripped`. Targeting GNU/Linux 3.2.0 means very broad glibc compat — ubuntu-latest's glibc is several major versions newer. We'll still run `ldd` in the composite action's "Verify executable" step to catch any surprises.
- **Q4 (SIGTERM cleanliness)**: workflow uses `kill -TERM "${ACCELERATOR_PID}"` then `pkill -TERM accelerator-server` as belt-and-suspenders. If we see leaked processes between runs we'll capture here.
- **Q6 (log format)**: resolved above for the `/prove` request pattern. Will verify on first run that lines actually appear with `RUST_LOG` default.

## First CI run findings (PR #67 attempt 1)

Pushed PR #67 with the implementation. **All 6 network-e2e jobs failed at ~2 min** (pre-test, at the "Start accelerator-server" step). Lint, typecheck, unit tests, smoke e2e, build chrome — all passed. Only the network-e2e accelerator integration broke.

### Bug — `$HOME` literal in workflow YAML `env:` value

Symptom (from shard 2/5 log):

```
##[error]BB_BINARY_PATH=$HOME/.aztec/current/node_modules/@aztec/bb.js/build/amd64-linux/bb not executable.
```

The `$BB_BINARY_PATH` value in the error message contains the literal string `$HOME` — it was never expanded. Root cause: **GitHub Actions does NOT shell-expand `$VAR` references in workflow `env:` blocks.** The value is passed verbatim to the child shell, where `$HOME/.aztec/...` is a literal that doesn't satisfy `[ -x ... ]`.

### Verified layout from the precheck dump (good news)

The precheck `find $HOME/.aztec -name bb -type f` output confirms my chosen path WOULD have worked if `$HOME` had been expanded:

```
/home/runner/.aztec/versions/4.2.0/node_modules/@aztec/bb.js/build/amd64-linux/bb
/home/runner/.aztec/versions/4.2.0/node_modules/@aztec/bb.js/build/arm64-macos/bb
/home/runner/.aztec/versions/4.2.0/node_modules/@aztec/bb.js/build/arm64-linux/bb
/home/runner/.aztec/versions/4.2.0/node_modules/@aztec/bb.js/build/amd64-macos/bb
```

And `~/.aztec/current` is a symlink to `~/.aztec/versions/4.2.0`. So the path `$HOME/.aztec/current/node_modules/@aztec/bb.js/build/amd64-linux/bb` IS the right target on a Linux x86_64 runner. Codex's pre-impl concern that the path "might not be right" turned out unfounded; my pre-impl probe to set the right value was correct. Only the YAML expansion was wrong.

### Fix

Move `BB_BINARY_PATH` definition out of the `env:` YAML block into the shell `run:` block with `export`. The subshell that `nohup accelerator-server` spawns inherits the exported var. Single small workflow edit.

## Wording correction (per user)

| Term | Meaning |
|---|---|
| **Aztec Accelerator** | The Tauri-based desktop app users install (`packages/extension/src/onboarding/pages/accelerator.vue` links to `https://aztec-accelerator.dev/`). |
| **accelerator-server** | The headless binary for CI. Same Axum HTTP server as the Tauri app, but no GUI. |

Don't conflate. ELI5, plan, docs all use this distinction.
