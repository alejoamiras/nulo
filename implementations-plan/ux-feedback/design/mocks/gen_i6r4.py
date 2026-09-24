#!/usr/bin/env python3
"""Generate the round-4 block for item 6: check marks in Details, three wordings for the
authorizations row (drawn on and off), and the tools-app window with the recommended one."""
import pathlib

from gen_i6 import AUTH_DEF, SIM_ROW, TX_ROW, account, details, group, row, table, window

HERE = pathlib.Path(__file__).parent


def term(word: str) -> str:
    return f'<span class="n-term" tabindex="0" data-def="{AUTH_DEF}">{word}</span>'


# Every variant keeps the round-3 placement and assumes Off = ask.
VARIANTS = [
    {
        "key": "A",
        "name": "Keep the title, add the safety line",
        "title": f"Get {term('authorizations')} without asking",
        "on": "Each transaction still asks you first.",
        "off": "Nulo shows you each one first.",
        "note": "Smallest change. Still asks the reader to know what an authorization is, or to hover.",
    },
    {
        "key": "B",
        "name": "Say what it does",
        "rec": True,
        "title": "Act for you in transactions you approve",
        "on": f"Nulo signs its {term('authorizations')} without asking.",
        "off": f"You confirm each {term('authorization')} first.",
        "note": "The title reads without the tooltip, and it stays true either way: off only adds a window per authorization.",
    },
    {
        "key": "C",
        "name": "Give an example",
        "title": f"Get {term('authorizations')} without asking",
        "on": "Like a swap moving the tokens you trade. Each transaction still asks you.",
        "off": "Nulo shows you each one first.",
        "note": "Most concrete, but the example is Nulo's guess: the window can't know what this app will ask for.",
    },
]


def variant_rows(v: dict, on: bool) -> str:
    sw = {"on": on, "html": True, "sub_on": v["on"], "sub_off": v["off"], "label": "Authorizations without asking"}
    return group("If you allow, it can", [row("signature", v["title"], switch=sw)])


def crop(inner: str) -> str:
    return f'<div class="fit"><div class="nulo n-crop w400" theme="dark" style="padding:16px">{inner}</div></div>'


def variant(v: dict) -> str:
    rec = '<span class="opt-rec">Recommended</span>' if v.get("rec") else ""
    return f'''<div class="opt" data-opt="W{v["key"]}">
			<div class="opt-head"><span class="opt-key">{v["key"]}</span><span class="opt-name">{v["name"]}</span>{rec}</div>
			<div class="stage">
				{crop(variant_rows(v, True))}
				<div class="cap">On · the switch works</div>
				{crop(variant_rows(v, False))}
				<div class="cap">Off</div>
			</div>
			<div class="notes"><div><ul><li>{v["note"]}</li></ul></div></div>
		</div>'''


def s1_with_b() -> str:
    b = VARIANTS[1]
    win = window("Testnet", "tools.nulo.sh", "nulo-tools", [
        account("Testnet"),
        group("Without asking, it can", [
            row("visibility", "See Account 1's address"),
            SIM_ROW,
            row("add_circle", "Add contracts to your wallet"),
        ]),
        group("If you allow, it can", [row("signature", b["title"], switch={
            "on": True, "html": True, "sub_on": b["on"], "sub_off": b["off"], "label": "Authorizations without asking",
        })]),
        group("Always asks you first", [TX_ROW]),
        details("12 contracts", table("i6r4-s1", None, True, "check"), "i6r4-s1-details"),
    ])
    open_crop = (
        '<div class="fit"><div class="nulo n-crop w400" theme="dark" style="padding:16px">'
        '<div class="n-details" aria-expanded="true"><span>Details <span class="n-tag-quiet">· 12 contracts</span></span><span class="ms">chevron_right</span></div>'
        f'<div class="n-detail-panel">{table("i6r4-open", "0x0024…6502", False, "check")}</div></div></div>'
    )
    broad = crop(group("If you allow, it can", [row("signature", b["title"], flagged=True, switch={
        "on": False,
        "html": True,
        "sub_on": "For any call, on any contract.",
        "sub_off": f"You confirm each {term('authorization')} first. Off because it listed any contract.",
        "label": "Authorizations without asking",
    })]))
    return f'''<div class="opt" data-opt="S1B">
			<div class="opt-head"><span class="opt-key">S1</span><span class="opt-name">The tools app's request, with B</span></div>
			<div class="stage">
				{win}
				<div class="cap">Hover the dotted words · the switch, Details and its rows work</div>
				{open_crop}
				<div class="cap">Details open, one row expanded · check marks instead of squares</div>
				{broad}
				<div class="cap">B on a broad request (S3): off, flagged</div>
			</div>
			<div class="notes">
				<div><ul>
					<li>Nothing else in the window changes from round 3.</li>
				</ul></div>
			</div>
		</div>'''


def main() -> None:
    html = f'''<div class="r2 r3" id="i6-r4">
	<div class="r2-head"><span class="r2-tag">Round 4</span><span class="r2-said">The table stays, with check marks instead of squares. The authorizations row keeps its place and gets three new wordings, each drawn on and off. Three picks left, all on this item.</span></div>

	<div class="facts">
		<div>
			<h3>What the row has to say</h3>
			<ul>
				<li>An authorization does nothing on its own. With Nulo's accounts only your own wallet can use one, inside a transaction it runs: your account checks it against a key held in a private note that only your wallet can read. And every transaction asks you first.</li>
				<li>So the switch changes one thing: on, Nulo signs the app's authorizations without asking; off, you confirm each one before the transaction.</li>
				<li>The row has to get that across in two lines, without "authwit", "call" or "function".</li>
			</ul>
		</div>
		<div>
			<h3>The table</h3>
			<ul>
				<li>Same table and layout; a check marks each permission a contract is in, and nothing in it looks like a box to tick.</li>
				<li>I read "the rectangles" as the table's marks. The switches are the design system's own toggle (<code>Toggle.vue</code>), unchanged here; say if you meant those.</li>
			</ul>
		</div>
	</div>

	<div class="opts">
		{"".join(variant(v) for v in VARIANTS)}
	</div>

	<div class="opts">
		{s1_with_b()}
	</div>

	<div class="recbox">
		<div>
			<h3>My picks: B, Off = ask, unknown permissions Off</h3>
			<p>B puts what the permission does into the title, in words a tester already has: it acts for you, and only inside transactions you approve. "Authorization" moves down into the line that says what the switch changes, where the tooltip explains it. All three wordings assume Off = ask, which is still open from round 2; with Off = none, the off line would say the app gets none and the bridge's exit stops working.</p>
			<p class="conf">Confidence: moderate on B's words; high that the title should say what it does, not name the mechanism.</p>
		</div>
		<div class="picks2">
			<div class="pick" data-pick="i6d" data-legend="The authorizations row" data-options="A|B|C|Other"></div>
			<div class="pick" data-pick="i6b" data-legend="What Off means" data-options="Off = ask|Off = none|Other"></div>
			<div class="pick" data-pick="i6c" data-legend="Unknown permissions start" data-options="Off|On|Other"></div>
		</div>
	</div>
</div>
'''
    (HERE / "src" / "r4" / "i6.html").write_text(html)
    print("wrote src/r4/i6.html")


if __name__ == "__main__":
    main()
