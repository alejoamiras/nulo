import { flushPromises } from "@vue/test-utils"
import { describe, expect, test, vi } from "vitest"
import { useProfileNameDefault } from "./useProfileNameDefault"
import { useProfileNameField } from "./useProfileNameField"

/** A profile list the test answers by hand, one read at a time. */
function makeList() {
	const reads: Array<{ resolve: (names: string[]) => void; reject: (err: unknown) => void }> = []
	const listNames = vi.fn(
		() =>
			new Promise<string[]>((resolve, reject) => {
				reads.push({ resolve, reject })
			}),
	)
	return { listNames, reads }
}

async function mountWith(setupNames: string[] | Error) {
	const field = useProfileNameField()
	const list = makeList()
	const d = useProfileNameDefault(field, list.listNames)
	if (setupNames instanceof Error) list.reads[0].reject(setupNames)
	else list.reads[0].resolve(setupNames)
	await flushPromises()
	return { field, d, list }
}

/** Resolves at submit, answering the fresh read with `names`. */
async function resolveWith(
	d: ReturnType<typeof useProfileNameDefault>,
	list: ReturnType<typeof makeList>,
	names: string[],
	backupName?: string | null,
) {
	const pending = d.resolveName(backupName)
	list.reads.at(-1)?.resolve(names)
	return pending
}

describe("useProfileNameDefault · the field", () => {
	test("stays pending until the profile list is read", () => {
		const field = useProfileNameField()
		const d = useProfileNameDefault(field, makeList().listNames)
		expect(d.nameFieldState.value).toBe("pending")
	})

	test("no profiles: hidden, named Main", async () => {
		const { d, field } = await mountWith([])
		expect(d.nameFieldState.value).toBe("hidden")
		expect(field.profileName.value).toBe("Main")
	})

	test("profiles: shown, prefilled Profile N", async () => {
		const { d, field } = await mountWith(["Main"])
		expect(d.nameFieldState.value).toBe("shown")
		expect(field.profileName.value).toBe("Profile 2")
	})

	test("a failed read shows the field empty, never a guessed name; submit names it from the fresh read", async () => {
		const { d, field, list } = await mountWith(new Error("worker gone"))
		expect(d.nameFieldState.value).toBe("shown")
		expect(field.profileName.value).toBe("")
		expect(await resolveWith(d, list, ["Main"])).toBe("Profile 2")
	})
})

describe("useProfileNameDefault · backup names", () => {
	test("a backup's name replaces an untouched default; named → nameless → named", async () => {
		const { d, field } = await mountWith(["Main"])
		d.offer("Alpha")
		expect(field.profileName.value).toBe("Alpha")
		d.offer(null)
		expect(field.profileName.value).toBe("Profile 2")
		d.offer("Beta")
		expect(field.profileName.value).toBe("Beta")
	})

	test("a typed name is never overwritten, a cleared field included", async () => {
		const { d, field } = await mountWith(["Main"])
		field.profileName.value = "Mine"
		d.offer("Alpha")
		expect(field.profileName.value).toBe("Mine")
		field.profileName.value = ""
		d.offer("Beta")
		expect(field.profileName.value).toBe("")
	})

	test("a backup picked before the list arrives keeps its name", async () => {
		const field = useProfileNameField()
		const list = makeList()
		const d = useProfileNameDefault(field, list.listNames)
		d.offer("Alpha")
		list.reads[0].resolve(["Main"])
		await flushPromises()
		expect(field.profileName.value).toBe("Alpha")
		d.offer(null)
		expect(field.profileName.value).toBe("Profile 2")
	})
})

describe("useProfileNameDefault · resolveName", () => {
	test("an untouched default follows the fresh list: added elsewhere, or the last one deleted", async () => {
		const shown = await mountWith(["Main"])
		expect(await resolveWith(shown.d, shown.list, ["Main", "Work"])).toBe("Profile 3")
		const other = await mountWith(["Main"])
		expect(await resolveWith(other.d, other.list, [])).toBe("Main")
	})

	test("submitting while still pending names the profile from the fresh read", async () => {
		const field = useProfileNameField()
		const list = makeList()
		const d = useProfileNameDefault(field, list.listNames)
		const name = d.resolveName()
		list.reads[1].resolve(["Main"])
		expect(await name).toBe("Profile 2")
	})

	test("a late setup read after submit started writes nothing into the field", async () => {
		const field = useProfileNameField()
		const list = makeList()
		const d = useProfileNameDefault(field, list.listNames)
		const name = d.resolveName()
		list.reads[1].resolve([])
		expect(await name).toBe("Main")
		list.reads[0].resolve(["Main", "Work"])
		await flushPromises()
		expect(field.profileName.value).toBe("")
		expect(d.nameFieldState.value).toBe("shown")
	})

	test("an untouched field takes the backup's name; the user's own name wins over it", async () => {
		const { d, list, field } = await mountWith(["Main"])
		d.offer("Alpha")
		expect(await resolveWith(d, list, ["Main"], "Alpha")).toBe("Alpha")
		field.profileName.value = "  Work  "
		expect(await resolveWith(d, list, ["Main"], "Alpha")).toBe("Work")
	})

	test("the user's name is validated against the fresh list: a variant of an existing one fails", async () => {
		const { d, list, field } = await mountWith(["Main"])
		field.profileName.value = "WORK"
		expect(await resolveWith(d, list, ["Main", "work"])).toBeNull()
		expect(field.nameError.value).toBe("This name is already in use.")
	})

	test("a failed fresh read rejects", async () => {
		const { d, list } = await mountWith(["Main"])
		const name = d.resolveName()
		list.reads[1].reject(new Error("worker gone"))
		await expect(name).rejects.toThrow("worker gone")
	})
})
