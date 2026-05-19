/**
 * @nulo/wallet-core — the Aztec-free, Chrome-free kernel of the wallet.
 *
 * Consumers should import from the subpath that matches the concern:
 *   - `@nulo/wallet-core/ports`   — I/O boundary interfaces
 *   - `@nulo/wallet-core/utils`   — pure utilities (EventHandler, Lock, etc.)
 *   - `@nulo/wallet-core/storage` — EntityStorage + ValueStorage
 *   - `@nulo/wallet-core/base`    — ServiceCollection + topology
 *   - `@nulo/wallet-core/logger`  — ILogger + LogLevel + Log interfaces
 *   - `@nulo/wallet-core/testing` — FakeBrowserApi / MockClock / FakeBackgroundTicker
 *
 * This barrel is intentionally empty; narrow subpaths give better IDE
 * navigation + tree-shaking than a mega-export.
 */
export {}
