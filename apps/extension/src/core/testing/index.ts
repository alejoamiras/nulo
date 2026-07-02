/**
 * Extension-local test doubles.
 *
 * `FakeNodeFactory` lives here because it depends on `@aztec/stdlib`'s
 * `AztecNode` type — `@nulo/wallet-core/testing` is Aztec-free.
 *
 * Other port fakes (`FakeBrowserApi`, `MockClock`, `FakeBackgroundTicker`)
 * live in `@nulo/wallet-core/testing` — import from there directly.
 */
export { FakeNodeFactory, type FakeNodeOverrides } from "./fake-node-factory"
