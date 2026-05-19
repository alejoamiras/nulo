/**
 * Composite of every browser-side port. Services take this as a single
 * dependency instead of four separate ones, and the real implementation
 * (`RealChromeBrowserApi`) or test fake (`FakeBrowserApi`) is swapped as
 * one unit at the composition root.
 */

import type { AlarmsPort } from "./alarms-port"
import type { RuntimePort } from "./runtime-port"
import type { StoragePort } from "./storage-port"
import type { WindowPort } from "./window-port"

export interface BrowserApi {
	storage: StoragePort
	runtime: RuntimePort
	windows: WindowPort
	alarms: AlarmsPort
}
