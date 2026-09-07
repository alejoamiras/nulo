/**
 * Block until an e2e hold on a `chrome.storage.session` key clears. Event-driven on the key's
 * removal, with a safety timeout so a test that armed the key and died still releases the wallet,
 * and a re-check after subscribing that closes the release-between-check-and-subscribe race.
 * `stillHeld` resolves true while the gate is still held (each gate decides what "held" means);
 * `onFinish` runs fire-and-forget before resolve (the proof and restore gates clear their key there).
 */
export function waitForStorageRelease(opts: {
	key: string
	stillHeld: () => Promise<boolean>
	timeoutMs: number
	onTimeout: () => void
	onFinish?: () => void
}): Promise<void> {
	return new Promise<void>((resolve) => {
		let settled = false
		const finish = (reason: "released" | "timeout"): void => {
			if (settled) return
			settled = true
			chrome.storage.onChanged.removeListener(onChange)
			clearTimeout(timer)
			if (reason === "timeout") opts.onTimeout()
			opts.onFinish?.()
			resolve()
		}
		const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
			if (area === "session" && opts.key in changes && changes[opts.key].newValue === undefined) finish("released")
		}
		const timer = setTimeout(() => finish("timeout"), opts.timeoutMs)
		chrome.storage.onChanged.addListener(onChange)
		opts.stillHeld().then((held) => {
			if (!held) finish("released")
		})
	})
}
