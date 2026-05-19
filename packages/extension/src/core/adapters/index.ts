/**
 * Default (real) adapter implementations of the ports. The composition root
 * instantiates these once at the extension shell; services receive them as
 * dependencies and never import them directly.
 */

export { SystemClock } from "./system-clock"
export { RealChromeBrowserApi } from "./chrome-browser-api"
export { ClockTickerAdapter } from "./clock-ticker-adapter"
// `AztecNodeFactoryAdapter` lives in `@nulo/aztec-runtime`, re-exported
// here so the composition root can import every adapter from one place.
export { AztecNodeFactoryAdapter } from "@nulo/aztec-runtime/adapters"
