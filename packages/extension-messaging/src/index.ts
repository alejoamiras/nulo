/**
 * @nulo/extension-messaging — typed RPC layer for Chrome extension
 * background/popup/offscreen communication.
 *
 * Consumers should import from the subpath that matches the concern:
 *   - `@nulo/extension-messaging/background` — Service<T> + ServiceClient<T> (popup ↔ SW via Port)
 *   - `@nulo/extension-messaging/offscreen`  — Service + ServiceClient (SW ↔ offscreen via sendMessage)
 *   - `@nulo/extension-messaging/errors`     — WalletError hierarchy + payload helpers
 *   - `@nulo/extension-messaging/messages`   — MessageType enum + envelope types
 *   - `@nulo/extension-messaging/utils`      — wrapParams / unwrapParams
 *   - `@nulo/extension-messaging/zod`        — validateParams / validateResult (requires zod peer dep)
 *
 * Package is Chrome-extension bound (uses `chrome.runtime.*`). It
 * depends on `@nulo/wallet-core` for `ILogger`, `EventHandler`,
 * `jsonSanitize`, `sleep`, `array_max`, and base service types
 * (`IService`, `ServiceCollection`, `EventsMap`, `MethodsMap`, etc.).
 */
export {}
