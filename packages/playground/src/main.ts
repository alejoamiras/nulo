/**
 * Nulo Playground entry.
 *
 * Single-page app exposing every wallet-sdk RPC surface the Nulo extension
 * supports, with stable testids on every interactive element and a
 * DOM-readable result feed (monotonic `data-result-seq`).
 *
 * The playground is a TEST FIXTURE, not a product. Plain DOM updates only —
 * a framework's reactivity bugs would be a flake source.
 *
 * Section files render their HTML and bind their click handlers in two passes:
 *   1) `render()` paints the entire DOM from `state` (innerHTML).
 *   2) `bind*()` registers click handlers on the freshly painted nodes.
 *
 * Re-render after every state change keeps it simple. Result feed is bounded
 * to 100 rows to keep the DOM small in long sessions.
 */
import { renderConnect, bindConnect } from "./sections/connect"
import { renderMeta, bindMeta } from "./sections/meta"
import { renderContracts, bindContracts } from "./sections/contracts"
import { renderSimulation, bindSimulation } from "./sections/simulation"
import { renderTransactions, bindTransactions } from "./sections/transactions"
import { renderAuthwit, bindAuthwit } from "./sections/authwit"
import { renderData, bindData } from "./sections/data"
import { renderBatch, bindBatch } from "./sections/batch"
import { renderDebug, bindDebug } from "./sections/debug"
import { getState, setRenderFn, setInput } from "./state"

const app = document.querySelector<HTMLDivElement>("#app")!

function renderHeader(): string {
	const s = getState()
	const accountText = s.selectedAccount ? `${s.selectedAccount.slice(0, 6)}…${s.selectedAccount.slice(-4)}` : "—"
	const chainText = s.chainId !== null ? String(s.chainId) : "—"
	return `
		<header data-testid="pg-header" data-status="${s.status}">
			<span data-testid="pg-status" data-status="${s.status}">${s.status}</span>
			<span data-testid="pg-account">${accountText}</span>
			<span data-testid="pg-chain">${chainText}</span>
		</header>
	`
}

function renderAccounts(): string {
	const s = getState()
	const items = s.accounts
		.map(
			(a) =>
				`<li data-testid="pg-account-item" data-account-id="${a.address}" data-account-name="${a.name}">${a.name} (${a.address.slice(0, 10)}…)</li>`,
		)
		.join("")
	return `
		<fieldset class="pg-section">
			<legend>Accounts (${s.accounts.length})</legend>
			<ul data-testid="pg-account-list">${items || "<li>—</li>"}</ul>
		</fieldset>
	`
}

function renderResults(): string {
	const s = getState()
	// Bound to last 100 rows; tests look up by data-result-seq snapshot
	const rows = s.results
		.slice(-100)
		.map((r) => {
			const json = r.status === "ok" ? r.resultJson : r.errorJson
			const escaped = (json ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
			return `
				<div data-testid="pg-result"
				     data-result-seq="${r.seq}"
				     data-method="${r.method}"
				     data-status="${r.status}"
				     data-result-json="${escaped}">
					<span class="seq">#${r.seq}</span>
					<span class="method">${r.method}</span>
					<span class="status status-${r.status}">${r.status}</span>
				</div>
			`
		})
		.join("")
	return `
		<fieldset class="pg-section">
			<legend>Result feed (${s.results.length})</legend>
			<div data-testid="pg-result-feed">${rows || "<div>—</div>"}</div>
		</fieldset>
	`
}

function render(): void {
	const inputValues = collectInputs()
	app.innerHTML = `
		${renderHeader()}
		${renderConnect()}
		${renderAccounts()}
		${renderMeta()}
		${renderContracts()}
		${renderSimulation()}
		${renderTransactions()}
		${renderAuthwit()}
		${renderData()}
		${renderBatch()}
		${renderResults()}
		${renderDebug()}
	`
	restoreInputs(inputValues)
	bindAll()
}

// Match every named form control — render() rebuilds the DOM on every state
// change, so we collect/restore values for input, select, and textarea, not
// just input. Without this, selects (e.g. pg-bundle-select) and textareas
// (e.g. pg-input-contractInstance) lose their values across re-renders.
type NamedField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
const FIELD_SELECTOR = "input[name], select[name], textarea[name]"

function collectInputs(): Record<string, string> {
	const out: Record<string, string> = {}
	app.querySelectorAll<NamedField>(FIELD_SELECTOR).forEach((el) => {
		out[el.name] = el.value
	})
	return out
}

function restoreInputs(values: Record<string, string>): void {
	app.querySelectorAll<NamedField>(FIELD_SELECTOR).forEach((el) => {
		const v = values[el.name]
		if (v !== undefined) el.value = v
	})
}

function bindAll(): void {
	bindConnect(app)
	bindMeta(app)
	bindContracts(app)
	bindSimulation(app)
	bindTransactions(app)
	bindAuthwit(app)
	bindData(app)
	bindBatch(app)
	bindDebug(app)

	// Sync field values to state on input/change so handlers can read
	// consistently. Use both events: "input" fires on input/textarea typing,
	// "change" fires on select selection.
	app.querySelectorAll<NamedField>(FIELD_SELECTOR).forEach((el) => {
		const sync = () => setInput(el.name, el.value)
		el.addEventListener("input", sync)
		el.addEventListener("change", sync)
	})
}

setRenderFn(render)
render()
