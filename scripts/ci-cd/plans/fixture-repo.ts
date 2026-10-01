/** Throwaway git repositories for the gate's tests. Commits are unsigned and hook-free by construction. */
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { checkTree } from "./check"
import type { Env, Finding, RuleId } from "./lib"

const GIT_CONFIG = [
	"-c",
	"user.name=fixture",
	"-c",
	"user.email=fixture@example.invalid",
	"-c",
	"commit.gpgsign=false",
	"-c",
	"tag.gpgsign=false",
	"-c",
	"core.hooksPath=/dev/null",
	"-c",
	"init.defaultBranch=dev",
]

const made: string[] = []

export function git(cwd: string, ...args: string[]): string {
	const res = spawnSync("git", [...GIT_CONFIG, ...args], { cwd, encoding: "utf8" })
	if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`)
	return res.stdout.trim()
}

export function writeFiles(repo: string, files: Record<string, string>): void {
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(repo, path)), { recursive: true })
		writeFileSync(join(repo, path), text)
	}
}

export function commitAll(repo: string, message = "fixture"): string {
	git(repo, "add", "-A")
	git(repo, "commit", "-q", "--allow-empty", "-m", message)
	return git(repo, "rev-parse", "HEAD")
}

/** A repo on branch `dev` holding `files` in one commit. */
export function makeRepo(files: Record<string, string>): string {
	const repo = mkdtempSync(join(tmpdir(), "plans-gate-"))
	made.push(repo)
	git(repo, "init", "-q")
	writeFiles(repo, files)
	commitAll(repo)
	return repo
}

export function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "plans-gate-"))
	made.push(dir)
	return dir
}

export function cleanupRepos(): void {
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
}

export function findings(repo: string, rule: RuleId, env: Env = {}): Finding[] {
	return checkTree({ cwd: repo, env }).filter((f) => f.rule === rule)
}

export const CANONICAL_GITIGNORE = "audit-*.md\nplan-*.md\n_*.md\neli5.html\n!**/lessons/**\n"
