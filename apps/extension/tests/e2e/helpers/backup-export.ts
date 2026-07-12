/**
 * Capture a full-backup download IN-PAGE, without the native permission
 * prompt or the filesystem: `downloads` is an OPTIONAL manifest permission
 * (its browser prompt is un-clickable from puppeteer), so the stub grants the
 * permission check, replaces `chrome.downloads.download`, fetches the blob
 * URL INSIDE the stub (before `downloadFile`'s `finally` revokes it) and
 * gunzips it with the page's own `DecompressionStream`.
 *
 * Two-phase on purpose: `armBackupDownloadCapture` BEFORE clicking the
 * download CTA, `readCapturedBackupDownload` after. The captured string is
 * the decompressed file content — parsed JSON for a plain backup, the base64
 * ciphertext for an encrypted one.
 */
import type { Page } from "puppeteer"

export async function armBackupDownloadCapture(page: Page): Promise<void> {
	await page.evaluate(() => {
		const w = window as unknown as { __backupCapture?: Promise<string> }
		w.__backupCapture = new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("backup download was not captured within 30s")), 30_000)
			const c = chrome as unknown as {
				permissions: { contains: (p: unknown, cb: (has: boolean) => void) => void }
				downloads: { download: (opts: { url: string }, cb: (id: number) => void) => void }
			}
			c.permissions.contains = (_perms, cb) => cb(true)
			c.downloads = {
				download: (opts, cb) => {
					fetch(opts.url)
						.then((r) => r.blob())
						.then(async (blob) => {
							const ds = new DecompressionStream("gzip")
							const text = await new Response(blob.stream().pipeThrough(ds)).text()
							clearTimeout(timer)
							resolve(text)
							cb(1)
						})
						.catch((err) => {
							clearTimeout(timer)
							reject(err instanceof Error ? err : new Error(String(err)))
						})
				},
			}
		})
		// Swallow the (test-only) unhandled rejection if the click never fires.
		w.__backupCapture.catch(() => {})
	})
}

export async function readCapturedBackupDownload(page: Page): Promise<string> {
	return await page.evaluate(() => (window as unknown as { __backupCapture: Promise<string> }).__backupCapture)
}
