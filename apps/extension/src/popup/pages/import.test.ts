/**
 * Component tests for the popup import page's Enter shortcut on the full-backup form: an Enter in one
 * of the page's fields runs the stage's action once, a focused button runs only its own action, a
 * repeat Enter on a CTA runs nothing, and a key in the error viewer (a shell popup outside the page)
 * never continues the import.
 */

import { createTestingPinia } from "@pinia/testing"
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createApp, h, ref } from "vue"

const holder = vi.hoisted(() => ({ flow: undefined as unknown as ReturnType<typeof makeFlow> }))
vi.mock("@/composables/useProfileImportFlow", () => ({ useProfileImportFlow: () => holder.flow }))
vi.mock("@/composables/completeImportWithRecovery", () => ({ completeImportWithRecovery: vi.fn(async () => "active") }))
vi.mock("@/composables/useProfileBootstrap", () => ({ useProfileBootstrap: () => ({ hydrateKnownProfile: vi.fn() }) }))
vi.mock("@/composables/waitForProfileActive", () => ({ waitForProfileActive: vi.fn() }))
vi.mock("@/composables/toast", () => ({ useToast: () => ({ openToast: vi.fn() }) }))
vi.mock("@/utils/lastActiveProfile", () => ({ setLastActiveProfileId: vi.fn(async () => undefined) }))
vi.mock("@/wallet/utils/onboarding-tab", () => ({ redirectToOnboardingTabIfNeeded: vi.fn() }))
vi.mock("vue-router", () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }))

import { openSearchPanel } from "@codemirror/search"
import { EditorView } from "@codemirror/view"
import { Flex, Input, MaterialIcon, Text } from "@nulo/design"
import { pressOn } from "../../../tests/helpers/press-key"
import JsonViewer from "@/components/JsonViewer/JsonViewer.vue"
import SubPageHeader from "@/components/ui/SubPageHeader.vue"
import { setLastActiveProfileId } from "@/utils/lastActiveProfile"
import ImportPage from "./import.vue"

/** The flow's surface with a decrypted password-profile backup chosen and a valid new password. */
function makeFlow() {
	return {
		nameFieldState: ref("hidden"),
		profileName: ref(""),
		nameError: ref(""),
		shakeName: ref(false),
		nameInputRef: ref(null),
		handleNameInput: vi.fn(),
		ceremonyRequest: ref(null),
		onCeremonyResolve: vi.fn(),
		onCeremonyReject: vi.fn(),
		selectedImportOption: ref<string | null>("full_backup"),
		seedPhrase: ref(undefined),
		password: ref("password123"),
		repeatedPassword: ref("password123"),
		maxPasswordLength: 128,
		error: ref({ type: "", title: "", tooltip: "" }),
		isCopied: ref(false),
		isAllowedToImportBySeedPhrase: ref(false),
		selectedBackup: ref({
			name: "backup.txt",
			type: "encrypted",
			profileType: "password",
			backup: { data: { profile: { name: "Main" } } },
		}),
		decryptionPassword: ref(""),
		restoreStatus: ref(""),
		restoreStage: ref(undefined),
		importedProfile: ref<{ id: string } | null>(null),
		isAllowedToImportBackup: ref(true),
		isRestoreHasErrors: ref(false),
		pickBackupFile: vi.fn(),
		decryptBackup: vi.fn(),
		restoreBackup: vi.fn(),
		showRestoreErrorLog: vi.fn(),
		handleImportSeed: vi.fn(),
		handleImportPasskey: vi.fn(),
		handlePasswordInput: vi.fn(),
		handleSecretInput: vi.fn(),
		handleCopyError: vi.fn(),
		handleBack: vi.fn(),
		dispose: vi.fn(),
	}
}

function finishWithErrors() {
	holder.flow.restoreStatus.value = "finished"
	holder.flow.isRestoreHasErrors.value = true
	holder.flow.importedProfile.value = { id: "p9" }
}

const wrappers: VueWrapper[] = []
const cleanups: Array<() => void> = []

async function mountImport() {
	const w = mount(ImportPage, {
		attachTo: document.body,
		global: {
			plugins: [createTestingPinia({ createSpy: vi.fn })],
			components: { Flex, Input, MaterialIcon, SubPageHeader, Text },
			stubs: {
				Button: { template: "<button><slot /></button>" },
				Icon: true,
				ItemsContainer: { template: "<div><slot /></div>" },
				SettingItem: true,
				PasskeyCeremonyDialog: true,
			},
		},
	})
	wrappers.push(w)
	await flushPromises()
	return w
}

/** jsdom lays nothing out and has no `Range.getClientRects`, which CodeMirror's measure pass reads:
 *  ranges get empty rects until the returned restore runs. */
function giveRangesEmptyRects(): () => void {
	const proto = Range.prototype as { getClientRects?: () => DOMRectList }
	if (proto.getClientRects) return () => {}
	proto.getClientRects = () => [] as unknown as DOMRectList
	return () => void Reflect.deleteProperty(proto, "getClientRects")
}

/** Shows the real viewer in an app of its own outside the page, where the shell's popup manager
 *  renders it (a second VTU mount would drop the page's stubs), and returns its editor. */
async function showErrorViewer(data: Record<string, unknown[]>): Promise<EditorView> {
	const restoreRects = giveRangesEmptyRects()
	const app = createApp({ render: () => h(JsonViewer, { data }) })
	app.component("Icon", { render: () => h("i") })
	const host = document.body.appendChild(document.createElement("div"))
	app.mount(host)
	await flushPromises()
	const editor = host.querySelector<HTMLElement>(".cm-editor")
	const view = editor && EditorView.findFromDOM(editor)
	cleanups.push(() => {
		// Destroying the view cancels its pending measure before the rects go.
		view?.destroy()
		app.unmount()
		restoreRects()
	})
	if (!view) throw new Error("the viewer rendered no editor")
	return view
}

const enterKey = () => new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true, cancelable: true })

beforeEach(() => {
	vi.clearAllMocks()
	holder.flow = makeFlow()
	const c = (globalThis as { chrome?: { storage: Record<string, unknown> } }).chrome
	if (c) {
		c.storage.local = { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) }
		c.storage.onChanged = { addListener: vi.fn(), removeListener: vi.fn() }
	}
})

afterEach(() => {
	for (const w of wrappers.splice(0)) w.unmount()
	for (const c of cleanups.splice(0)) c()
	document.body.innerHTML = ""
})

describe("popup import — full backup, a restore ready", () => {
	test("Enter on Back goes back and restores nothing", async () => {
		const w = await mountImport()
		const back = w.findAll("button").find((b) => b.text() === "Back")
		if (!back) throw new Error("no Back button")
		pressOn(back.element, "Enter")
		await flushPromises()
		expect(holder.flow.handleBack).toHaveBeenCalledTimes(1)
		expect(holder.flow.restoreBackup).not.toHaveBeenCalled()
	})

	test("(preservation) Enter in the repeat-password field restores once", async () => {
		const w = await mountImport()
		w.get('[data-testid="import-full-backup-password-confirm-input"] input').element.dispatchEvent(enterKey())
		await flushPromises()
		expect(holder.flow.restoreBackup).toHaveBeenCalledTimes(1)
	})
})

describe("popup import — full backup, finished with errors", () => {
	test("Enter on View Errors opens the error log and does not continue", async () => {
		finishWithErrors()
		const w = await mountImport()
		pressOn(w.get('[data-testid="import-full-backup-view-errors-btn"]').element as HTMLElement, "Enter")
		await flushPromises()
		expect(holder.flow.showRestoreErrorLog).toHaveBeenCalledTimes(1)
		expect(setLastActiveProfileId).not.toHaveBeenCalled()
	})

	test("a repeat Enter on Continue continues nothing", async () => {
		finishWithErrors()
		const w = await mountImport()
		pressOn(w.get('[data-testid="import-full-backup-continue-btn"]').element as HTMLElement, "Enter", { repeat: true })
		await flushPromises()
		expect(setLastActiveProfileId).not.toHaveBeenCalled()
	})

	test("Enter in the error viewer's search finds the next match, and on its checkbox does nothing, never continuing", async () => {
		finishWithErrors()
		await mountImport()
		const view = await showErrorViewer({ token: ["t1: network mismatch"], contact: ["c1: network mismatch"] })
		openSearchPanel(view)
		const search = view.dom.querySelector<HTMLInputElement>('input[name="search"]')
		const matchCase = view.dom.querySelector<HTMLInputElement>('input[name="case"]')
		if (!search || !matchCase) throw new Error("the search panel did not open")
		search.value = "mismatch"
		search.dispatchEvent(new Event("change"))

		search.focus()
		search.dispatchEvent(enterKey())
		const { from, to } = view.state.selection.main
		expect(view.state.sliceDoc(from, to)).toBe("mismatch")

		matchCase.focus()
		matchCase.dispatchEvent(enterKey())
		await flushPromises()
		expect(setLastActiveProfileId).not.toHaveBeenCalled()
	})
})
