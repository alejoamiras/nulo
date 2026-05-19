/**
 * Test doubles for wallet-core's port interfaces. Import from
 * `@nulo/wallet-core/testing` in colocated `.test.ts` files.
 *
 * `FakeNodeFactory` does NOT live here — it depends on `@aztec/stdlib`'s
 * `AztecNode` type and `wallet-core` is Aztec-free. It lives in
 * `@nulo/aztec-runtime`.
 */

export { MockClock } from "./mock-clock"
export { FakeBrowserApi } from "./fake-browser-api"
export { FakeBackgroundTicker } from "./fake-background-ticker"
