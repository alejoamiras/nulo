import { createApp } from "vue"
import App from "./App.vue"
import "@nulo/design/base.css"
import "./app.css"
import { assertBuildIntegrity } from "./lib/build-integrity"

// Fail-closed BEFORE mount: if the build target, its bundled manifest, or the serving hostname
// disagree, refuse to render (a wrong-chain build must never reach a transaction). Show the reason
// instead of a blank page, and still surface it in the console.
try {
	assertBuildIntegrity()
	createApp(App).mount("#app")
} catch (e) {
	const message = e instanceof Error ? e.message : String(e)
	const el = document.getElementById("app")
	if (el) el.textContent = message
	throw e
}
