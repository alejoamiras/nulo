// Renders the decided mocks of the proposal page to PNG and writes their visible text next to them.
// Usage (from the repo root): python3 implementations-plan/ux-feedback/design/mocks/build.py
//   then node implementations-plan/ux-feedback/design/shots.mjs [out-dir] [--inventory]
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TARGETS } from "./targets.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const require = createRequire(path.join(repo, "apps/extension/package.json"));
const puppeteer = require("puppeteer");

const args = process.argv.slice(2);
const inventory = args.includes("--inventory");
const out = path.resolve(args.find((a) => !a.startsWith("--")) ?? path.join(here, "mocks/dist/shots"));
const page_ = path.join(here, "mocks/dist/nulo-feedback.html");
if (!fs.existsSync(page_)) throw new Error("build the page first: python3 implementations-plan/ux-feedback/design/mocks/build.py");

const browser = await puppeteer.launch({
	headless: true,
	executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
	args: ["--no-sandbox"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
await page.goto(`file://${page_}`, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 700));
await page.addStyleTag({ content: ".rail{display:none!important}" });

if (inventory) {
	const inv = await page.evaluate(() =>
		Array.from(document.querySelectorAll("section.item")).map((s) => ({
			id: s.id,
			folds: Array.from(s.querySelectorAll(".r1")).map((f) => f.id),
			opts: Array.from(s.querySelectorAll("[data-opt]")).map((o) => {
				const fold = o.closest(".r1");
				const round = o.closest("[id$='-r3'],[id$='-r4']");
				return `${fold ? `#${fold.id} ` : round ? `#${round.id} ` : ""}[data-opt="${o.dataset.opt}"]`;
			}),
		})),
	);
	console.log(JSON.stringify(inv, null, 1));
	await browser.close();
	process.exit(0);
}

fs.mkdirSync(out, { recursive: true });
const text = {};
for (const t of TARGETS) {
	for (const fold of t.unfold ?? []) {
		const open = await page.$eval(`#${fold}`, (el) => !el.hidden);
		if (!open) await page.click(`[data-toggle="${fold}"]`);
	}
	await new Promise((r) => setTimeout(r, 250));
	const el = await page.$(t.sel);
	if (!el) {
		errors.push(`missing ${t.name}: ${t.sel}`);
		continue;
	}
	await el.scrollIntoView();
	await el.screenshot({ path: path.join(out, `${t.name}.png`) });
	text[t.name] = await el.evaluate((node) => node.innerText.replace(/\n{2,}/g, "\n").trim());
}
fs.writeFileSync(path.join(out, "text.json"), `${JSON.stringify(text, null, 1)}\n`);
console.log(`${Object.keys(text).length}/${TARGETS.length} shots → ${out}`);
if (errors.length) {
	console.error(errors.join("\n"));
	process.exitCode = 1;
}
await browser.close();
