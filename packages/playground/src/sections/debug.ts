import { getState } from "../state"

/**
 * Debug section: protocol log + last-error display. Test mode hides the
 * protocol log to keep the DOM minimal for testid queries.
 */
export function renderDebug(): string {
	const s = getState()
	return `
		<fieldset class="pg-section">
			<legend>Debug</legend>
			<div data-testid="pg-error-text" role="alert" class="pg-error">${s.lastError ?? ""}</div>
			<details>
				<summary>Protocol log (${s.protocolLog.length})</summary>
				<pre data-testid="pg-protocol-log">${s.protocolLog.map((l) => `${l.ts} ${l.direction} ${l.type}`).join("\n")}</pre>
			</details>
		</fieldset>
	`
}

export function bindDebug(_root: HTMLElement): void {
	// no-op
}
