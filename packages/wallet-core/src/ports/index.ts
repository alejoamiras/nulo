/**
 * Ports are interfaces that name the I/O boundaries of the wallet kernel.
 *
 * Services take ports as dependencies instead of calling `chrome.*` or
 * `setTimeout` directly. This is what makes the majority of the codebase
 * unit-testable — the composition root wires real adapters, tests wire
 * fakes.
 *
 * `NodeFactory` lives in `@nulo/aztec-runtime/ports`, not here, because it
 * types `AztecNode` from `@aztec/stdlib` and `wallet-core` is Aztec-free.
 */

export type { Unsubscribe } from "./types"
export type { ClockPort, TimerHandle } from "./clock-port"
export type { StoragePort, StorageArea, StorageEntries, StorageChanges } from "./storage-port"
export type { RuntimePort, MessagePortLike, MessageSender, MessageListener } from "./runtime-port"
export type { WindowPort, CreatedWindow, CreateWindowOptions } from "./window-port"
export type { AlarmsPort, AlarmCreateOptions, AlarmEvent } from "./alarms-port"
export type { BrowserApi } from "./browser-api"
export type { BackgroundTickerPort, TickerHandle } from "./background-ticker-port"
