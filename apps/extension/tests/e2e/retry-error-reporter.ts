import type { Reporter, TestCase } from "vitest/node"

/**
 * Surfaces the first-attempt errors of tests that PASSED on a vitest retry.
 * The default reporter prints only a `(retry xN)` marker for an eventual pass
 * and swallows the failed attempts' errors — which made retry-masked flakes
 * undiagnosable from CI logs (the reason had to be re-reproduced locally).
 * Vitest retains those errors on the passed result (`TestResultPassed.errors`);
 * this reporter prints them loudly, once, when the case settles.
 *
 * Runs ALONGSIDE the default reporter — it emits only on retried passes and
 * stays silent otherwise, so normal output is untouched.
 */
export default class RetryErrorReporter implements Reporter {
	onTestCaseResult(testCase: TestCase): void {
		const result = testCase.result()
		if (result.state !== "passed" || !result.errors?.length) return
		const location = testCase.module.moduleId
		console.error(`\n[retry-error] PASSED ON RETRY: ${testCase.fullName} (${location})`)
		result.errors.forEach((err, i) => {
			const stack = err.stack ?? err.message ?? String(err)
			console.error(`[retry-error] attempt ${i + 1} error:\n${stack}`)
		})
	}
}
