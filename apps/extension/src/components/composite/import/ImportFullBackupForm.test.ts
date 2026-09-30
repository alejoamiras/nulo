import { mount } from "@vue/test-utils"
import { describe, expect, it, vi } from "vitest"
import { COLLAPSING_HERO } from "../collapsing-hero"
import ImportFullBackupForm from "./ImportFullBackupForm.vue"

const stubs = {
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: "<i></i>" },
	MaterialIcon: { template: "<i></i>" },
	Transition: { template: "<div><slot /></div>" },
	ItemsContainer: { template: "<div><slot /></div>" },
	SettingItem: {
		inheritAttrs: false,
		props: ["title", "description", "iconBgColor", "disabled"],
		emits: ["click"],
		// Forward $attrs so the production `data-testid` (and any future attrs)
		// reach the rendered root element, matching how Vue inherits attrs on
		// the real component.
		template:
			'<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')">{{ title }} | {{ description }} | {{ iconBgColor }}</button>',
	},
	Input: {
		props: ["modelValue", "label", "placeholder", "type", "error", "maxLength", "autofocus"],
		emits: ["update:modelValue", "input"],
		template: `<label><span>{{ label }}</span><input :value="modelValue" :placeholder="placeholder" :type="type" @input="$emit('update:modelValue', $event.target.value); $emit('input', $event)" /></label>`,
	},
}

const baseProps = (over = {}) => ({
	selectedBackup: null,
	restoreStatus: "",
	isRestoreHasErrors: false,
	error: { type: "", title: "", tooltip: "" },
	isCopied: false,
	maxPasswordLength: 128,
	...over,
})

describe("ImportFullBackupForm", () => {
	it("renders a file picker with the placeholder description when no backup selected", () => {
		const wrapper = mount(ImportFullBackupForm, { props: baseProps(), global: { stubs } })
		expect(wrapper.text()).toContain("Choose a backup file")
		expect(wrapper.text()).toContain(".json or .txt")
	})

	it("emits pickFile when the picker row is clicked", async () => {
		const wrapper = mount(ImportFullBackupForm, { props: baseProps(), global: { stubs } })
		await wrapper.find("[data-testid=import-full-backup-pick-file]").trigger("click")
		expect(wrapper.emitted("pickFile")).toBeTruthy()
	})

	it("disables the picker while a restore is in progress", () => {
		const wrapper = mount(ImportFullBackupForm, {
			props: baseProps({ restoreStatus: "progress" }),
			global: { stubs },
		})
		expect(wrapper.find("[data-testid=import-full-backup-pick-file]").attributes("disabled")).toBeDefined()
	})

	it("shows the full_backup error banner when error.type='full_backup'", () => {
		const wrapper = mount(ImportFullBackupForm, {
			props: baseProps({ error: { type: "full_backup", title: "Bad backup", tooltip: "broken" } }),
			global: { stubs },
		})
		expect(wrapper.text()).toContain("Error")
		expect(wrapper.text()).toContain("Bad backup")
		expect(wrapper.text()).toContain("broken")
	})

	it("includes both title and tooltip text inside the error banner", () => {
		const wrapper = mount(ImportFullBackupForm, {
			props: baseProps({ error: { type: "full_backup", title: "Bad", tooltip: "Some detail" } }),
			global: { stubs },
		})
		expect(wrapper.text()).toContain("Bad")
		expect(wrapper.text()).toContain("Some detail")
	})

	it("shows the decryption-password section when the backup is encrypted with no profileType", () => {
		const wrapper = mount(ImportFullBackupForm, {
			props: baseProps({ selectedBackup: { name: "x.txt", backup: "blob", type: "encrypted", profileType: null } }),
			global: { stubs },
		})
		expect(wrapper.text()).toContain("Decryption Password")
	})

	it("shows the new-password section for password-typed backups before restore starts", () => {
		const wrapper = mount(ImportFullBackupForm, {
			props: baseProps({
				selectedBackup: { name: "x.json", backup: {}, type: "plain", profileType: "password" },
				restoreStatus: "",
			}),
			global: { stubs },
		})
		expect(wrapper.text()).toContain("New Password")
	})

	it("hides the new-password section once restore is finished", () => {
		const wrapper = mount(ImportFullBackupForm, {
			props: baseProps({
				selectedBackup: { name: "x.json", backup: {}, type: "plain", profileType: "password" },
				restoreStatus: "finished",
			}),
			global: { stubs },
		})
		expect(wrapper.text()).not.toContain("New Password")
	})

	it("shows the restore-with-errors warning when restoreStatus='finished' and isRestoreHasErrors", () => {
		const wrapper = mount(ImportFullBackupForm, {
			props: baseProps({
				selectedBackup: { name: "x.json", backup: {}, type: "plain", profileType: "password" },
				restoreStatus: "finished",
				isRestoreHasErrors: true,
			}),
			global: { stubs },
		})
		expect(wrapper.text()).toContain("Warning")
		expect(wrapper.text()).toContain("import completed with some errors")
	})

	it("names the networks a Retry replays in the warning", () => {
		const wrapper = mount(ImportFullBackupForm, {
			props: baseProps({
				restoreStatus: "finished",
				isRestoreHasErrors: true,
				unrestoredNetworks: ["Alpha V5", "Testnet"],
				hasOtherErrors: true,
			}),
			global: { stubs },
		})
		expect(wrapper.get("[data-testid=import-full-backup-warning]").text()).toContain(
			"Alpha V5 and Testnet didn't answer in time, so what was saved for them may not be restored. You can retry, review the details, or continue.",
		)
	})

	it("scrolls the warning into view once, as it appears, and marks it an alert", async () => {
		const scroll = vi.spyOn(Element.prototype, "scrollIntoView")
		try {
			const wrapper = mount(ImportFullBackupForm, { props: baseProps({ restoreStatus: "progress" }), global: { stubs } })
			expect(scroll).not.toHaveBeenCalled()

			await wrapper.setProps({ restoreStatus: "finished", isRestoreHasErrors: true, unrestoredNetworks: ["Alpha V5"] })
			const warning = wrapper.get("[data-testid=import-full-backup-warning]")
			expect(warning.attributes("role")).toBe("alert")
			expect(scroll).toHaveBeenCalledOnce()
			expect(scroll).toHaveBeenCalledWith({ block: "nearest" })
			expect(scroll.mock.contexts[0]).toBe(warning.element)

			await wrapper.setProps({ unrestoredNetworks: [] })
			expect(scroll).toHaveBeenCalledOnce()
		} finally {
			scroll.mockRestore()
		}
	})

	it("hands the warning to an enclosing collapsing hero instead of scrolling it itself", async () => {
		const scroll = vi.spyOn(Element.prototype, "scrollIntoView")
		const reveal = vi.fn()
		try {
			const wrapper = mount(ImportFullBackupForm, {
				props: baseProps({ restoreStatus: "progress" }),
				global: { stubs, provide: { [COLLAPSING_HERO as symbol]: { reveal } } },
			})
			await wrapper.setProps({ restoreStatus: "finished", isRestoreHasErrors: true })
			expect(reveal).toHaveBeenCalledOnce()
			expect(reveal).toHaveBeenCalledWith(wrapper.get("[data-testid=import-full-backup-warning]").element)
			expect(scroll).not.toHaveBeenCalled()
		} finally {
			scroll.mockRestore()
		}
	})
})
