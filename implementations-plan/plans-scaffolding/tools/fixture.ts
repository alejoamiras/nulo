/** Fixture repos shaped like this one: a first base, then `origin/dev` ahead of it, then a work branch. */
import { fixtures } from "./gate"

export const { cleanupRepos, commitAll, git, writeFiles } = fixtures
export const P = "implementations-plan"

export type PlanRepo = { repo: string; base: string; dev: string }

/** `baseFiles` land in the first base, `devFiles` on dev after it; the work branch starts at dev. */
export function planRepo(baseFiles: Record<string, string>, devFiles: Record<string, string> = {}): PlanRepo {
	const repo = fixtures.makeRepo({ "scripts/ci-cd/plans/permalink-bases.json": "{}\n", ...baseFiles })
	const base = git(repo, "rev-parse", "HEAD")
	writeFiles(repo, devFiles)
	const dev = commitAll(repo, "dev")
	git(repo, "update-ref", "refs/remotes/origin/dev", dev)
	git(repo, "switch", "-q", "-c", "work")
	return { repo, base, dev }
}

export function tracked(repo: string, prefix = P): string[] {
	return git(repo, "ls-files", "--", prefix).split("\n").filter(Boolean)
}
