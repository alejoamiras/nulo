import "@nulo/design/base.css"
import "./styles/overrides.css"
import "./styles/page.css"

import { mountPage } from "./feed-dom"

document.addEventListener("DOMContentLoaded", () => {
	mountPage()
})
