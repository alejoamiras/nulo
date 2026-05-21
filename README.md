# Nulo Wallet

> ## ⚠️ DEMO / PREVIEW BUILD — NOT A PRODUCTION WALLET
>
> **Nulo is a demo for evaluation and feedback. It is not a production wallet.**
>
> - **No security audit.** The code has not been reviewed by an external security firm.
> - **Do not use with real funds or mainnet keys.** Aztec testnet only. Treat any key material you import as compromised.
> - **Storage format is unstable.** Profiles, sessions, and on-disk schemas may change between builds. Expect data wipes and full reseeds.
> - **Interfaces will change without notice.** dApp surface, popup UX, and message shapes are still in flux.
> - **No uptime, support, or recovery guarantees.** This is a preview of work in progress, published so people can try it, file bugs, and follow along.
>
> If you are looking for a production Aztec wallet, this is not it — come back later, or follow [`implementations-plan/`](./implementations-plan/README.md) to track readiness.

A self-custody wallet for the [Aztec network](https://aztec.network), packaged as a Chrome and Firefox extension. Nulo runs the Aztec [Private Execution Environment](https://docs.aztec.network/aztec/protocol/circuits/pxe) locally so transactions are simulated and signed on the user's machine; no node operator sees the contents.

The extension exposes the canonical `@aztec/wallet-sdk` surface to dApps and uses the upstream `@aztec/accounts/schnorr` account contract — there is no custom Noir source in this repo.

## Status

- Manifest V3, Chrome + Firefox.
- Password and passkey profiles (WebAuthn PRF).
- Account abstraction: multicall, fee-payer, authwit, payload chunking.
- dApp surface: discover, connect, capability bundles, sendTx, simulateTx, registerContract, getPrivateEvents.
- Local testing: a playground dApp and parallel-safe e2e suite per worktree.

What's still in flight is tracked in [`implementations-plan/`](./implementations-plan/README.md).

## Quick start

```bash
bun install
bun run build                 # Chrome build → packages/extension/dist/chrome/
```

Then load `packages/extension/dist/chrome/` as an unpacked extension at `chrome://extensions` (Developer mode → Load unpacked).

For Firefox, `bun run build:firefox` → `packages/extension/dist/firefox/`.

## Monorepo

| Package | Purpose |
|---|---|
| [`@nulo/extension`](./packages/extension/) | The Chrome/Firefox MV3 extension — service worker, popup UI, content script, offscreen PXE host. |
| [`@nulo/wallet-bridge`](./packages/wallet-bridge/) | dApp-facing dispatcher: `@aztec/wallet-sdk` capability map, scope enforcement. |
| [`@nulo/aztec-runtime`](./packages/aztec-runtime/) | PXE lifecycle, `NuloAccount` adapter, class-id verification, payload chunking. |
| [`@nulo/extension-messaging`](./packages/extension-messaging/) | Typed RPC plumbing across service worker, popup, and offscreen. |
| [`@nulo/wallet-crypto`](./packages/wallet-crypto/) | Password + passkey KDF, `PasswordSecretBox`, derivation chain (vector-locked). |
| [`@nulo/wallet-core`](./packages/wallet-core/) | Pure ports + utilities. No `chrome.*`; no I/O. Foundation of the layer hierarchy. |
| [`@nulo/playground`](./packages/playground/) | Test dApp the network e2e suite drives end-to-end. |
| [`@nulo/landing`](./packages/landing/) | Marketing landing page. |

The package layer hierarchy (`wallet-core` → … → `extension`) is enforced via biome `noRestrictedImports`. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full picture.

## Where to read next

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — process boundaries, message flow, storage versioning, offscreen lifecycle, session model, concurrency, account contract, test taxonomy.
- Each `packages/<name>/README.md` — purpose, file map, scripts, testing, key invariants.
- [`packages/extension/tests/e2e/README.md`](./packages/extension/tests/e2e/README.md) — e2e suite layout, parallel-safe agent runner.
- [`implementations-plan/README.md`](./implementations-plan/README.md) — what the planning archive is, when to add to it, the milestone-vocabulary key.
- [`CLAUDE.md`](./CLAUDE.md) — operating rules for AI assistants working in this repo (layer model, SFC ordering, cleanup order, comment style).

## Build & dev

```bash
bun run dev                   # Chrome extension dev server, port 8088
bun run build                 # Production Chrome build
bun run test                  # Unit + component tests (vitest)
bun run test:e2e              # Smoke e2e (no Aztec sandbox)
bun run e2e:agent             # Network e2e — owns anvil + aztec + playground per worktree
bun run audit:vue             # One-shot pre-PR gate: typecheck → test → lint → build
bun run lint                  # biome check
bun run format                # biome format --write
bun run typecheck             # vue-tsc across all packages
```

## Quality gates

- **Bun** is the package manager. No yarn/npm/pnpm.
- **Biome** handles lint + format. Config in [`biome.json`](./biome.json); layer-import rules are enforced there.
- **Commitlint** enforces Conventional Commits. Config in [`.commitlintrc.json`](./.commitlintrc.json).
- **Git hooks** (pre-commit, commit-msg) are auto-installed via the `prepare` script on `bun install` (`.githooks/`).
- `bun run audit:vue` is the one-shot pre-PR gate.
- CI runs the same gates server-side plus smoke / network e2e. Full contributor guide at [`CI.md`](./CI.md).

## License

Apache License 2.0 — see [LICENSE](./LICENSE).

For credit to upstream contributors whose work seeded this project, see [ACKNOWLEDGEMENTS.md](./ACKNOWLEDGEMENTS.md).
