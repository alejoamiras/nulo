/**
 * Shared primitives used across every port.
 */

/** Callback returned by `on*` subscribers; call to stop receiving events. */
export type Unsubscribe = () => void
