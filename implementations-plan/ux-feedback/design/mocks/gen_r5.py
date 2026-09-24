#!/usr/bin/env python3
"""Generate round 5: the states the earlier rounds never drew, each with the recommended option
drawn and a picker. Writes src/r5/{i5,i6,i8,tips}.html."""
import pathlib

from gen_i6 import AUTH_DEF, RENAME_DEF, SIM_ROW, TX_ROW, dapp, details, group, row, strip, term

HERE = pathlib.Path(__file__).parent
OUT = HERE / "src" / "r5"

B_ON = f"Nulo signs its {term('authorizations')} without asking."
B_OFF = f"You confirm each {term('authorization')} first."
AUTH_SWITCH = {"on": True, "html": True, "sub_on": B_ON, "sub_off": B_OFF, "label": "Authorizations without asking"}
AUTH_ROW = row("signature", "Act for you in transactions you approve", switch=AUTH_SWITCH)


def crop(inner: str, w: str = "w400", pad: str = "16px") -> str:
    return f'<div class="fit"><div class="nulo n-crop {w}" theme="dark" style="padding:{pad}">{inner}</div></div>'


def opt(key: str, name: str, stage: str, notes: list[str], rec: bool = False) -> str:
    r = '<span class="opt-rec">Recommended</span>' if rec else ""
    li = "".join(f"<li>{n}</li>" for n in notes)
    return f'''<div class="opt" data-opt="{key}">
			<div class="opt-head"><span class="opt-key">{key}</span><span class="opt-name">{name}</span>{r}</div>
			<div class="stage">{stage}</div>
			<div class="notes"><div><ul>{li}</ul></div></div>
		</div>'''


def cap(text: str) -> str:
    return f'<div class="cap">{text}</div>'


def pick(pid: str, legend: str, options: str) -> str:
    return f'<div class="pick" data-pick="{pid}" data-round="5" data-legend="{legend}" data-options="{options}"></div>'


def block(bid: str, said: str, opts: list[str], picks: list[str], rec_title: str, rec_body: str, extra: str = "") -> str:
    return f'''<div class="r2 r3" id="{bid}">
	<div class="r2-head"><span class="r2-tag">Round 5</span><span class="r2-said">{said}</span></div>
	<div class="opts">
		{"".join(opts)}
	</div>
	{extra}
	<div class="recbox">
		<div>
			<h3>{rec_title}</h3>
			<p>{rec_body}</p>
			<p class="conf">Until you pick, the build uses the drawn option and its PR lists the surface as "sign-off pending".</p>
		</div>
		<div class="picks2">
			{"".join(picks)}
		</div>
	</div>
</div>
'''


def account_row(name: str, net: str, addr: str, selected: bool = True, rename: bool = True, alias: str | None = None) -> str:
    mark = '<svg class="ic c-primary"><use href="#i-check-circle"/></svg>' if selected else '<svg class="ic c-tertiary"><use href="#i-circle"/></svg>'
    link = f'<span class="n-linkbtn n-term" role="button" tabindex="0" data-def="{RENAME_DEF}">Rename for this app</span>' if rename and alias is None else ""
    field = (
        f'<div class="n-alias"><span class="n-alias-label">Name for this app</span><div class="n-alias-input focus">{alias}</div></div>'
        if alias is not None
        else ""
    )
    return (
        f'<div class="n-arow"><div class="n-arow-top">{mark}<div class="n-arow-text"><div class="n-arow-line">'
        f'<span class="n-arow-name">{name}</span><span class="n-chain">{net.upper()}</span></div><div class="n-arow-line">'
        f'<span class="n-arow-addr">{addr}</span>{link}</div></div></div>{field}</div>'
    )


def accounts_group(label: str, rows: list[str], count: int) -> str:
    return f'<div class="n-group"><div class="n-seclabel">{label}<span class="count">{count}</span></div><div class="n-items">{"".join(rows)}</div></div>'


def window(net: str, host: str, name: str, action: str, sections: list[str], confirm: str, height: str = "auto") -> str:
    head = dapp(host, name, net).replace(f"wants to connect on {net}", action)
    return (
        f'<div class="fit"><div class="nulo n-win" theme="dark" style="height:{height}">{strip(net)}<div class="n-scroll">{head}'
        f'<div class="n-sections">{"".join(sections)}</div></div>'
        f'<div class="n-foot"><div class="n-btn medium outline">Reject</div><div class="n-btn medium primary">{confirm}</div></div></div></div>'
    )


def banner(title: str, desc: str, action: str | None, done: bool = False) -> str:
    icon = "info"
    act = f'<span class="n-bnr-a">{action}</span>' if action else ""
    return (
        f'<div class="n-bnr{" done" if done else ""}"><svg class="ic"><use href="#i-{icon}"/></svg><div class="n-bnr-b">'
        f'<span class="n-bnr-t">{title}</span><span class="n-bnr-d">{desc}</span>{act}</div></div>'
    )


# ---------- item 6 ----------


def u1() -> tuple[str, str]:
    folded = '<div class="n-details" role="button" tabindex="0" aria-expanded="false"><span>Already allowed <span class="n-tag-quiet">· 5</span></span><span class="ms">chevron_right</span></div>'
    book = row("contacts", "See your address book", switch={
        "on": True, "html": True, "sub_on": "Every name and address you saved.", "sub_off": "Not shared. The app may ask again later.", "label": "Share address book",
    })
    a = window("Testnet", "tools.nulo.sh", "nulo-tools", "wants more permissions on Testnet", [
        group("If you allow, it can", [book]),
        folded,
        details("12 contracts"),
    ], "Allow")
    new_tag = '<span class="n-tag-quiet" style="color:var(--nulo-accent)">New</span>'
    book_new = book.replace('<div class="n-perm-t">See your address book</div>', f'<div class="n-perm-t">See your address book {new_tag}</div>')
    b = window("Testnet", "tools.nulo.sh", "nulo-tools", "wants more permissions on Testnet", [
        group("Without asking, it can", [row("visibility", "See Account 1's address"), SIM_ROW, row("add_circle", "Add contracts to your wallet")]),
        group("If you allow, it can", [AUTH_ROW, book_new]),
        group("Always asks you first", [TX_ROW]),
        details("12 contracts"),
    ], "Allow")
    oa = opt("U1A", "A connected app asks for more: only what's new", a + cap("The tools app already has five permissions and now asks for the address book"), [
        "The groups hold only the new rows; everything already granted folds into \"Already allowed · 5\", styled like Details.",
        "The action reads \"wants more permissions on Testnet\" and the button \"Allow\": \"Connect\" would be wrong for an app that is already connected.",
        "Today's window shows two sections, \"New permissions requested\" and \"Already granted\".",
    ], rec=True)
    ob = opt("U1B", "Everything, with the new rows tagged", b + cap("Same request, every row in its group"), [
        "The whole window as on first connect, with \"New\" beside what's being asked now.",
        "Longer, but you see everything the app will hold after you allow.",
    ])
    return oa + ob, pick("i6e", "U1 · asking for more", "A|B|Other")


def u2() -> tuple[str, str]:
    rows = [account_row("Account 1", "Testnet", "0x1dd7...d930"), account_row("Account 2", "Testnet", "0x8c02...41fa"), account_row("Savings", "Testnet", "0x2b9e...07c4", selected=False, rename=False)]
    inner = accounts_group("Accounts to share", rows, 3) + group("Without asking, it can", [row("visibility", "See the addresses of the accounts you share"), SIM_ROW])
    o = opt("U2", "Several accounts", crop(f'<div class="n-sections" style="padding:0">{inner}</div>') + cap("Three accounts on this network, two shared"), [
        "The label goes plural and every account keeps today's selectable row, each with its own \"Rename for this app\".",
        "The first row under \"Without asking\" names no account: \"See the addresses of the accounts you share\".",
        "An unshared account drops its rename link; today's rows already hide the alias field when unselected.",
    ], rec=True)
    return o, pick("i6f", "U2 · several accounts", "As drawn|Other")


def u3() -> tuple[str, str]:
    mism = banner("Connecting on Testnet", "Your wallet is on Mainnet. Connect as is, or switch to see Testnet balances.", "Switch wallet to Testnet")
    done = banner("Wallet switched to Testnet", "Balances and activity now follow Testnet.", None, done=True)
    acct = accounts_group("Account to share", [account_row("Account 1", "Testnet", "0x1dd7...d930")], 1)
    stage = crop(f'<div class="n-sections" style="padding:0">{mism}{acct}</div>') + cap("The app is on Testnet, the wallet on Mainnet") + crop(f'<div class="n-sections" style="padding:0">{done}{acct}</div>') + cap("After the switch")
    o = opt("U3", "Network banners", stage, [
        "Today's banner and button, in today's place above the accounts.",
        "One word changes: \"Approve as is\" becomes \"Connect as is\", to match the new button.",
    ], rec=True)
    return o, pick("i6g", "U3 · network banners", "As drawn|Other")


def u4() -> tuple[str, str]:
    rows = [
        ("Without asking", "Account address (<code>accounts.canGet</code>)", "See Account 1's address", "—", "drawn"),
        ("Without asking", "Several accounts", "See the addresses of the accounts you share", "—", "U2"),
        ("Without asking", "Simulation, listed contracts", "Run simulations and read the results", "Results can include your private balances.", "drawn"),
        ("Without asking", "Simulation, any contract", "Run simulations on any contract · <em>Any contract</em>", "Results can include your private balances.", "drawn"),
        ("Without asking", "Add contracts (<code>contracts.canRegister</code>)", "Add contracts to your wallet", "—", "drawn"),
        ("Without asking", "Add contracts, any contract", "Add any contract to your wallet · <em>Any contract</em>", "—", "new"),
        ("Without asking", "Contract details only (<code>contracts.canGetMetadata</code>)", "See details of contracts in your wallet", "—", "new"),
        ("Without asking", "Contract classes (<code>contractClasses</code>)", "Look up contract code on Testnet", "Public information any node can give it.", "new"),
        ("If you allow · On, Off on any contract", "Authorizations (<code>accounts.canCreateAuthWit</code>)", "Act for you in transactions you approve", "On: Nulo signs its authorizations without asking. · Off: You confirm each authorization first.", "drawn"),
        ("If you allow · On", "Address book (<code>data.addressBook</code>)", "See your address book", "On: Every name and address you saved. · Off: Not shared. The app may ask again later.", "drawn"),
        ("If you allow · On", "Private events, listed contracts (<code>data.privateEvents</code>)", "See private events from its contracts", "On: Private messages its contracts sent to your accounts, like a transfer you received. · Off: Not shared. The app may ask again later.", "new"),
        ("If you allow · Off", "Private events, any contract", "See private events from any contract · <em>Any contract</em>", "Same lines; starts Off, like authorizations on any contract.", "new"),
        ("If you allow · Off", "Unknown permission", "Use 1 permission Nulo doesn't recognize", "Nulo can't tell you what it allows.", "drawn"),
        ("Always asks you first", "Transactions, listed contracts", "Every transaction", "—", "drawn"),
        ("Always asks you first", "Transactions, any contract", "Every transaction, on any contract", "—", "drawn"),
    ]
    trs = "".join(
        f'<tr class="{kind}"><td>{g}</td><td>{when}</td><td><b>{title}</b></td><td>{sub}</td><td><span class="st {"r5" if kind == "new" else "decided"}">{ {"drawn": "Drawn", "new": "New", "U2": "U2"}[kind] }</span></td></tr>'
        for g, when, title, sub, kind in rows
    )
    table = (
        '<div class="scroll-x"><table class="ledger rowdict"><thead><tr><th>Group · default</th><th>When the app asks for</th>'
        f'<th>Row</th><th>Line under it</th><th></th></tr></thead><tbody>{trs}</tbody></table></div>'
    )
    events = row("mail_lock", "See private events from its contracts", switch={
        "on": True, "html": True, "sub_on": "Private messages its contracts sent to your accounts, like a transfer you received.",
        "sub_off": "Not shared. The app may ask again later.", "label": "Share private events",
    })
    classes = row("code_blocks", "Look up contract code on Testnet", "Public information any node can give it.")
    stage = crop(f'<div class="n-sections" style="padding:0">{group("Without asking, it can", [classes])}{group("If you allow, it can", [events])}</div>') + cap("Contract code, and private events from its contracts")
    o = opt("U4", "The two rows no round drew", stage, [
        "The table below lists every row the window can show, so the build never invents one: the ones rounds 3 and 4 drew, and six new ones.",
        "Private events and the address book arrive as one permission (<code>data</code>); each gets its own switch, and Connect grants only the ones left on.",
        "Contract code is public: any node serves it, so it sits under \"Without asking\" with no switch.",
    ], rec=True)
    extra = f'<div class="rowdict-wrap"><h3>Every row the window can show</h3>{table}</div>'
    return o, pick("i6h", "U4 · the row list", "As listed|Other"), extra


def u5() -> tuple[str, str]:
    field = accounts_group("Account to share", [account_row("Account 1", "Testnet", "0x1dd7...d930", alias="Account 1")], 1)
    o = opt("U5", "\"Rename for this app\", clicked", crop(f'<div class="n-sections" style="padding:0">{field}</div>') + cap("The link turns into today's field, prefilled and focused"), [
        "Clicking the link swaps it for today's alias field, labelled \"Name for this app\" (the glossary word), prefilled with the account's name.",
        "No helper line: the link's tooltip already said it, and round 1 dropped the helper for item 2.",
    ], rec=True)
    return o, pick("i6i", "U5 · rename", "As drawn|Other")


def u6() -> tuple[str, str]:
    card = (
        '<div class="n-opcard"><span class="n-opcard-t">Authorization</span>'
        '<div class="n-prop"><span class="k">From account:</span><span class="v">Account 1 <span class="k">(0x1dd7…d930)</span></span></div>'
        '<div class="n-prop"><span class="k">Message type:</span><span class="v b">Call intent</span></div>'
        '<div class="n-prop"><span class="k">Authorizes:</span><span class="v mono">0x0c1e…5a7f</span></div>'
        '<div class="n-prop"><span class="k">Target contract:</span><span class="v mono">0x0024…6502</span></div>'
        '<div class="n-prop"><span class="k">Function:</span><span class="v b">burn_private</span></div>'
        '<div class="n-opgroup"><span class="k">Arguments</span>'
        '<div class="n-arg"><span class="k">from:</span><span class="v mono">0x1dd7…d930</span></div>'
        '<div class="n-arg"><span class="k">amount:</span><span class="v">250000000</span></div>'
        '<div class="n-arg"><span class="k">authwit_nonce:</span><span class="v mono">0x2f41…c09a</span></div>'
        "</div></div>"
    )
    win = window("Testnet", "tools.nulo.sh", "nulo-tools", "wants to execute the following", [
        f'<div class="n-group"><div class="n-seclabel">Requested operations<span class="count">1</span></div>{card}</div>',
    ], "Confirm")
    o = opt("U6", "The authorization window (Off = ask)", win + cap("What opens for each authorization when the switch is off"), [
        "Today's window for a contract-and-hash request, unchanged except the card's title: \"Create authwit\" becomes \"Authorization\", the glossary word.",
        "Everything else stays as today, including \"Message type\" and \"Authorizes:\". Reworking this window would be a separate item.",
    ], rec=True)
    return o, pick("i6j", "U6 · authorization window", "As drawn|Other")


def u7() -> tuple[str, str]:
    grants = "".join(
        f'<div class="n-grant"><span class="l"><svg class="ic"><use href="#i-check-circle"/></svg>{g}</span><svg class="ic"><use href="#i-chevron"/></svg></div>'
        for g in ("Account access", "Transaction simulation", "Contract registration", "Send transactions", "Private data")
    )
    a = crop(
        '<div class="n-subhdr"><span class="ms">arrow_back</span><span class="n-subhdr-title">Connected App</span></div>'
        '<div class="n-sections" style="padding:16px 0 0">'
        f'{group("If you allow, it can", [AUTH_ROW])}'
        f'<div class="n-group"><div class="n-seclabel">Granted permissions<span class="count">5</span></div><div class="n-grants">{grants}</div></div></div>'
    )
    b = crop(
        '<div class="n-subhdr"><span class="ms">arrow_back</span><span class="n-subhdr-title">Connected App</span></div>'
        '<div class="n-sections" style="padding:16px 0 0">'
        f'{group("Without asking, it can", [row("visibility", "See Account 1\'s address"), SIM_ROW, row("add_circle", "Add contracts to your wallet")])}'
        f'{group("If you allow, it can", [AUTH_ROW, row("contacts", "See your address book", switch={"on": True, "html": True, "sub_on": "Every name and address you saved.", "sub_off": "Not shared. The app may ask again later.", "label": "Share address book"})])}'
        f'{group("Always asks you first", [TX_ROW])}</div>'
    )
    oa = opt("U7A", "Settings: one switch above today's list", a + cap("Settings → Connected apps → tools.nulo.sh"), [
        "The one choice you might change later, the authorizations switch, moves here with the window's words. Turning it off takes effect on the next request.",
        "The rest of the page stays as today, including the permission names there.",
    ], rec=True)
    ob = opt("U7B", "Settings in the window's words", b + cap("Same page, rewritten"), [
        "Every granted permission as the window showed it, switches included.",
        "Consistent, but a bigger change to a page testers didn't comment on.",
    ])
    return oa + ob, pick("i6k", "U7 · connected app settings", "A|B|Other")


def item6() -> str:
    parts = [u1(), u2(), u3(), u4(), u5(), u6(), u7()]
    opts = [p[0] for p in parts]
    picks = [p[1] for p in parts]
    extra = "".join(p[2] for p in parts if len(p) > 2)
    return block(
        "i6-r5",
        "Seven states the code has and no round drew: asking for more, several accounts, the network banners, every possible row, renaming, the authorization window and the settings page. Cancelled and error overlays stay as they are.",
        opts,
        picks,
        "My picks: the recommended option on each",
        "Each keeps today's behaviour and changes the least that the decided design forces: the new words, the new groups, one switch in Settings.",
        extra,
    )


# ---------- tooltip map: the two rule-6 fixes ----------


def tips() -> str:
    host = (
        '<div class="n-dapp" style="align-items:flex-start"><div class="n-dapp-logo"><svg class="ic"><use href="#i-globe"/></svg></div><div class="n-dapp-info">'
        '<span class="n-dapp-host">xn--tls-seda.nulo.sh</span>'
        '<span class="n-warnline"><svg class="ic"><use href="#i-warning"/></svg>This hostname contains non-ASCII or punycoded characters. Verify carefully — some characters can imitate Latin letters.</span>'
        '<span class="n-dapp-name">nulo-tools</span><span class="n-dapp-action">wants to connect on Testnet</span></div></div>'
    )
    o8 = opt("U8", "Suspicious hostname, as text", crop(host, pad="0") + cap("Punycode for a look-alike of tools.nulo.sh"), [
        "Today's sentence, word for word, in orange under the host instead of behind a hover on the warning icon.",
        "Every dApp window shares this block, so all of them get it.",
    ], rec=True)
    phrase = (
        '<div class="n-field"><span class="n-flabel">Recovery Phrase</span>'
        '<span class="n-fnote">24 words separated by spaces. Use a phrase generated by Nulo — a phrase shared with another wallet lets that software derive your keys.</span>'
        '<div class="n-onb-input"><span class="ph">Enter recovery phrase</span></div></div>'
    )
    o9 = opt("U9", "Recovery-phrase note, as text", crop(f'<div class="n-form">{phrase}</div>') + cap("Import → Recovery Phrase"), [
        "Today's sentence, word for word, between the label and the field; the ⓘ goes.",
    ], rec=True)
    return block(
        "tips-r5",
        "The map decided that these two warnings stop being tooltips. Here is what they look like as text.",
        [o8, o9],
        [pick("tipsb", "U8 · hostname warning", "As drawn|Other"), pick("tipsc", "U9 · recovery-phrase note", "As drawn|Other")],
        "My picks: both as drawn",
        "No new words: both keep today's sentence and only come out from behind the hover.",
    )


# ---------- item 5: first-run import ----------


def item5() -> str:
    steps = "".join(
        f'<div class="n-step{" past" if i == 1 else " active" if i == 2 else ""}"><span class="n-step-num">0{i}</span><span class="n-step-bar"></span><span class="n-step-label">{label}</span></div>'
        for i, label in enumerate(["Terms", "Setup", "Aztec", "Fees", "Speed", "Done"], 1)
    )
    methods = "".join(
        f'<div class="n-si"><div class="n-si-t"><span class="n-si-title">{m}</span></div><span class="ms chev">chevron_right</span></div>'
        for m in ("Full Backup", "Recovery Phrase", "Passkey")
    )
    page = (
        '<div class="fit"><div class="nulo n-tab" theme="dark"><span class="n-back"><span class="ms">arrow_back</span>Back</span>'
        f'<div class="n-steps">{steps}</div>'
        '<div class="n-hero"><div class="n-bt"><span class="m">Import</span><span class="s">Wallet</span></div><div class="n-hero-bar"></div>'
        '<p class="n-hero-sub">Restore from a recovery phrase, passkey, or full backup.</p></div>'
        f'<div class="n-form"><div class="n-field"><span class="n-flabel">Import with</span><div class="n-setbox">{methods}</div></div></div>'
        "</div></div>"
    )
    o = opt("U11", "First-run import without the name field", page + cap("The profile is named \"Main\", or the backup's own name when a full backup has one"), [
        "Same rule as create: at first run there's no name field, and the hero reads \"Import / Wallet\" to match \"Create / Wallet\".",
        "A full backup that carries a profile name keeps it; otherwise the profile is \"Main\".",
    ], rec=True)
    return block(
        "i5-r5",
        "Item 5 took the name field off first-run create. First-run import still has it.",
        [o],
        [pick("i5b", "U11 · first-run import", "As drawn|Other")],
        "My pick: as drawn",
        "Setup means both ways in: a tester restoring a wallet meets the same question the create page no longer asks.",
    )


# ---------- item 8: the review sheet and the fee tag ----------


def item8() -> str:
    def rv(icon: str, name: str, word: str, sentence: str | None, cls: str) -> str:
        s = f'<span class="n-rv-why">{sentence}</span>' if sentence else ""
        return f'<div class="n-rv-row {cls}"><svg class="ic"><use href="#i-{icon}"/></svg><div class="n-rv-body"><div class="n-rv-top"><span>{name}</span><span class="n-rv-word">{word}</span></div>{s}</div></div>'

    sheet = (
        '<div class="n-rv"><div class="n-rv-head"><span class="n-rv-title">Review</span><span class="ms">close</span></div>'
        '<div class="n-rv-sum"><span class="n-rv-amt">250<small>USDC</small></span><span class="n-rv-to">to 0x8c02…41fa</span></div>'
        '<div class="n-rv-rows"><div class="n-rv-rhead">This send publishes</div>'
        + rv("globe", "Your address", "FEE PAYER", "This send hides the amount and the recipient, but the fee names your account publicly. Anyone watching the chain learns this account sent something, and when.", "v-exposed")
        + rv("lock", "Recipient", "HIDDEN", None, "v-hidden")
        + rv("lock", "Amount", "HIDDEN", None, "v-hidden")
        + '</div><div class="n-rv-fee"><span>Fee · ~3.577824 FJ ($0.215)</span><b>paid by your address</b></div><div class="n-btn cta">Send now</div></div>'
    )
    tag = (
        '<div class="n-fee"><div class="n-fee-card"><div class="n-fee-top"><span class="n-fee-label">Fee</span>'
        '<span class="n-names-tag"><svg class="ic"><use href="#i-globe"/></svg>NAMES YOUR ADDRESS</span></div>'
        '<div class="n-fee-trigger"><span class="n-fee-value">Public Fee Juice</span><span class="ms">expand_more</span></div></div></div>'
    )
    o = opt("U12", "The same padlock and globe everywhere", crop(sheet, pad="0") + cap("The review sheet behind the strip's chevron") + crop(tag) + cap("The fee card's tag when the fee names you"), [
        "The strip, the review sheet and the fee tag share one mark today; the decision drew the strip. This carries the same glyphs to the other two, so private is always the padlock and public the globe.",
        "Words and sentences unchanged.",
    ], rec=True)
    return block(
        "i8-r5",
        "Item 8 swapped the strip's squares for the padlock and globe. The review sheet and the fee tag use the same squares.",
        [o],
        [pick("i8b", "U12 · review sheet and fee tag", "As drawn|Keep squares there|Other")],
        "My pick: as drawn",
        "One vocabulary: the code keeps these marks in one shared stylesheet so they can't disagree, and splitting them would bring the disagreement back.",
    )


def main() -> None:
    OUT.mkdir(exist_ok=True)
    (OUT / "i6.html").write_text(item6())
    (OUT / "tips.html").write_text(tips())
    (OUT / "i5.html").write_text(item5())
    (OUT / "i8.html").write_text(item8())
    print("wrote src/r5/{i5,i6,i8,tips}.html")


if __name__ == "__main__":
    main()
