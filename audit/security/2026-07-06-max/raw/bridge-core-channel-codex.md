CLUSTER: bridge-core-channel

## Findings
_No findings meeting the bar._

## Notes
Checked `packages/bridge-core/src` for the requested channel surface. The scoped package does not implement a postMessage transport, key exchange, encrypted channel, origin/source validation, or protocol frame parser; its barrel exports bridge logic, journal/recovery helpers, and L1/L2 transaction builders (`packages/bridge-core/src/index.ts:1`).

The actual postMessage/key-exchange channel is one handoff hop outside this cluster: the content script delegates discovery, `MessageChannel`, key exchange relay, and encrypted relay to `@aztec/wallet-sdk/extension/handlers` (`apps/extension/src/content-script/content.ts:1`), and the background wiring uses `BackgroundConnectionHandler` with wrapper-side subframe rejection and content-script envelope validation before forwarding (`apps/extension/src/wallet/services/wallet-sdk/background.ts:135`).

Within the scoped files, the reachable crypto/parse paths I checked did not produce a concrete exploit trace: recovery keys are derived from per-record signed messages (`packages/bridge-core/src/recovery-crypto.ts:27`), encryption/decryption goes through `EncryptionKey` (`packages/bridge-core/src/recovery-crypto.ts:50`), decrypted envelopes are JSON-parsed then shape-checked before use (`packages/bridge-core/src/recovery-crypto.ts:129`), local journal JSON parse failures drop to an empty record set (`packages/bridge-core/src/journal.ts:160`), backup import validates and cross-checks sealed contents against unauthenticated headers (`packages/bridge-core/src/backup.ts:185`), and swap bridge signatures bind route/amounts/recipients/secrets/swap target into the Permit2 witness (`packages/bridge-core/src/l1.ts:104`, `packages/bridge-core/src/flows.ts:308`).