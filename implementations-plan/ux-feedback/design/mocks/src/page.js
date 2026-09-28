(() => {
	"use strict";

	/** The round-5 addendum's pickers on item 6, one per batch-5 ask, named by the ask's number. */
	const I6_ADD = [1, 2, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 17, 18, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32].map((n) => `i6a${n}`);
	const ITEMS = [
		{ id: "i1", num: "01", title: "Default account name", hit: "\"Account\" reads like a label, not a name", opts: "A: \"Account 1\"", mine: "A", status: "decided" },
		{ id: "i2", num: "02", title: "Alias tooltip", hit: "Runs off the edge of the window", opts: "A: fix the tooltip · B: helper line", mine: "A + B", status: "decided" },
		{ id: "i3", num: "03", title: "Fee wording", hit: "\"Sponsored Fee Juice\", \"Fee source\"", opts: "Round 5: the menu before balances load, the spoken sub-cent fee, a fee contract added by hand", mine: "V4′", status: "r5", ids: ["i3", "i3b", "i3c", "i3d", "i3e", "i3f"], latest: ["i3d", "i3e", "i3f"] },
		{ id: "i4", num: "04", title: "Window placement", hit: "Covers the app's emoji check", opts: "A: top-right · B: one connect window (later)", mine: "A (B later)", status: "decided", later: "B saved as a follow-up" },
		{ id: "i5", num: "05", title: "Profile name at setup", hit: "\"Was too much\"", opts: "Round 5: first-run import", mine: "A", status: "r5", ids: ["i5", "i5b"], latest: ["i5b"] },
		{ id: "i6", num: "06", title: "Permissions window", hit: "Everything \"high\", claims overstated", opts: "Round 5: seven states no round drew, and an addendum of 25", mine: "Off = ask · Off · B", status: "r5", ids: ["i6", "i6b", "i6c", "i6d", "i6e", "i6f", "i6g", "i6h", "i6i", "i6j", "i6k", ...I6_ADD], latest: ["i6e", "i6f", "i6g", "i6h", "i6i", "i6j", "i6k", ...I6_ADD] },
		{ id: "i7", num: "07", title: "Lock button", hit: "Same icon as \"private\"", opts: "A1 padlock chip · A2 word only · A3 no border", mine: "A2", status: "decided", ids: ["i7", "i7b"] },
		{ id: "i8", num: "08", title: "Privacy strip", hit: "Squares read as checkboxes", opts: "Round 5: the review sheet, fee tag, unknown payer", mine: "A", status: "r5", ids: ["i8", "i8b", "i8c"], latest: ["i8b", "i8c"] },
		{ id: "i9", num: "09", title: "Explaining terms", hit: "Jargon with no help nearby", opts: "Dotted terms + glossary · \"Authorizations\"", mine: "Authorizations", status: "decided", ids: ["i9", "i9b", "i9c"] },
		{ id: "tips", num: "T", title: "Tooltip map", hit: "\"Something huge filled with tooltips\"", opts: "Round 5: two warnings as text", mine: "All of it", status: "r5", ids: ["tips", "tipsb", "tipsc"], latest: ["tipsb", "tipsc"] },
		{ id: "i10", num: "10", title: "Toasts", hit: "At the top, gone in 2 seconds", opts: "A′ errors get × · A″ × on all", mine: "A′", status: "decided", ids: ["i10", "i10b"] },
		{ id: "i11", num: "11", title: "Row hover", hit: "Pointer on some rows only", opts: "A: one interactive row", mine: "A", status: "decided" },
		{ id: "i12", num: "12", title: "Incoming transfers", hit: "\"Appear from nowhere\"", opts: "A: arrival animation · B: + snackbar · C: + toolbar count", mine: "B", status: "decided" },
	];
	const idsOf = (it) => it.ids || [it.id];
	const PICK_IDS = ITEMS.flatMap(idsOf);
	const STATUS_LABEL = { decided: "Decided", r5: "Round 5", r4: "Round 4", r3: "Round 3", r2: "Round 2", new: "New" };
	const LS_PICKS = "nulo-feedback-r1-picks";
	const LS_THEME = "nulo-feedback-r1-wallet-theme";

	const $ = (sel, root = document) => root.querySelector(sel);
	const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

	const store = {
		get(key, fallback) {
			try {
				const raw = localStorage.getItem(key);
				return raw === null ? fallback : JSON.parse(raw);
			} catch {
				return fallback;
			}
		},
		set(key, value) {
			try {
				localStorage.setItem(key, JSON.stringify(value));
			} catch {}
		},
	};

	/* ---------- ledger + rail ---------- */

	function renderIndex() {
		const body = $("#ledger-body");
		const chips = $("#rail-chips");
		for (const it of ITEMS) {
			const tr = document.createElement("tr");
			const cells = [
				["n", it.num],
				["t", null],
				["s", null],
				["q", it.hit],
				["o", it.opts],
				["rec", it.mine],
				["yours", "—"],
			];
			for (const [cls, text] of cells) {
				const td = document.createElement("td");
				td.className = cls;
				if (cls === "t") {
					const a = document.createElement("a");
					a.href = `#${it.id}`;
					a.textContent = it.title;
					td.append(a);
				} else if (cls === "s") {
					const st = document.createElement("span");
					st.className = `st ${it.status}`;
					st.textContent = STATUS_LABEL[it.status];
					td.append(st);
					if (it.later) {
						const later = document.createElement("span");
						later.className = "st later";
						later.textContent = "B later";
						later.title = it.later;
						td.append(" ", later);
					}
				} else {
					td.textContent = text;
				}
				if (cls === "yours") td.dataset.yours = it.id;
				tr.append(td);
			}
			body.append(tr);

			const chip = document.createElement("a");
			chip.className = `rail-chip ${it.status === "decided" ? "" : it.status}`.trim();
			chip.href = `#${it.id}`;
			chip.textContent = it.num;
			chip.dataset.chip = it.id;
			chip.title = it.title;
			chips.append(chip);
		}
	}

	/* ---------- picks ---------- */

	const picks = {};
	const pending = {};
	let db = null;
	let readOnly = false;

	function note(text) {
		const el = $("#store-note");
		if (el) el.textContent = text;
	}

	const optionOf = (id) => (picks[id] && picks[id].option) || "";
	const itemOf = (id) => ITEMS.find((it) => idsOf(it).includes(id));
	/** An item counts as open until every picker of its latest round has an answer. */
	const isSettled = (it) => (it.latest || idsOf(it).slice(-1)).every((id) => Boolean(optionOf(id)));
	/** Every round's pick in order; a round with more than three pickers collapses to a count. */
	function yoursText(it) {
		const ids = idsOf(it);
		if (ids.length === 1) return optionOf(it.id) || "—";
		const many = it.latest && it.latest.length > 3 ? it.latest : [];
		const parts = ids.filter((x) => !many.includes(x)).map((x, i) => optionOf(x) || (i ? "open" : "—"));
		if (many.length) parts.push(`${many.filter(optionOf).length}/${many.length} picked`);
		return parts.join(" → ");
	}

	function reflect(id) {
		const p = picks[id];
		const box = $(`.pick[data-pick="${id}"]`);
		if (box) {
			for (const input of $$("input[type=radio]", box)) input.checked = Boolean(p && input.value === p.option);
			const ta = $("textarea", box);
			if (ta && document.activeElement !== ta) ta.value = (p && p.note) || "";
		}
		const it = itemOf(id);
		if (!it) return;
		const yours = $(`[data-yours="${it.id}"]`);
		if (yours) yours.textContent = yoursText(it);
		const chip = $(`[data-chip="${it.id}"]`);
		if (chip) chip.classList.toggle("picked", isSettled(it));
		const count = ITEMS.filter(isSettled).length;
		const rc = $("#rail-count");
		if (rc) rc.textContent = `${count} / ${ITEMS.length} settled`;
	}

	function status(id, text) {
		const el = $(`.pick[data-pick="${id}"] .pick-status`);
		if (el) el.textContent = text;
	}

	function makeReadOnly() {
		readOnly = true;
		for (const box of $$(".pick")) {
			box.dataset.readonly = "";
			for (const el of $$("input, textarea", box)) el.disabled = true;
		}
		note("View only: picks are saved by the page's editors.");
	}

	/* One write in flight per document; later edits coalesce into the next write. */
	async function persist(id) {
		store.set(LS_PICKS, picks);
		if (!db || readOnly) {
			status(id, db ? "" : "Saved in this browser");
			return;
		}
		if (pending[id]) {
			pending[id].dirty = true;
			return;
		}
		pending[id] = { dirty: false };
		status(id, "Saving…");
		try {
			do {
				pending[id].dirty = false;
				const p = picks[id] || {};
				await db.doc(`picks/${id}`).set({ option: p.option || "", note: p.note || "", updatedAt: new Date().toISOString() });
			} while (pending[id].dirty);
			status(id, "Saved to this page");
		} catch (e) {
			if (e && e.code === "invalid_argument") makeReadOnly();
			status(id, e && e.code === "invalid_argument" ? "Not saved: view only" : "Not saved. Try again in a moment.");
		} finally {
			delete pending[id];
		}
	}

	function buildPickers() {
		for (const box of $$(".pick[data-pick]")) {
			const id = box.dataset.pick;
			const options = (box.dataset.options || "").split("|").filter(Boolean);
			const fs = document.createElement("fieldset");
			const lg = document.createElement("legend");
			lg.textContent = box.dataset.legend || "Your pick";
			fs.append(lg);
			const row = document.createElement("div");
			row.className = "pick-opts";
			for (const opt of options) {
				const label = document.createElement("label");
				const input = document.createElement("input");
				input.type = "radio";
				input.name = `pick-${id}`;
				input.value = opt;
				const span = document.createElement("span");
				span.textContent = opt;
				label.append(input, span);
				row.append(label);
				input.addEventListener("change", () => {
					picks[id] = { ...(picks[id] || {}), option: opt };
					reflect(id);
					persist(id);
				});
			}
			fs.append(row);
			const ta = document.createElement("textarea");
			ta.rows = 2;
			ta.placeholder = "Note or tweak (optional)";
			const owner = itemOf(id);
			const round = box.dataset.round || (owner && idsOf(owner).indexOf(id) > 0 ? String(idsOf(owner).indexOf(id) + 1) : "");
			ta.setAttribute("aria-label", `Note for ${owner ? owner.title : id}${round ? `, round ${round}` : ""}${box.dataset.legend ? `, ${box.dataset.legend}` : ""}`);
			let timer = 0;
			ta.addEventListener("input", () => {
				clearTimeout(timer);
				timer = setTimeout(() => {
					picks[id] = { ...(picks[id] || {}), note: ta.value };
					persist(id);
				}, 700);
			});
			const st = document.createElement("div");
			st.className = "pick-status";
			st.setAttribute("aria-live", "polite");
			box.append(fs, ta, st);
		}
	}

	async function connectDb() {
		const local = store.get(LS_PICKS, {});
		if (local && typeof local === "object") {
			for (const id of PICK_IDS) {
				const p = local[id];
				if (p && typeof p === "object") picks[id] = { option: String(p.option || ""), note: String(p.note || "") };
			}
		}
		for (const id of PICK_IDS) reflect(id);

		const claude = window.claude;
		if (!claude || typeof claude.use !== "function") {
			note("Picks are saved in this browser only.");
			return;
		}
		try {
			db = await claude.use("db");
		} catch {
			db = null;
		}
		if (!db) {
			note("Picks are saved in this browser only.");
			return;
		}
		note("Picks save to this page, so I can read them back.");
		let first = true;
		db.collection("picks").onSnapshot(
			(snap) => {
				const seen = new Set();
				for (const doc of snap.docs) {
					const data = doc.data();
					if (!PICK_IDS.includes(doc.id) || !data) continue;
					seen.add(doc.id);
					picks[doc.id] = { option: typeof data.option === "string" ? data.option : "", note: typeof data.note === "string" ? data.note : "" };
					reflect(doc.id);
				}
				if (first) {
					first = false;
					// Picks made before the store answered are uploaded once.
					for (const id of PICK_IDS) if (!seen.has(id) && picks[id] && (picks[id].option || picks[id].note)) persist(id);
				}
				store.set(LS_PICKS, picks);
			},
			() => note("Live sync stopped. Picks still save in this browser."),
		);
	}

	/* ---------- copy as text ---------- */

	function picksText() {
		const lines = ["Nulo feedback: picks, rounds 1 to 5"];
		const fmt = (id) => {
			const p = picks[id];
			const opt = p && p.option ? p.option : "—";
			return p && p.note ? `${opt} (${p.note.trim()})` : opt;
		};
		for (const it of ITEMS) lines.push(`${it.num} ${it.title}: ${idsOf(it).map(fmt).join(" → ")}`);
		return lines.join("\n");
	}

	function wireCopy() {
		const btn = $("#copy-picks");
		if (!btn) return;
		const label = btn.textContent;
		const fallback = (text) => {
			let ta = $("#copy-fallback");
			if (!ta) {
				ta = document.createElement("textarea");
				ta.id = "copy-fallback";
				ta.className = "copy-fallback";
				ta.rows = 12;
				ta.readOnly = true;
				btn.closest(".controls").after(ta);
			}
			ta.value = text;
			ta.hidden = false;
			ta.focus();
			ta.select();
		};
		const done = (msg) => {
			btn.textContent = msg;
			setTimeout(() => (btn.textContent = label), 2200);
		};
		btn.addEventListener("click", () => {
			const text = picksText();
			try {
				navigator.clipboard.writeText(text).then(
					() => done("Copied"),
					() => {
						fallback(text);
						done("Selected below");
					},
				);
			} catch {
				fallback(text);
				done("Selected below");
			}
		});
	}

	/* ---------- wallet theme ---------- */

	let walletTheme = "dark";

	function setWalletTheme(theme) {
		walletTheme = theme;
		for (const n of $$(".nulo")) n.setAttribute("theme", theme);
		for (const b of $$("[data-wallet-theme]")) b.setAttribute("aria-pressed", String(b.dataset.walletTheme === theme));
		store.set(LS_THEME, theme);
		requestAnimationFrame(layout);
	}

	function wireTheme() {
		for (const b of $$("[data-wallet-theme]")) b.addEventListener("click", () => setWalletTheme(b.dataset.walletTheme));
		const saved = store.get(LS_THEME, "dark");
		if (saved === "light" || saved === "dark") setWalletTheme(saved);
	}

	/* ---------- scaling + tooltip placement ---------- */

	function layoutFits() {
		for (const opt of $$(".opt")) {
			const stage = $(".stage", opt);
			const opts = opt.parentElement;
			if (!stage || !opts) continue;
			const cs = getComputedStyle(stage);
			const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
			const avail = Math.max(120, opts.clientWidth - pad);
			let maxW = 0;
			for (const fit of $$(":scope > .fit", stage)) {
				const child = fit.firstElementChild;
				if (!child) continue;
				child.style.transform = "";
				const w = child.offsetWidth;
				const h = child.offsetHeight;
				const s = Math.min(1, avail / w);
				child.style.transform = s < 1 ? `scale(${s})` : "";
				fit.style.width = `${w * s}px`;
				fit.style.height = `${h * s}px`;
				maxW = Math.max(maxW, w * s);
			}
			if (maxW) opt.style.setProperty("--opt-w", `${Math.ceil(maxW + pad)}px`);
		}
	}

	function placeTips() {
		for (const tip of $$(".n-tip[data-tip-for]")) {
			const root = tip.closest(".nulo");
			const trig = root && root.querySelector(`#${CSS.escape(tip.dataset.tipFor)}`);
			if (!trig) continue;
			const rr = root.getBoundingClientRect();
			const scale = rr.width / root.offsetWidth || 1;
			const tr = trig.getBoundingClientRect();
			const t = { left: (tr.left - rr.left) / scale, top: (tr.top - rr.top) / scale, w: tr.width / scale, h: tr.height / scale };
			const rootW = root.offsetWidth;
			const rootH = root.offsetHeight;
			const mode = tip.dataset.tipMode || "clamp";
			const max = Number(tip.dataset.tipMax) || 0;
			const text = $(".n-tip-text", tip);
			if (max && text) text.style.maxWidth = `${Math.min(max, rootW - 16) - 24}px`;
			tip.style.left = "0px";
			tip.style.top = "0px";
			const w = tip.offsetWidth;
			const h = tip.offsetHeight;
			let left;
			let top = t.top + t.h + 6;
			if (mode === "start") left = t.left;
			else if (mode === "below-end") left = Math.max(8, t.left + t.w - w);
			else left = Math.min(Math.max(8, t.left + t.w / 2 - w / 2), rootW - w - 8);
			if (mode !== "start" && top + h > rootH - 8 && t.top - h - 6 >= 8) top = t.top - h - 6;
			tip.style.left = `${Math.round(left)}px`;
			tip.style.top = `${Math.round(top)}px`;
		}
	}

	/* A mock drawn scrolled keeps the part under discussion in view. */
	function presetScroll() {
		for (const sc of $$("[data-scroll-to]")) {
			const target = document.getElementById(sc.dataset.scrollTo);
			if (!target || !sc.offsetHeight) continue;
			// Mocks are scaled with a transform; rects are in screen pixels, scrollTop is not.
			const scale = sc.getBoundingClientRect().height / sc.offsetHeight || 1;
			sc.scrollTop += (target.getBoundingClientRect().top - sc.getBoundingClientRect().top) / scale - 8;
		}
	}

	function layout() {
		layoutFits();
		placeTips();
		// A matrix folded away on first paint measured every cell as one line.
		measureFeeMatrix();
	}

	let raf = 0;
	function scheduleLayout() {
		cancelAnimationFrame(raf);
		raf = requestAnimationFrame(layout);
	}

	/* ---------- small interactions inside mockups ---------- */

	function wireToggles() {
		for (const el of $$("[data-toggle]")) {
			const panel = document.getElementById(el.dataset.toggle);
			const flip = () => {
				const open = el.getAttribute("aria-expanded") !== "true";
				el.setAttribute("aria-expanded", String(open));
				if (panel) panel.hidden = !open;
				// Scaled mockups inside a panel that was hidden measured as zero.
				scheduleLayout();
			};
			el.addEventListener("click", flip);
			if (el.tagName === "BUTTON") continue;
			el.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					flip();
				}
			});
		}
	}

	function wireSwitches() {
		for (const sw of $$(".n-switch[tabindex]")) {
			const row = sw.closest(".n-perm-row");
			const sub = row && $("[data-sub-on]", row);
			// Sub-lines with markup (a dotted term) are both rendered and swapped by visibility,
			// so the term keeps its listeners.
			const states = row ? $$("[data-when]", row) : [];
			const flip = () => {
				const on = !sw.classList.contains("on");
				sw.classList.toggle("on", on);
				sw.setAttribute("aria-checked", String(on));
				if (sub) sub.textContent = on ? sub.dataset.subOn : sub.dataset.subOff;
				for (const el of states) el.hidden = el.dataset.when !== (on ? "on" : "off");
			};
			sw.addEventListener("click", flip);
			sw.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					flip();
				}
			});
		}
	}

	/* Live definition tooltips: hover opens after a short delay, focus at once, Esc closes,
	   and the pointer may rest on the tooltip itself. */
	function wireTerms() {
		let timer = 0;
		let live = null;
		let owner = null;
		const hide = () => {
			clearTimeout(timer);
			if (live) live.remove();
			if (owner) owner.removeAttribute("aria-describedby");
			live = null;
			owner = null;
		};
		const show = (term) => {
			hide();
			const root = term.closest(".nulo");
			if (!root) return;
			if (!term.id) term.id = `term-${Math.random().toString(36).slice(2, 9)}`;
			const tip = document.createElement("div");
			tip.className = "n-tip live";
			tip.id = "live-tip";
			tip.setAttribute("role", "tooltip");
			tip.dataset.tipFor = term.id;
			tip.dataset.tipMax = "272";
			const text = document.createElement("div");
			text.className = "n-tip-text";
			text.textContent = term.dataset.def;
			tip.append(text);
			tip.addEventListener("pointerenter", () => clearTimeout(timer));
			tip.addEventListener("pointerleave", () => {
				timer = setTimeout(hide, 150);
			});
			root.append(tip);
			term.setAttribute("aria-describedby", tip.id);
			live = tip;
			owner = term;
			placeTips();
		};
		for (const term of $$(".n-term[data-def]")) {
			term.addEventListener("pointerenter", () => {
				clearTimeout(timer);
				timer = setTimeout(() => show(term), 300);
			});
			term.addEventListener("pointerleave", () => {
				clearTimeout(timer);
				timer = setTimeout(hide, 150);
			});
			term.addEventListener("focus", () => show(term));
			term.addEventListener("blur", hide);
		}
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape") hide();
		});
	}

	/* ---------- item 3: fee-copy matrix ---------- */

	function fmtFj(x) {
		const fixed = (Math.round(x * 1e6) / 1e6).toFixed(6);
		return fixed.replace(/0+$/, "").replace(/\.$/, "");
	}

	function fmtUsd(v) {
		if (v < 0.001) return "<$0.001";
		return `$${(Math.round(v * 1000) / 1000).toFixed(3)}`;
	}

	const FX_STATES = [
		{ head: "Paying yourself", method: "Private Fee Juice", sponsored: false, priced: true, mult: 1 },
		{ head: "Sponsored", method: "Sponsored", sponsored: true, priced: true, mult: 1 },
		{ head: "Sponsored, no live price", method: "Sponsored", sponsored: true, priced: false, mult: 1 },
		{ head: "Sponsored, 4× the fee", method: "Sponsored", sponsored: true, priced: true, mult: 4 },
	];

	const row = (label, value, h) => `<div class="n-fee-row${h ? " h" : ""}"><span class="n-fee-label">${label}</span><span class="n-fee-mono" data-measure>${value}</span></div>`;
	const paid = (fj, usd) => `${fj}${usd ? ` <small>(${usd})</small>` : ""}`;
	const nothing = '<b style="font-weight:600">Nothing</b>';

	const FX_VARIANTS = [
		{ key: "V1", name: "Your words", why: "“the sponsor covers ~… FJ ($…)”", self: (fj, usd) => row("You pay", paid(fj, usd)), spon: (fj, usd) => row("You pay", `${nothing} <small>· the sponsor covers ${fj}${usd ? ` (${usd})` : ""}</small>`) },
		{ key: "V2", name: "Drop “the”", why: "same, 24px shorter", self: (fj, usd) => row("You pay", paid(fj, usd)), spon: (fj, usd) => row("You pay", `${nothing} <small>· sponsor covers ${fj}${usd ? ` (${usd})` : ""}</small>`) },
		{ key: "V3", name: "Dollars only", why: "FJ comes back when there's no price", self: (fj, usd) => row("You pay", paid(fj, usd)), spon: (fj, usd) => row("You pay", `${nothing} <small>· sponsor covers ${usd ? (usd.startsWith("<") ? usd : `~${usd}`) : fj}</small>`) },
		{ key: "V4", name: "Struck through", why: "the fee you'd have paid, crossed out", self: (fj, usd) => row("You pay", paid(fj, usd)), spon: (fj, usd) => row("You pay", `${nothing} <small><s>${fj}${usd ? ` (${usd})` : ""}</s></small>`) },
		{ key: "V4′", name: "Struck, dollars only", why: "FJ only when there's no live price", self: (fj, usd) => row("You pay", paid(fj, usd)), spon: (fj, usd) => row("You pay", `${nothing} <small><s>${usd ? (usd.startsWith("<") ? usd : `~${usd}`) : fj}</s></small>`) },
		{ key: "V5", name: "Two rows", why: "one line each, one more row", self: (fj, usd) => row("You pay", paid(fj, usd), true), spon: (fj, usd) => row("You pay", nothing, true) + row("Sponsor pays", paid(fj, usd), true) },
	];

	function lineCount(el) {
		const range = document.createRange();
		range.selectNodeContents(el);
		const tops = Array.from(range.getClientRects())
			.filter((r) => r.width > 0.5)
			.map((r) => r.top)
			.sort((a, b) => a - b);
		let lines = 0;
		let last = -Infinity;
		// Mixed font sizes on one line differ by a few px; a new line is a full line-height down.
		for (const t of tops) {
			if (t - last > 7) lines += 1;
			last = t;
		}
		return Math.max(1, lines);
	}

	const FX_GRIDS = [
		{ grid: "fx-grid", fj: "fx-fj", rate: "fx-rate", keys: ["V1", "V2", "V3", "V4", "V5"] },
		{ grid: "fx3-grid", fj: "fx3-fj", rate: "fx3-rate", keys: ["V3", "V4", "V4′"] },
	];

	function renderFeeGrid(spec) {
		const grid = document.getElementById(spec.grid);
		if (!grid) return;
		const fjIn = document.getElementById(spec.fj);
		const rateIn = document.getElementById(spec.rate);
		const fjBase = Math.min(1e6, Math.max(0, parseFloat(String(fjIn && fjIn.value).replace(",", ".")) || 0)) || 3.577824;
		const rateRaw = String(rateIn && rateIn.value).trim().replace(",", ".");
		const rate = rateRaw === "" ? null : Math.max(0, parseFloat(rateRaw) || 0);
		let html = FX_STATES.map((st) => `<div class="fx-colh">${st.head}</div>`).join("");
		for (const v of FX_VARIANTS.filter((x) => spec.keys.includes(x.key))) {
			html += `<div class="fx-rowh"><span class="opt-key">${v.key}</span><span class="opt-name">${v.name}</span><span class="why">${v.why}</span></div>`;
			for (const st of FX_STATES) {
				const amount = fjBase * st.mult;
				const fj = `~${fmtFj(amount)} FJ`;
				const usd = st.priced && rate !== null ? fmtUsd(amount * rate) : null;
				const rows = st.sponsored ? v.spon(fj, usd) : v.self(fj, usd);
				html += `<div class="fx-cell" data-variant="${v.key}"><div class="nulo" theme="${walletTheme}"><div class="n-fee"><div class="n-fee-card"><div class="n-fee-top"><span class="n-fee-label">Fee</span></div><div class="n-fee-trigger"><span class="n-fee-value">${st.method}</span><span class="ms">expand_more</span></div></div>${rows}</div></div><span class="fx-verdict"></span></div>`;
			}
		}
		grid.innerHTML = html;
		measureFeeMatrix();
	}

	function renderFeeMatrix() {
		for (const spec of FX_GRIDS) renderFeeGrid(spec);
	}

	function measureFeeMatrix() {
		for (const cell of $$(".fx-grid .fx-cell")) {
			const counts = $$("[data-measure]", cell).map(lineCount);
			const wraps = counts.some((n) => n > 1);
			const out = $(".fx-verdict", cell);
			out.classList.toggle("bad", wraps);
			if (wraps) out.textContent = `↵ wraps to ${Math.max(...counts)} lines`;
			else out.textContent = counts.length > 1 ? "✓ one line each · one more row" : "✓ one line";
		}
	}

	function wireFeeMatrix() {
		for (const spec of FX_GRIDS) {
			let t = 0;
			for (const id of [spec.fj, spec.rate]) {
				const el = document.getElementById(id);
				if (el)
					el.addEventListener("input", () => {
						clearTimeout(t);
						t = setTimeout(() => renderFeeGrid(spec), 150);
					});
			}
		}
		renderFeeMatrix();
	}

	/* ---------- item 12: replayable arrival ---------- */

	function wireReplay() {
		const btn = $("#i12-replay");
		const root = $("#i12-a");
		const calmBox = $("#i12-rm");
		if (!btn || !root) return;
		if (calmBox && window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) calmBox.checked = true;
		const fmt = (v) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		let frame = 0;
		btn.addEventListener("click", () => {
			const calm = Boolean(calmBox && calmBox.checked);
			cancelAnimationFrame(frame);
			root.classList.remove("n-arrive", "calm");
			void root.offsetWidth;
			root.classList.add("n-arrive");
			if (calm) root.classList.add("calm");
			const nums = $$("[data-count-from]", root);
			if (calm) {
				for (const n of nums) n.textContent = fmt(Number(n.dataset.countTo));
				return;
			}
			const t0 = performance.now();
			const step = (now) => {
				const k = Math.min(1, (now - t0) / 900);
				const e = 1 - (1 - k) ** 3;
				for (const n of nums) {
					const a = Number(n.dataset.countFrom);
					const b = Number(n.dataset.countTo);
					n.textContent = fmt(a + (b - a) * e);
				}
				if (k < 1) frame = requestAnimationFrame(step);
			};
			frame = requestAnimationFrame(step);
		});
	}

	function wireRows() {
		for (const row of $$("[data-opens]")) {
			const cap = row.closest(".stage") && $("[data-opened]", row.closest(".stage"));
			const open = () => {
				if (cap) cap.textContent = `Opens: ${row.dataset.opens}`;
				row.classList.add("flash");
				setTimeout(() => row.classList.remove("flash"), 450);
			};
			row.addEventListener("click", open);
			if (row.getAttribute("role") === "button") {
				row.addEventListener("keydown", (e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						open();
					}
				});
			}
		}
	}

	function renderSources() {
		const el = $("#sources");
		if (el) el.textContent = "Research: Sonnet 5 research agents read wallet source code (MetaMask, Rabby, Argent X, Talisman, SubWallet, Keplr, Backpack, Enkrypt, Frame), UX studies and platform docs in round 1, and design-system specs (Carbon, Atlassian, Material 3, USWDS, GOV.UK), toast libraries, Chrome's extension docs and WCAG in round 2. Every claim about Nulo comes from reading this repo. Sources are linked inline in each item.";
	}

	renderIndex();
	buildPickers();
	wireFeeMatrix();
	wireCopy();
	wireTheme();
	wireToggles();
	wireSwitches();
	wireTerms();
	wireRows();
	wireReplay();
	renderSources();
	layout();
	presetScroll();
	if (document.fonts && document.fonts.ready)
		document.fonts.ready.then(() => {
			measureFeeMatrix();
			scheduleLayout();
			presetScroll();
		});
	window.addEventListener("resize", scheduleLayout);
	if ("ResizeObserver" in window) {
		const ro = new ResizeObserver(scheduleLayout);
		for (const o of $$(".opts")) ro.observe(o);
	}
	connectDb();
})();
