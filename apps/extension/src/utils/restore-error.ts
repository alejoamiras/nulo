/**
 * Normalize a caught value into a human-readable `restoreError` string.
 *
 * Every service's per-item restore catch funnels through this so the stored
 * `restoreError` is consistently a `string`: an `Error` contributes its
 * `message`, anything else is stringified. Keeps the shape uniform across all
 * restore sites and the import-error log that renders them.
 *
 * Pure + dependency-free (no vue, no chrome.*, no service clients) so it is
 * callable from both the service worker (restore producers) and the popup
 * (the error-log consumer).
 */
export function toRestoreError(err: unknown): string {
	return err instanceof Error ? err.message : String(err)
}
