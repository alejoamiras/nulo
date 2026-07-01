/**
 * Re-export shim. `requiresFeeSelection` + `assertExecutableOperation` moved DOWN
 * to `@nulo/wallet-bridge` (`operation-validation.ts`, beside `Operation`) so the
 * dApp-interaction materializer can share the SAME draft→executable narrowing the
 * popup uses — without importing UP from the popup layer. Kept as a shim so the
 * popup + this window's tests keep importing from `./operation-validation`.
 */

export { assertExecutableOperation, requiresFeeSelection } from "@nulo/wallet-bridge"
