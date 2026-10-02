#!/usr/bin/env python3
"""Generate the round-3 block for item 6 (permission window). The Details rows are the tools
app's real testnet request (buildCombinedManifest with four hub tokens and the drip tokens)."""
import pathlib

HERE = pathlib.Path(__file__).parent

AUTH_DEF = "Lets a contract do one specific thing for you, once."
RENAME_DEF = "A private name for this account visible only to this app."

# (label, known, simulate fns, add, transact fns)
S1_ROWS = [
    ("Fee Juice", True, ["claim", "claim_and_end_setup", "balance_of_public"], False, ["claim", "claim_and_end_setup"]),
    ("Sponsored fee payer", True, ["sponsor_unconditionally"], False, ["sponsor_unconditionally"]),
    ("Private fee payer", True, ["balance_of", "mint_and_pay_fee", "pay_fee"], True, ["mint_and_pay_fee", "pay_fee"]),
    ("Auth registry", True, ["set_authorized"], False, ["set_authorized"]),
    ("0x0c1e…5a7f", False, ["token_for", "portal_for", "exits_paused", "claim_public", "claim_private", "exit_to_l1_public", "exit_to_l1_private"], True,
     ["register_token", "register_and_claim_public", "claim_public", "claim_private", "exit_to_l1_public", "exit_to_l1_private"]),
    ("0x0024…6502", False, ["balance_of_private", "balance_of_public", "burn_public", "burn_private"], True, ["burn_public", "burn_private"]),
    ("0x14c1…ed96", False, ["balance_of_private", "balance_of_public", "burn_public", "burn_private"], True, ["burn_public", "burn_private"]),
    ("0x025c…d7e6", False, ["balance_of_private", "balance_of_public", "burn_public", "burn_private"], True, ["burn_public", "burn_private"]),
    ("0x0455…cba9", False, ["balance_of_private", "balance_of_public", "burn_public", "burn_private"], True, ["burn_public", "burn_private"]),
    ("0x0643…15fd", False, [], True, ["drip_to_public", "drip_to_private"]),
    ("0x0262…176a", False, ["balance_of_private", "balance_of_public"], True, []),
    ("0x14e0…d592", False, ["balance_of_private", "balance_of_public"], True, []),
]


def mark(on: bool, marks: str = "square") -> str:
    if not on:
        return '<span class="n-dt-no"></span>'
    return '<span class="ms n-dt-yes" aria-hidden="true">check</span>' if marks == "check" else '<span class="n-dt-yes"></span>'


def table(prefix: str, open_label: str | None, interactive: bool, marks: str = "square") -> str:
    out = [
        '<div class="n-dt">',
        '<div class="n-dt-head" aria-hidden="true"><span>Contract</span><span>Simulate</span><span>Add</span><span>Transact</span><span></span></div>',
    ]
    known_done = False
    for i, (label, known, sim, add, tx) in enumerate(S1_ROWS, 1):
        if i == 1:
            out.append('<div class="n-dt-sub">Nulo knows</div>')
        if not known and not known_done:
            known_done = True
            out.append('<div class="n-dt-sub">Nulo doesn\'t know</div>')
        pid = f"{prefix}-{i}"
        is_open = label == open_label
        name = (
            f'<span class="n-dt-name">{label}</span>'
            if known
            else f'<span class="n-dt-addr">{label}<span class="ms" aria-hidden="true">content_copy</span></span>'
        )
        if interactive:
            attrs = f' role="button" tabindex="0" aria-expanded="false" data-toggle="{pid}"'
        else:
            attrs = f' aria-expanded="{str(is_open).lower()}"'
        out.append(
            f'<div class="n-dt-row"{attrs}>{name}{mark(bool(sim), marks)}{mark(add, marks)}{mark(bool(tx), marks)}'
            '<span class="ms chev" aria-hidden="true">chevron_right</span></div>'
        )
        fns = []
        if sim:
            fns.append(f'<div class="n-dt-fn"><b>Simulate</b><span>{" · ".join(sim)}</span></div>')
        if tx:
            fns.append(f'<div class="n-dt-fn"><b>Transact</b><span>{" · ".join(tx)}</span></div>')
        hidden = "" if is_open else " hidden"
        out.append(f'<div class="n-dt-fns" id="{pid}"{hidden}>{"".join(fns)}</div>')
    out.append(
        '<div class="n-dt-foot">Function names come from the app. Anything it didn\'t list is refused instantly; you won\'t be asked.</div>'
    )
    out.append("</div>")
    return "".join(out)


def strip(net: str) -> str:
    return (
        '<div class="n-strip"><div class="n-strip-l"><span class="n-dot"></span><span class="n-strip-acct">Account 1</span>'
        f'<span class="n-strip-sep">/</span><span class="n-strip-net">{net}</span></div><span class="n-strip-brand">NULO</span></div>'
    )


def dapp(host: str, name: str, net: str) -> str:
    return (
        '<div class="n-dapp"><div class="n-dapp-logo"><svg class="ic"><use href="#i-globe"/></svg></div><div class="n-dapp-info">'
        f'<span class="n-dapp-host">{host}</span><span class="n-dapp-name">{name}</span><span class="n-dapp-action">wants to connect on {net}</span></div></div>'
    )


def account(net: str, rename_id: str | None = None) -> str:
    rid = f' id="{rename_id}"' if rename_id else ' role="button" tabindex="0"'
    def_attr = "" if rename_id else f' data-def="{RENAME_DEF}"'
    return (
        '<div class="n-group"><div class="n-seclabel">Account to share<span class="count">1</span></div>'
        '<div class="n-items"><div class="n-arow"><div class="n-arow-top"><svg class="ic c-primary"><use href="#i-check-circle"/></svg>'
        '<div class="n-arow-text"><div class="n-arow-line"><span class="n-arow-name">Account 1</span>'
        f'<span class="n-chain">{net.upper()}</span></div><div class="n-arow-line"><span class="n-arow-addr">0x1dd7...d930</span>'
        f'<span class="n-linkbtn n-term"{rid}{def_attr}>Rename for this app</span></div></div></div></div></div></div>'
    )


def row(icon: str, title: str, sub: str | None = None, flagged: bool = False, switch: dict | None = None, flag: str | None = None) -> str:
    cls = "n-perm-row flagged" if flagged else "n-perm-row"
    body = f'<div class="n-perm-t">{title}</div>'
    if switch and switch.get("html"):
        on = switch["on"]
        body += (
            f'<div class="n-perm-s" data-when="on"{"" if on else " hidden"}>{switch["sub_on"]}</div>'
            f'<div class="n-perm-s" data-when="off"{" hidden" if on else ""}>{switch["sub_off"]}</div>'
        )
    elif switch:
        on = switch["on"]
        body += (
            f'<div class="n-perm-s" data-sub-on="{switch["sub_on"]}" data-sub-off="{switch["sub_off"]}">'
            f'{switch["sub_on"] if on else switch["sub_off"]}</div>'
        )
    elif sub:
        body += f'<div class="n-perm-s">{sub}</div>'
    if flag:
        body += f'<span class="n-flag"><svg class="ic"><use href="#i-warning"/></svg>{flag}</span>'
    sw = ""
    if switch:
        state = " on" if switch["on"] else ""
        sw = (
            f'<span class="n-switch{state}" role="switch" aria-checked="{str(switch["on"]).lower()}" tabindex="0" '
            f'aria-label="{switch["label"]}"></span>'
        )
    return f'<div class="{cls}"><span class="ms">{icon}</span><div>{body}</div>{sw}</div>'


def group(label: str, rows: list[str]) -> str:
    return f'<div class="n-group"><div class="n-seclabel">{label}</div><div class="n-items n-perm">{"".join(rows)}</div></div>'


def term(word: str, tid: str | None = None) -> str:
    if tid:
        return f'<span class="n-term" id="{tid}">{word}</span>'
    return f'<span class="n-term" tabindex="0" data-def="{AUTH_DEF}">{word}</span>'


AUTH_EXACT = {
    "on": True,
    "sub_on": "Only for functions it listed.",
    "sub_off": "Nulo asks you for each one.",
    "label": "Authorizations without asking",
}
SIM_ROW = row("play_circle", "Run simulations and read the results", "Results can include your private balances.")
TX_ROW = row("task_alt", "Every transaction")


def details(label: str, panel: str | None = None, pid: str | None = None) -> str:
    if panel is None:
        return (
            '<div class="n-details" role="button" tabindex="0" aria-expanded="false">'
            f'<span>Details <span class="n-tag-quiet">· {label}</span></span><span class="ms">chevron_right</span></div>'
        )
    return (
        f'<div><div class="n-details" role="button" tabindex="0" aria-expanded="false" data-toggle="{pid}">'
        f'<span>Details <span class="n-tag-quiet">· {label}</span></span><span class="ms">chevron_right</span></div>'
        f'<div class="n-detail-panel" id="{pid}" hidden>{panel}</div></div>'
    )


def window(net: str, host: str, name: str, sections: list[str]) -> str:
    return (
        f'<div class="fit"><div class="nulo n-win" theme="dark" style="height:800px">{strip(net)}<div class="n-scroll">{dapp(host, name, net)}'
        f'<div class="n-sections">{"".join(sections)}</div></div>'
        '<div class="n-foot"><div class="n-btn medium outline">Reject</div><div class="n-btn medium primary">Connect</div></div></div></div>'
    )


def s1() -> str:
    win = window("Testnet", "tools.nulo.sh", "nulo-tools", [
        account("Testnet"),
        group("Without asking, it can", [
            row("visibility", "See Account 1's address"),
            SIM_ROW,
            row("add_circle", "Add contracts to your wallet"),
        ]),
        group("If you allow, it can", [row("signature", f"Get {term('authorizations')} without asking", switch=AUTH_EXACT)]),
        group("Always asks you first", [TX_ROW]),
        details("12 contracts", table("i6r3-s1", None, True), "i6r3-s1-details"),
    ])
    open_crop = (
        '<div class="fit"><div class="nulo n-crop w400" theme="dark" style="padding:16px">'
        '<div class="n-details" aria-expanded="true"><span>Details <span class="n-tag-quiet">· 12 contracts</span></span><span class="ms">chevron_right</span></div>'
        f'<div class="n-detail-panel">{table("i6r3-open", "0x0024…6502", False)}</div></div></div>'
    )
    tip_crop = (
        '<div class="fit"><div class="nulo n-crop w400" theme="dark" style="padding:16px 16px 64px">'
        '<div class="n-items n-perm">'
        + row("signature", f"Get {term('authorizations', 'i6r3-auth')} without asking", switch={**AUTH_EXACT})
        + '</div><div class="n-tip" data-tip-for="i6r3-auth" data-tip-max="272"><div class="n-tip-text">'
        + AUTH_DEF
        + "</div></div></div></div>"
    )
    return f'''<div class="opt" data-opt="S1">
			<div class="opt-head"><span class="opt-key">S1</span><span class="opt-name">The tools app's real request</span></div>
			<div class="stage">
				{win}
				<div class="cap">Hover the dotted words · the switch, Details and its rows work</div>
				{open_crop}
				<div class="cap">Details open, one row expanded · real addresses and functions from the testnet request</div>
				{tip_crop}
				<div class="cap">"Authorizations" pinned open</div>
			</div>
			<div class="notes">
				<div><h4>How it reads</h4><ul>
					<li>Three kinds of row, one group each: what it does without asking, what it does only if you allow it, and what always asks you.</li>
					<li>Details lists every contract once, with a mark for each permission that includes it. Tap a row for its functions, as the app sent them.</li>
				</ul></div>
			</div>
		</div>'''


def s2() -> str:
    win = window("Mainnet", "cards.example", "shielded-cards", [
        account("Mainnet"),
        group("Without asking, it can", [
            row("visibility", "See Account 1's address"),
            SIM_ROW,
            row("add_circle", "Add contracts to your wallet"),
        ]),
        group("If you allow, it can", [row("signature", f"Get {term('authorizations')} without asking", switch=AUTH_EXACT)]),
        group("Always asks you first", [TX_ROW]),
        '<div class="n-note">Nulo doesn\'t recognize any of its contracts.</div>',
        details("2 contracts"),
    ])
    return f'''<div class="opt" data-opt="S2">
			<div class="opt-head"><span class="opt-key">S2</span><span class="opt-name">Nulo recognizes nothing</span></div>
			<div class="stage">
				{win}
				<div class="cap">Made-up app · the common case on mainnet</div>
			</div>
			<div class="notes">
				<div><ul>
					<li>The note is one line of fact. The advice went: the site's name is already the first thing in the window. Still not orange, since an unknown contract isn't dangerous by itself.</li>
				</ul></div>
			</div>
		</div>'''


def s3() -> str:
    win = window("Mainnet", "swap.example", "swap", [
        account("Mainnet"),
        group("Without asking, it can", [
            row("visibility", "See Account 1's address"),
            row("play_circle", "Run simulations on any contract", "Results can include your private balances.", flagged=True, flag="Any contract"),
        ]),
        group("If you allow, it can", [
            row("signature", f"Get {term('authorizations')} without asking", flagged=True, switch={
                "on": False,
                "sub_on": "For any call, on any contract.",
                "sub_off": "Nulo asks you for each one. Off because it listed any contract.",
                "label": "Authorizations without asking",
            }),
            row("contacts", "See your address book", flagged=True, switch={
                "on": True,
                "sub_on": "Every name and address you saved.",
                "sub_off": "Not shared. The app may ask again later.",
                "label": "Share address book",
            }),
            row("help", "Use 1 permission Nulo doesn't recognize", flagged=True, switch={
                "on": False,
                "sub_on": "Nulo can't tell you what it allows.",
                "sub_off": "Nulo can't tell you what it allows.",
                "label": "Unknown permission",
            }),
        ]),
        group("Always asks you first", [row("task_alt", "Every transaction, on any contract")]),
        details("any contract"),
    ])
    return f'''<div class="opt" data-opt="S3">
			<div class="opt-head"><span class="opt-key">S3</span><span class="opt-name">A broad request</span></div>
			<div class="stage">
				{win}
				<div class="cap">Made-up app · every flag Nulo keeps · scrolls a little to Details, as the real window would</div>
			</div>
			<div class="notes">
				<div><ul>
					<li>Every switch is in the new group, and the unknown permission now sits above "Always asks you first".</li>
					<li>Authorizations start Off here because the list is "any contract". The unknown permission starts Off too; the box below is why I'd keep it that way.</li>
				</ul></div>
			</div>
		</div>'''


def main() -> None:
    html = f'''<div class="r2 r3" id="i6-r3">
	<div class="r2-head"><span class="r2-tag">Round 3</span><span class="r2-said">Less on screen, and one place for switches: a group called "If you allow, it can". The help line and the counts are gone, "refused" moves into Details, and Details becomes a table. Unknown permissions move up into the new group, still Off; the box under the windows says why.</span></div>

	<div class="facts">
		<div>
			<h3>What changed, by your notes</h3>
			<ul>
				<li><b>a.</b> The help line is gone. Every switch now lives in "If you allow, it can", so a switch always means the same thing, and nothing outside that group has one. That's the answer to "why does this one get a toggle?"</li>
				<li><b>a.</b> "Signatures" becomes "authorizations", the word Nulo's approval window already uses ("Authorizations the wallet will sign"). What you allow here is then what you'd approve there.</li>
				<li><b>b, c.</b> The note is one line, and the counts are off the rows; "12 contracts" stays only on the Details button. "You approve each one" goes too: the group title already says it, and without it the common case fits the 800px window with no scrolling.</li>
				<li><b>e.</b> The unknown permission sits above "Always asks you first", inside the new group.</li>
			</ul>
		</div>
		<div>
			<h3>Your question about "refused"</h3>
			<ul>
				<li>Yes, instantly. Nulo checks every request against the app's list before any window opens (<code>enforceScopeWithSession</code> in the dispatcher). A call it didn't list fails on the spot: the app gets an error, and you never see it.</li>
				<li>That's a fact about the list, so it moved under the list, in Details.</li>
			</ul>
		</div>
	</div>

	<div class="opts">
		{s1()}
		{s2()}
		{s3()}
	</div>

	<div class="push">
		<b>Unknown permissions On by default: I'd keep them Off</b>
		An unknown permission is a type Nulo's code doesn't have, for example one from a newer wallet-sdk; Nulo knows all six types that exist today. Turning it on can't make anything work, because there's no code behind it, so the app gets an error either way. What On does is store the grant, and a later Nulo that learns the type would honor it without asking again: a yes to something neither you nor Nulo could read when you gave it. <code>build-items.ts</code> keeps these Off for exactly that reason, after a codex audit flagged it. Off also tells the app the truth, so it can fall back instead of failing later. If you still want On, one change has to come first: a grant given while its type was unknown is asked again once Nulo learns it.
	</div>

	<div class="recbox">
		<div>
			<h3>My picks: Off = ask, and unknown permissions Off</h3>
			<p>What the authorizations switch does when it's off is still open from round 2. With "ask", the app keeps working and each authorization opens Nulo's confirmation window; with "none", today's behavior, the app gets none, and the bridge's exit stops working. Either way, the new group is what answers "why does this one get a toggle": every switch says "if you allow", and nothing else has one.</p>
			<p class="conf">Confidence: high on the group and on keeping unknown permissions Off; moderate on "ask" as the meaning of Off.</p>
		</div>
		<p class="conf">Still open: both picks moved up into round 4.</p>
	</div>
</div>
'''
    (HERE / "src" / "r3" / "i6.html").write_text(html)
    print("wrote src/r3/i6.html")


if __name__ == "__main__":
    main()
