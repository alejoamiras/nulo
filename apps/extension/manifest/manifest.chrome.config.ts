import { defineManifest } from "@crxjs/vite-plugin"

import ManifestConfig from "./manifest.config"

// An unpacked build derives its extension id from its load path, so every worktree and machine is
// a different origin to Presto (its own approval prompt). Development builds carry this public key
// instead and share one id (gponbolnnkmjaafcnoeckiplpehdfgml); the store build takes its id from
// the store's key. The matching private key was discarded — nothing signs with it.
const DEVELOPMENT_KEY =
	"MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsTgub07HSXXAwhSqtMaPHYDYWgkzZetkxifvCieFvR6lsSZotS6byt5UlxdQ9A0OJNrmRPYKlucWL0VwKkYI355kOQ+sacghg/c9C1pBHQ6iQs2xlLPSwEWxkKR0jhPWvLLP/23F8C6g2E7uNkjPKbicDlO494fsGHhODT5ld7kCvmO20oPS6C1KTiAzgv++6FbBC4jb9ZAtPPnZdNRGB3xM88OCtQLtyh6VXgF7x6KR43UKhvBO4V37MEHhqEv+ho5e7w0C2Yt9yvJehWh2oIbA/5KaWBHkksPcCSB+BdSuWPIprOYngvdg6ZkRcvGsKvZ0I3GRbhGjFkgGQoFFtwIDAQAB"

// @ts-expect-error ManifestConfig provides all required fields
export default defineManifest((env) => ({
	...ManifestConfig,
	...(env.mode === "development" ? { key: DEVELOPMENT_KEY } : {}),
}))
