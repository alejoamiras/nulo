import { describe, expect, test } from "vitest"
import { useFormState } from "./useFormState"

describe("composables/useFormState", () => {
	test("each field is initialized with its initial value", () => {
		const form = useFormState({
			name: { initial: "" },
			age: { initial: 0 },
			active: { initial: true },
		})
		expect(form.fields.name.value.value).toBe("")
		expect(form.fields.age.value.value).toBe(0)
		expect(form.fields.active.value.value).toBe(true)
	})

	test("setting a field's value updates it reactively", () => {
		const form = useFormState({ name: { initial: "" } })
		form.fields.name.value.value = "Alice"
		expect(form.fields.name.value.value).toBe("Alice")
		expect(form.values.value.name).toBe("Alice")
	})

	test("error reflects validate's return immediately (no touched gating)", () => {
		const form = useFormState({
			name: { initial: "", validate: (v) => (v ? null : "required") },
		})
		expect(form.fields.name.error.value).toBe("required")
		expect(form.fields.name.touched.value).toBe(false)
	})

	test("error clears once value passes validate", () => {
		const form = useFormState({
			name: { initial: "", validate: (v) => (v ? null : "required") },
		})
		expect(form.fields.name.error.value).toBe("required")
		form.fields.name.value.value = "Alice"
		expect(form.fields.name.error.value).toBeNull()
	})

	test("touched is a separate signal — callers compose with error for blur-gated UX", () => {
		const form = useFormState({
			name: { initial: "", validate: (v) => (v ? null : "required") },
		})
		// Caller pattern: only display error after blur.
		const shouldDisplay = () => form.fields.name.touched.value && Boolean(form.fields.name.error.value)
		expect(shouldDisplay()).toBe(false)
		form.fields.name.touch()
		expect(shouldDisplay()).toBe(true)
	})

	test("touchAll() marks every field as touched", () => {
		const form = useFormState({
			a: { initial: "", validate: () => "err-a" },
			b: { initial: "", validate: () => "err-b" },
		})
		expect(form.fields.a.touched.value).toBe(false)
		expect(form.fields.b.touched.value).toBe(false)
		form.touchAll()
		expect(form.fields.a.touched.value).toBe(true)
		expect(form.fields.b.touched.value).toBe(true)
	})

	test("reset() restores all fields to their initial values + clears touched", () => {
		const form = useFormState({
			name: { initial: "default", validate: (v) => (v ? null : "required") },
			age: { initial: 18 },
		})
		form.fields.name.value.value = "Alice"
		form.fields.age.value.value = 30
		form.fields.name.touch()
		expect(form.fields.name.touched.value).toBe(true)

		form.reset()
		expect(form.fields.name.value.value).toBe("default")
		expect(form.fields.age.value.value).toBe(18)
		expect(form.fields.name.touched.value).toBe(false)
	})

	test("per-field reset() restores only that field", () => {
		const form = useFormState({
			a: { initial: "x" },
			b: { initial: "y" },
		})
		form.fields.a.value.value = "A2"
		form.fields.b.value.value = "B2"
		form.fields.a.reset()
		expect(form.fields.a.value.value).toBe("x")
		expect(form.fields.b.value.value).toBe("B2")
	})

	test("isValid is true when no fields have validators (or all pass)", () => {
		const form = useFormState({
			a: { initial: "" },
			b: { initial: "" },
		})
		expect(form.isValid.value).toBe(true)
	})

	test("isValid is false when any field's validate returns an error", () => {
		const form = useFormState({
			a: { initial: "", validate: (v) => (v ? null : "required") },
			b: { initial: "ok" },
		})
		expect(form.isValid.value).toBe(false)
		form.fields.a.value.value = "filled"
		expect(form.isValid.value).toBe(true)
	})

	test("isValid is independent of touched state (drives submit button)", () => {
		const form = useFormState({
			a: { initial: "", validate: (v) => (v ? null : "required") },
		})
		// Untouched is the only state we care about for this test —
		// isValid still returns false because validate fails on the
		// initial empty value.
		expect(form.fields.a.touched.value).toBe(false)
		expect(form.isValid.value).toBe(false)
	})

	test("isDirty is false initially and true after any field changes", () => {
		const form = useFormState({
			name: { initial: "Alice" },
			age: { initial: 18 },
		})
		expect(form.isDirty.value).toBe(false)
		form.fields.age.value.value = 19
		expect(form.isDirty.value).toBe(true)
	})

	test("isDirty becomes false after reset()", () => {
		const form = useFormState({ name: { initial: "" } })
		form.fields.name.value.value = "changed"
		expect(form.isDirty.value).toBe(true)
		form.reset()
		expect(form.isDirty.value).toBe(false)
	})

	test("cross-field validation: validate receives all current values", () => {
		const form = useFormState({
			password: { initial: "" },
			confirm: {
				initial: "",
				validate: (v, all) => (v === (all as { password: string }).password ? null : "must match"),
			},
		})
		form.fields.password.value.value = "secret"
		form.fields.confirm.value.value = "wrong"
		form.fields.confirm.touch()
		expect(form.fields.confirm.error.value).toBe("must match")
		form.fields.confirm.value.value = "secret"
		expect(form.fields.confirm.error.value).toBeNull()
	})

	test("fields without validate always pass (no error shown after touch)", () => {
		const form = useFormState({ note: { initial: "" } })
		form.fields.note.touch()
		expect(form.fields.note.error.value).toBeNull()
		expect(form.isValid.value).toBe(true)
	})

	test("values computed snapshots all current field values", () => {
		const form = useFormState({
			a: { initial: 1 },
			b: { initial: 2 },
		})
		form.fields.a.value.value = 10
		form.fields.b.value.value = 20
		expect(form.values.value).toEqual({ a: 10, b: 20 })
	})
})
