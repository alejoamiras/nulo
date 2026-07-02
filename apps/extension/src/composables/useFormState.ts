import type { ComputedRef, Ref } from "vue"
import { computed, reactive, ref } from "vue"

/**
 * Per-field definition for `useFormState`.
 *
 * - `initial` — starting value, also restored by `reset()`.
 * - `validate` — synchronous rule. Return a string (the error message) or
 *   `null`/`undefined` for valid. Receives the field value plus a snapshot
 *   of all current field values so cross-field rules (e.g. "passwords must
 *   match") can read siblings.
 */
export interface FieldDef<TValue = unknown> {
	initial: TValue
	validate?: (value: TValue, all: Readonly<Record<string, unknown>>) => string | null | undefined
}

/** The reactive handle returned per field. */
export interface FieldHandle<TValue = unknown> {
	/** Two-way reactive ref. Bind via `v-model="form.fields.x.value"`. */
	value: Ref<TValue>
	/** Validation error message, or `null` if valid. Always reflects the
	 *  current validate() result regardless of touched state — callers
	 *  decide when to display via `v-if="field.error"` (always) or
	 *  `v-if="field.touched && field.error"` (after blur only). */
	error: ComputedRef<string | null>
	/** True iff this field's value differs from its baseline (its `initial`,
	 *  or the last `rebase()` value for async-loaded edit forms). Use for
	 *  per-field "changed?" UX (e.g. warning display) where `form.isDirty`
	 *  (any-field) is too coarse. */
	isDirty: ComputedRef<boolean>
	/** Whether the user has interacted with this field. Use to gate when
	 *  errors are visually displayed. */
	touched: Ref<boolean>
	/** Mark this field as touched. Typically called from `@blur` or
	 *  `@input` depending on UX pattern. */
	touch(): void
	/** Reset this field to its baseline (its `initial`, or the last `rebase()`
	 *  value) + clear touched state. */
	reset(): void
}

export interface FormState<TFields extends Record<string, FieldDef>> {
	fields: { [K in keyof TFields]: FieldHandle<TFields[K]["initial"]> }
	/** Plain-object snapshot of all current values. Reactive. */
	values: ComputedRef<{ [K in keyof TFields]: TFields[K]["initial"] }>
	/** True iff every field's validate() returns null/undefined.
	 *  Independent of `touched` — call sites use this for the submit button's
	 *  disabled state regardless of whether the user blurred a field yet. */
	isValid: ComputedRef<boolean>
	/** True iff at least one field's value differs from its baseline (its
	 *  `initial`, or the last `rebase()` value). */
	isDirty: ComputedRef<boolean>
	/** Mark every field as touched. Useful before showing all errors on a
	 *  submit attempt with unfocused fields. */
	touchAll(): void
	/** Reset every field to its baseline (`initial`, or the last `rebase()`) +
	 *  clear touched state. */
	reset(): void
	/** Re-baseline to async-loaded values: sets each given field's value AND
	 *  its dirty-baseline to the provided value + clears touched, so
	 *  `isDirty`/`reset()` track the loaded entity instead of the
	 *  construction-time `initial`. Pass the FULL loaded set in one call so
	 *  sibling-dependent validators read fresh values together. Fields omitted
	 *  from `values` keep their current baseline. */
	rebase(values: Partial<{ [K in keyof TFields]: TFields[K]["initial"] }>): void
}

/**
 * Reactive form state with per-field validation, touched tracking, and
 * dirty detection. Used by `EntityForm` and generic enough to reuse
 * anywhere that needs controlled inputs + validation.
 *
 * The composable is parent-owned: callers create it inside `<script setup>`
 * and the lifetime tracks the component. No `dispose()` needed — Vue's
 * effect scope cleans up automatically.
 *
 * Example:
 *
 * ```ts
 * const form = useFormState({
 *   name: {
 *     initial: "",
 *     validate: (v) => v.trim() ? null : "Name is required",
 *   },
 *   address: {
 *     initial: "",
 *     validate: (v) => isValidHex(v) ? null : "Invalid address",
 *   },
 * })
 *
 * // In template:
 * // <Input v-model="form.fields.name.value" @blur="form.fields.name.touch" />
 * // <Button :disabled="!form.isValid" @click="submit" />
 * ```
 */
export function useFormState<TFields extends Record<string, FieldDef>>(defs: TFields): FormState<TFields> {
	const fieldNames = Object.keys(defs) as (keyof TFields)[]

	// Build the reactive handles. We store values in individual refs so each
	// field has its own dependency surface (avoids over-triggering watchers
	// that only care about one field).
	const handles = {} as { [K in keyof TFields]: FieldHandle<TFields[K]["initial"]> }
	const valuesProxy = reactive({}) as Record<string, unknown>
	// Per-field dirty baseline. Starts at `initial` — so create dialogs, which
	// never call `rebase()`, behave exactly as before — and is moved by
	// `rebase()` to the async-loaded value for edit dialogs.
	const baselines = {} as Record<string, Ref<unknown>>

	for (const name of fieldNames) {
		const def = defs[name]
		const valueRef = ref(def.initial) as Ref<unknown>
		const baselineRef = ref(def.initial) as Ref<unknown>
		const touchedRef = ref(false)
		baselines[name as string] = baselineRef

		// Mirror to the proxy so validate() can read sibling values without
		// closing over each ref individually.
		valuesProxy[name as string] = def.initial

		const errorComputed = computed<string | null>(() => {
			if (!def.validate) return null
			const result = def.validate(valueRef.value as TFields[typeof name]["initial"], valuesProxy)
			return result ?? null
		})

		// Dirty vs the baseline (initial, or the last `rebase()` value) — NOT vs
		// `def.initial` — so an edit dialog that rebases to a loaded entity reads
		// clean until the user actually changes a field.
		const isDirtyComputed = computed(() => valueRef.value !== baselineRef.value)

		handles[name] = {
			value: valueRef as Ref<TFields[typeof name]["initial"]>,
			error: errorComputed,
			isDirty: isDirtyComputed,
			touched: touchedRef,
			touch() {
				touchedRef.value = true
			},
			reset() {
				valueRef.value = baselineRef.value
				touchedRef.value = false
				valuesProxy[name as string] = baselineRef.value
			},
		}
	}

	// Keep the values proxy in sync with each field's ref so cross-field
	// validators see fresh siblings. We do this lazily via the values
	// computed: every read snapshots the current refs, so the proxy mirror
	// only needs to update when validate() runs against it. Simpler: update
	// the proxy synchronously when the ref changes.
	for (const name of fieldNames) {
		const handle = handles[name]
		const orig = handle.value
		// Wrap each field's ref with a setter that also updates the proxy.
		// We can't replace the ref (that'd break v-model binding), so use a
		// watcher instead.
		watchSyncToProxy(orig, valuesProxy, name as string)
	}

	const values = computed(() => {
		const out = {} as { [K in keyof TFields]: TFields[K]["initial"] }
		for (const name of fieldNames) {
			out[name] = handles[name].value.value
		}
		return out
	})

	const isValid = computed(() => {
		for (const name of fieldNames) {
			const def = defs[name]
			if (!def.validate) continue
			const result = def.validate(handles[name].value.value, valuesProxy)
			if (result) return false
		}
		return true
	})

	const isDirty = computed(() => {
		for (const name of fieldNames) {
			if (handles[name].isDirty.value) return true
		}
		return false
	})

	function touchAll() {
		for (const name of fieldNames) {
			handles[name].touch()
		}
	}

	function reset() {
		for (const name of fieldNames) {
			handles[name].reset()
		}
	}

	function rebase(values: Partial<{ [K in keyof TFields]: TFields[K]["initial"] }>) {
		for (const name of fieldNames) {
			if (!(name in values)) continue
			const next = values[name] as TFields[typeof name]["initial"]
			baselines[name as string].value = next
			handles[name].value.value = next
			handles[name].touched.value = false
			valuesProxy[name as string] = next
		}
	}

	return {
		fields: handles,
		values,
		isValid,
		isDirty,
		touchAll,
		reset,
		rebase,
	}
}

/** Sync a field ref's changes into the shared values-proxy synchronously
 *  so cross-field validators see fresh sibling values on the same tick
 *  the value changes. Without `flush: "sync"`, validate() called
 *  immediately after a setter would read the stale proxy entry. */
import { watch } from "vue"
function watchSyncToProxy(source: Ref<unknown>, proxy: Record<string, unknown>, key: string): void {
	watch(
		source,
		(val) => {
			proxy[key] = val
		},
		{ flush: "sync" },
	)
}
