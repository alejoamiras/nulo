/**
 * Decode base64 the forgiving `Buffer` way, on purpose: a garbled stored value decodes instead of
 * throwing. It skips characters outside the alphabet, stops at the first `=`, accepts the URL-safe
 * alphabet and missing padding, and returns the `Buffer` itself. Which non-ASCII input it skips
 * depends on the `Buffer` in scope (the bundled polyfill or the runtime's own), so the bare
 * identifier is deliberate. New code uses the strict `fromBase64`.
 */
export const fromBase64Lenient = (b64: string): Buffer<ArrayBuffer> => Buffer.from(b64, "base64")
