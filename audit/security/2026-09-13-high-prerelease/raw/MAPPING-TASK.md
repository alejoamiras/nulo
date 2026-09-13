# Mapping task (Phase 1, harden security, run 2026-09-13-high-prerelease)

Map the assigned scope. READ-ONLY. Output a markdown file at the path given in your assignment. Be precise: real paths, real symbol names, `file:line` where useful. No speculation. Do NOT audit for vulnerabilities — this is a map, not a review.

Output sections (all required):
1. **Module inventory**: name, path, purpose (one sentence), rough LOC (non-test).
2. **Entrypoints**: message handlers, RPC methods, service ports, event listeners, background jobs, public exports, extension pages/windows, content-script injection points.
3. **Trust boundaries**: where untrusted or lower-privileged input enters (dApp RPC, chrome.runtime messages, content scripts, imported backups, network responses, URL params, clipboard, user-typed values), where secrets are handled (seed, keys, password, PRF output, session tokens, encrypted blobs), external calls (RPC nodes, price APIs, accelerator), storage writes (chrome.storage.local/session, IndexedDB, PXE), and every place a sender/origin/permission is checked. Cite file:line for each check.
4. **Dependency graph**: which modules import which, one level deep. Mark handoff edges: event emit → listener, message produce → consume, port open → handler, DI/service registration → consumer.
5. **Frameworks / libs**: crypto libs (with versions from package.json), validation libs (zod/valibot/etc), messaging abstractions, storage abstractions, @aztec/* packages used.
6. **Test surfaces**: where tests live, what looks well-covered vs thin (rough).
7. **Generated / vendored / fixture / test-only code**: paths to EXCLUDE from finding eligibility unless production-wired. Explicitly say whether each is production-wired (imported by prod code or shipped in the build).
8. **Security-relevant invariants documented in READMEs / ARCHITECTURE.md / comments** (AUDIT markers, freeze rules, "never" rules) — quote them with file:line so cluster auditors can check whether the code actually honours them.

Repo context: Bun monorepo. Layer order (lower can't import higher): wallet-core → wallet-crypto → extension-messaging → aztec-runtime → wallet-bridge → extension. Read ARCHITECTURE.md and the package README first. Vue UI components are OUT of scope except where they form a trust boundary (dApp approval windows: what is displayed vs what gets signed/executed; onboarding secret handling). `packages/bridge-core` bodies are OUT of scope (tools product, not releasing), but the extension's call sites into it are IN scope.
