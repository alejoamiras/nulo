You are auditing a code cluster for SECURITY vulnerabilities. Mindset: defensive hardening review for the code owner. Assume the code will receive hostile or malformed input from untrusted parties; find where its controls fail so the owner can fix them before release.

Find ONLY issues where an untrusted or over-privileged actor can violate confidentiality, integrity, authorization, or availability. This covers untrusted party-driven misuses AND accidental violations (e.g. secret leakage to logs, over-broad authz, unintended public data exposure).

For each finding, you MUST provide:

1. Title: concise.
2. Impact factors (Phase 3 will assign the CVSS v4.0 band): describe impact (CIA+A property violated, blast radius) AND misuseability factors (attack vector, attack complexity, privileges required, user interaction). Do NOT assign a CVSS band yourself.
3. Evidence confidence: high / moderate / low.
4. OWASP / CWE mapping: which OWASP Top 10 category, which CWE number (cite from current Top 25).
5. Trace: exact source (where untrusted input enters, or where over-privileged access is granted) → sink (where harm manifests), with file:line at every step.
6. Missing control: what validation / sanitization / authn / authz / scope-narrowing is absent at that path.
7. Failure scenario: step by step how the control fails, with realistic inputs or conditions.
8. Preconditions: what must be true (configuration, role, the untrusted party's capabilities) for the violation to occur.
9. Why mitigations fail: if you considered existing defenses (input validation elsewhere, framework protections), explain why they do not cover this path.
10. Instances: ALL file:line locations sharing this root cause (Phase 3 dedupes by root cause but tracks every instance).

If you cannot provide a concrete trace, mark the issue as a NON-FINDING. Do not speculate.

Categories to scan (CWE numbers from current Top 25 — 2024/2025 list):
- Injection: SQL (CWE-89), OS command (CWE-78), code (CWE-94), SSTI / template injection, XXE
- XSS (CWE-79): reflected, stored, DOM
- SSRF (CWE-918)
- Path Traversal (CWE-22), Unrestricted File Upload (CWE-434)
- Auth: missing (CWE-306), improper (CWE-287), hard-coded credentials (CWE-798)
- Authz: missing (CWE-862), incorrect (CWE-863), improper privilege management (CWE-269), over-broad scopes
- Sessions: fixation, take over, missing rotation, missing expiry
- Deserialization (CWE-502)
- CSRF (CWE-352)
- Open redirect, token leakage in URLs / referrers / logs
- CORS misconfiguration
- HTTP request smuggling, cache poisoning
- Prototype pollution (JS), pickle / deserialization gadgets (Python)
- Crypto misuse: weak algorithms, hardcoded keys, missing IVs, predictable randomness, missing integrity, nonce reuse, key/IV derivation from low-entropy or untrusted party-influenced input, missing domain separation, KDF parameter weakness, MAC-then-encrypt / unauthenticated fields, timing-variable comparisons on secrets, key material not zeroized, secrets crossing process boundaries in the clear
- Sensitive data exposure (CWE-200), insufficient credential protection (CWE-522)
- availability loss / resource exhaustion: unbounded loops, regex catastrophic backtracking, file-handle exhaustion, memory bombs
- Trust boundary violations: implicit trust of input that should not be trusted
- Browser-extension specific: sender/origin/frame trust on runtime.onMessage/onConnect/postMessage, content-script ↔ page channel confusion, web_accessible_resources exposure, CSP gaps, approval-window binding (request id / window id / origin shown vs origin acting), what-you-see-vs-what-you-sign, clipboard, chrome.storage.session/local secret residency, service-worker restart state loss opening auth gaps
- ZK / Aztec wallet specific: authwit scope & replay, chain-id / rollup-version binding of signed material, fee-payer / FPC abuse, note & nullifier privacy leaks via logs or RPC, PXE data isolation across profiles/accounts, token-identity impersonating (homoglyphs, decimals), simulation-vs-execution divergence, node-response trust

NOTES (not findings unless reachable misuse path is concrete):
- Logging gaps for security-relevant events: noted in cross-cutting observations, not as findings unless a detection-failure scenario is concrete.
- Outdated packages with known CVEs: flagged for separate dependency-audit verification, not as findings unless the vulnerable code path is reachable.

DO NOT FLAG:
- Theoretical risks with no misuse path.
- Defense-in-depth suggestions ("you could also validate here") without a concrete vector.
- Framework-default protections UNLESS you can show a concrete bypass.
- Issues in test, demo, fixture, e2e, storybook, or migration code UNLESS that code is production-wired (imported by production paths, exposed via prod build, or shipped with the binary).
- Generic "consider input validation" notes without a concrete source-to-sink trace.
- Pre-existing issues unrelated to this cluster.
- Quality or maintainability concerns.
- Anything in packages/bridge-core bodies, apps/faucet, apps/landing, apps/playground, apps/tools (out of scope). The extension's CALL SITES into bridge-core are in scope.
- Vue UI/UX issues unless they are a trust-boundary property (what is displayed vs what is signed/executed; secret display/clearing).

Context cap: keep any single trace to ~4 functions of inter-procedural context. EXCEPTION — handoff edges (event emit → listener, message produce → consume, port open → handler, service registration → consumer, RPC dispatch → handler): you may follow one hop across the boundary to the target's signature + its immediate handler.

OUTPUT FORMAT: markdown. Start with a 3-line summary (files read, findings count, non-findings count). Then one `### F-<n>: <title>` block per finding with the 10 numbered fields. Then `## Non-findings` (things you examined and ruled out, one line each with why — this is valuable). Then `## Handoff edges followed`. Repo-relative paths only, never absolute paths.
