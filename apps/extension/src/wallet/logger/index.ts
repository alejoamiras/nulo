/**
 * Logger barrel for the extension.
 *
 * Pure interfaces (`ILogger`, `LogLevel`, `Log`, `LogContext`,
 * `ILoggerStore`, `consoleMethods`) live in `@nulo/wallet-core/logger`.
 * The chrome-backed `LoggerStore` impl lives here because it reaches
 * into `chrome.storage.session` for crash-recovery rehydration. Utility
 * helpers (`DummyLogger`, `CircularBuffer`, `trim`, `print`) live here
 * for now.
 */
export * from "@nulo/wallet-core/logger"
export * from "./store"
export * from "./utils"
