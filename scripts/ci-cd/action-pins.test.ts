/**
 * Every third-party action is pinned to a full commit SHA.
 *
 * A tag is a mutable pointer owned by the action's maintainers — or by whoever takes over their
 * account. `@v4` re-resolves on every run, so a moved tag executes new code with the job's token
 * and secrets and leaves no diff here to review. A 40-hex SHA is content-addressed: the code that
 * runs is the code that was reviewed, and an upgrade is a line in a PR.
 *
 * The trailing `# vX.Y.Z` is not decoration: it is what Renovate reads to propose the next digest,
 * and what a human reads to know which release the SHA is.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..", "..")
const PINNED = /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40} # v\d+\.\d+\.\d+$/

/** `uses:` values across workflows and composite actions, local (`./…`) references excluded. */
function externalUses(): { where: string; ref: string }[] {
  const found: { where: string; ref: string }[] = []
  for (const file of new Bun.Glob(".github/**/*.{yml,yaml}").scanSync({ cwd: ROOT, dot: true })) {
    const lines = readFileSync(join(ROOT, file), "utf8").split("\n")
    for (const [i, line] of lines.entries()) {
      const ref = /^\s*(?:-\s+)?uses:\s*(.+?)\s*$/.exec(line)?.[1]
      if (ref && !ref.startsWith("./")) found.push({ where: `${file}:${i + 1}`, ref })
    }
  }
  return found
}

describe("third-party actions", () => {
  const uses = externalUses()

  test("the scan sees the workflows", () => {
    expect(uses.length).toBeGreaterThan(50)
  })

  test("each is pinned to a commit SHA with its release in a comment", () => {
    const unpinned = uses.filter(({ ref }) => !PINNED.test(ref)).map(({ where, ref }) => `${where}  ${ref}`)
    expect(unpinned).toEqual([])
  })

  test("one action, one SHA — a second pin of the same action is a missed upgrade", () => {
    const shas = new Map<string, Set<string>>()
    for (const { ref } of uses) {
      const [action, rest] = ref.split("@")
      shas.set(action, (shas.get(action) ?? new Set()).add(rest.slice(0, 40)))
    }
    const split = [...shas].filter(([, set]) => set.size > 1).map(([action]) => action)
    expect(split).toEqual([])
  })
})
