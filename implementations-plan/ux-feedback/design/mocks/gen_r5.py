#!/usr/bin/env python3
"""Generate round 5: the states the earlier rounds never drew, each with the recommended option
drawn and a picker. Writes src/r5/{i3,i5,i6,i8,tips}.html."""
import pathlib

from gen_i6 import AUTH_DEF, RENAME_DEF, SIM_ROW, TX_ROW, account, dapp, details, group, mark, row, strip, table, term

HERE = pathlib.Path(__file__).parent
OUT = HERE / "src" / "r5"

B_ON = f"Nulo signs its {term('authorizations')} without asking."
B_OFF = f"You confirm each {term('authorization')} first."
AUTH_SWITCH = {"on": True, "html": True, "sub_on": B_ON, "sub_off": B_OFF, "label": "Authorizations without asking"}
AUTH_ROW = row("signature", "Act for you in transactions you approve", switch=AUTH_SWITCH)


def fit_id(fid: str | None) -> str:
    return f' id="{fid}"' if fid else ""


def crop(inner: str, w: str = "w400", pad: str = "16px", fid: str | None = None) -> str:
    return f'<div class="fit"{fit_id(fid)}><div class="nulo n-crop {w}" theme="dark" style="padding:{pad}">{inner}</div></div>'


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


def block(bid: str, said: str, opts: list[str], picks: list[str], rec_title: str, rec_body: str, extra: str = "", tag: str = "Round 5") -> str:
    return f'''<div class="r2 r3" id="{bid}">
	<div class="r2-head"><span class="r2-tag">{tag}</span><span class="r2-said">{said}</span></div>
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


def window(net: str, host: str, name: str, action: str, sections: list[str], confirm: str, height: str = "auto", fid: str | None = None) -> str:
    head = dapp(host, name, net).replace(f"wants to connect on {net}", action)
    return (
        f'<div class="fit"{fit_id(fid)}><div class="nulo n-win" theme="dark" style="height:{height}">{strip(net)}<div class="n-scroll">{head}'
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
        '<span class="n-warnline"><svg class="ic"><use href="#i-warning"/></svg>This hostname contains non-ASCII or punycoded characters. Verify carefully. Some characters can imitate Latin letters.</span>'
        '<span class="n-dapp-name">nulo-tools</span><span class="n-dapp-action">wants to connect on Testnet</span></div></div>'
    )
    o8 = opt("U8", "Suspicious hostname, as text", crop(host, pad="0") + cap("Punycode for a look-alike of tools.nulo.sh"), [
        "Today's words, the dash now a full stop, in orange under the host instead of behind a hover on the warning icon.",
        "Every dApp window shares this block, so all of them get it.",
    ], rec=True)
    phrase = (
        '<div class="n-field"><span class="n-flabel">Recovery Phrase</span>'
        '<span class="n-fnote">24 words separated by spaces. Use a phrase generated by Nulo. A phrase shared with another wallet lets that software derive your keys.</span>'
        '<div class="n-onb-input"><span class="ph">Enter recovery phrase</span></div></div>'
    )
    o9 = opt("U9", "Recovery-phrase note, as text", crop(f'<div class="n-form">{phrase}</div>') + cap("Import → Recovery Phrase"), [
        "Today's words, the dash now a full stop, between the label and the field; the ⓘ goes.",
    ], rec=True)
    return block(
        "tips-r5",
        "The map decided that these two warnings stop being tooltips. Here is what they look like as text.",
        [o8, o9],
        [pick("tipsb", "U8 · hostname warning", "As drawn|Other"), pick("tipsc", "U9 · recovery-phrase note", "As drawn|Other")],
        "My picks: both as drawn",
        "No new words: both keep today's wording, with no em dash, and only come out from behind the hover.",
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
    lock = '<svg class="ic"><use href="#i-lock"/></svg>'

    def cell(cls: str, glyph: str, name: str, word: str) -> str:
        return f'<span class="n-pub-cell {cls}">{glyph}<b>{name}</b><span class="w">{word}</span></span>'

    def unknown_stage(glyph: str, row_glyph: str) -> str:
        strip = (
            '<div class="n-bottom"><div class="n-pub">'
            + cell("v-unknown", glyph, "You", "—")
            + cell("v-hidden", lock, "To", "HIDDEN")
            + cell("v-hidden", lock, "Amount", "HIDDEN")
            + '<span class="n-pub-chev"><span class="ms">chevron_right</span></span></div><div class="n-btn cta">Confirm transaction</div></div>'
        )
        row = (
            f'<div class="n-rv-rows" style="margin:16px"><div class="n-rv-rhead">This send publishes</div><div class="n-rv-row v-unknown">{row_glyph}'
            '<div class="n-rv-body"><div class="n-rv-top"><span>Your address</span><span class="n-rv-word">—</span></div>'
            '<span class="n-rv-why">This fee contract was added by hand. Nulo cannot tell what it publishes about you.</span></div></div>'
            + rv("lock", "Recipient", "HIDDEN", None, "v-hidden")
            + "</div>"
        )
        return crop(strip, pad="0") + cap("The strip") + crop(row, pad="0") + cap("Its review sheet")

    help_glyph = '<svg class="ic"><use href="#i-help"/></svg>'
    square = '<i class="n-mark"></i>'
    ua = opt("U13A", "When Nulo can't tell who pays: no mark", unknown_stage("", '<span class="n-rv-gap"></span>'), [
        "The dash already says it. A square would read as a checkbox again, the complaint that started item 8.",
        "The review sheet keeps the mark's space, so the row's words line up with the others.",
    ], rec=True)
    ub = opt("U13B", "A question mark", unknown_stage(help_glyph, help_glyph), [
        "Says \"unknown\" with a third glyph; one more shape to learn.",
    ])
    uc = opt("U13C", "Keep today's faint square", unknown_stage(square, square), [
        "Unchanged, and the only square left on the screen.",
    ])
    return block(
        "i8-r5",
        "Item 8 swapped the strip's squares for the padlock and globe. The review sheet and the fee tag use the same squares, and one state has neither: while Nulo can't tell who pays the fee, or when a fee contract was added by hand.",
        [o, ua, ub, uc],
        [
            pick("i8b", "U12 · review sheet and fee tag", "As drawn|Keep squares there|Other"),
            pick("i8c", "U13 · who pays, unknown", "A|B|C|Other"),
        ],
        "My picks: as drawn, and no mark when unknown",
        "One vocabulary: the code keeps these marks in one shared stylesheet so they can't disagree, and splitting them would bring the disagreement back. The unknown state gets no shape of its own; its dash and its sentence already say what Nulo knows.",
    )


def item3() -> str:
    def menu(rows: list[tuple[str, str, str]]) -> str:
        items = "".join(f'<div class="n-menu-item{cls}"><span>{title}</span><span class="meta">{meta}</span></div>' for title, meta, cls in rows)
        return f'<div class="n-menu">{items}</div>'

    def menus(loading: list[tuple[str, str, str]], failed: list[tuple[str, str, str]]) -> str:
        return crop(menu(loading)) + cap("Before the balances arrive") + crop(menu(failed)) + cap("When one balance couldn't be read")

    sponsored = ("Sponsored", "free", " sel")
    failed_honest = [("Public Fee Juice", "1.2 FJ", ""), ("Private Fee Juice", "couldn't check balance", " dis"), sponsored]
    ua = opt("U14A", "A dash until the balances arrive; say which couldn't be read", menus(
        [("Public Fee Juice", "— FJ", ""), ("Private Fee Juice", "— FJ", ""), sponsored], failed_honest), [
        "Until the balances arrive, including while the card retries a read that failed, the column reads \"— FJ\", the dash the card's Available row already uses. The rows stay selectable, as today.",
        "When a balance comes back unreadable, that row is disabled with \"couldn't check balance\", public and private alike. Today private says \"no balance\" there, which isn't true.",
    ], rec=True)
    ub = opt("U14B", "Nothing while loading", menus(
        [("Public Fee Juice", "", ""), ("Private Fee Juice", "", ""), sponsored], failed_honest), [
        "The right column stays empty until the balances arrive; an unreadable balance as in A.",
    ])
    uc = opt("U14C", "Today's words until the balances arrive", menus(
        [("Public Fee Juice", "public", ""), ("Private Fee Juice", "private", ""), sponsored],
        [("Public Fee Juice", "1.2 FJ", ""), ("Private Fee Juice", "no balance", " dis"), sponsored]), [
        "Keeps \"public\" / \"private\" until the balances arrive, and today's words for an unreadable balance: \"no balance\" on private.",
    ])

    def spoken(sentence: str) -> str:
        card = (
            '<div class="n-fee"><div class="n-fee-card"><div class="n-fee-top"><span class="n-fee-label">Fee</span></div>'
            '<div class="n-fee-trigger"><span class="n-fee-value">Sponsored</span><span class="ms">expand_more</span></div></div>'
            '<div class="n-fee-row"><span class="n-fee-label">You pay</span><span class="n-fee-mono"><b style="font-weight:600">Nothing</b> '
            '<small><s>~0.004 FJ (&lt;$0.001)</s></small></span></div></div>'
        )
        return crop(card) + cap("What you see") + f'<div class="srline">{sentence}</div>' + cap("What a screen reader says")

    sa = opt("U15A", "\"less than $0.001\"", spoken("You pay nothing. The sponsor covers less than $0.001."), [
        "The spoken sentence says the bound in words when the fee is under a tenth of a cent.",
    ], rec=True)
    sb = opt("U15B", "The template as written", spoken("You pay nothing. The sponsor covers about &lt;$0.001."), [
        "The decided sentence with the price dropped in; most screen readers say \"about less than $0.001\".",
    ])

    def handadded(meta: str, line: str, said: str) -> str:
        card = (
            '<div class="n-fee"><div class="n-fee-card"><div class="n-fee-top"><span class="n-fee-label">Fee</span></div>'
            '<div class="n-fee-trigger"><span class="n-fee-value">Dev sponsor</span><span class="ms">expand_more</span></div></div>'
            f'<div class="n-fee-row"><span class="n-fee-label">You pay</span><span class="n-fee-mono">{line}</span></div></div>'
        )
        rows = [("Public Fee Juice", "1.2 FJ", ""), ("Private Fee Juice", "0.42 FJ", ""), ("Sponsored", "free", ""), ("Dev sponsor", meta, " sel")]
        return (
            crop(menu(rows)) + cap("The menu, with a fee contract you added")
            + crop(card) + cap("The card with it picked")
            + f'<div class="srline">{said}</div>' + cap("What a screen reader says")
        )

    ha = opt("U16A", "A dash for a fee contract added by hand", handadded(
        "—", "—", "Nulo can't tell what this fee contract charges you."), [
        "\"free\" and \"Nothing\" stay for the sponsor Nulo ships with. A contract you added by hand still pays the network fee, but Nulo can't vouch for what else it does: it could collect tokens the account already allowed it to take.",
        "The dash says \"Nulo can't tell\", as it does in the send strip.",
    ], rec=True)
    hb = opt("U16B", "The same as the built-in sponsor", handadded(
        "free", '<b style="font-weight:600">Nothing</b> <small><s>~3.577824 FJ ($0.215)</s></small>',
        "You pay nothing. The sponsor covers about $0.215."), [
        "Reads like the sponsor Nulo ships with; \"free\" then means only that the network fee is covered.",
    ])

    return block(
        "i3-r5",
        "V4 draws the fee line and the menu with every balance known and Nulo's own sponsor. Three states have no drawing: the menu before the balances arrive or when one couldn't be read, what a screen reader says when the sponsored fee is under a tenth of a cent, and a fee contract you added by hand.",
        [ua, ub, uc, sa, sb, ha, hb],
        [
            pick("i3d", "U14 · menu, balance unknown", "A|B|C|Other"),
            pick("i3e", "U15 · spoken, under $0.001", "A|B|Other"),
            pick("i3f", "U16 · fee contract added by hand", "A|B|Other"),
        ],
        "My picks: A, A and A",
        "Each reuses what the card already says elsewhere: the dash is how the Available row shows a balance it doesn't know, and how the send strip says Nulo can't tell; an unreadable private balance gets the public row's words; a screen reader hears the bound, not a symbol. \"free\" stays a promise only where Nulo can keep it.",
    )


# ---------- item 6 · round-5 addendum: the permission window's undrawn states ----------
# Wallet strings are batch 5's quoted strings (its asks A-1…A-32) or, where an ask keeps "today's",
# the product source at the line cited beside each constant. Nothing here is new copy.

# Today's capabilities window, which the arc 5a interim keeps (A-1).
T_ACTION = "is requesting permissions on {}"  # apps/extension/src/popup/windows/capabilities/index.vue:336
T_SELECT = "Select accounts to share"  # capabilities/index.vue:363
T_ADD = "Add accounts to share"  # capabilities/index.vue:363
T_NEW = "New permissions requested"  # capabilities/index.vue:383
T_HELD = "Already granted"  # capabilities/index.vue:407
T_APPROVE = "Approve"  # capabilities/index.vue:436
T_ALIAS = "Alias"  # capabilities/AccountSelectRow.vue:81
T_UNREC = "unrecognized"  # capabilities/CapabilityCard.vue:102
T_DENIED = "previously denied"  # capabilities/CapabilityCard.vue:105
T_RISK = {"high": "▲ HIGH", "medium": "● MED", "low": "— LOW"}  # CapabilityCard.vue:57-66
# (label, description, risk) from apps/extension/src/wallet/services/dapp-session/capability-meta.ts.
T_ACCOUNTS = ("Account access", "Read your account addresses and register tokens. May also request auth witnesses for shared accounts.", "medium")  # :51-54
T_CONTRACTS = ("Contract registration", "Register contracts, read their metadata, and check whether listed tokens are registered in your wallet.", "low")  # :57-60
T_SIM = ("Transaction simulation", "Run simulations locally. Nothing is sent to the network.", "medium")  # :69-72
T_TX = ("Send transactions", "Request transactions within the scope below. Each transaction still requires your approval.", "high")  # :78-81
T_UNKNOWN = ("Unknown permission", "This wallet doesn't recognize this permission. Reject if you don't know what it does.", "high")  # :210-212, risk :104
T_RIDER_RISK = "high"  # capability-meta.ts:46, kept by the card that replaces the rider
T_DATA_RISK = "high"  # capability-meta.ts:87, kept by both data cards
T_CHAIN = "Aztec:{}"  # apps/extension/src/components/ui/utils.ts:42, the fallback for a chain with no name
T_PICK_ONE = "Select at least one account"  # capabilities/index.vue:258

# The row list's words (u4 above), as A-1 and A-16 quote them; plain text where arc 5a has no dotted term.
AUTH_T = "Act for you in transactions you approve"
AUTH_ON = "Nulo signs its authorizations without asking."
AUTH_OFF = "You confirm each authorization first."
BROAD_ON = "For any call, on any contract."  # gen_i6r4.py:91
BROAD_OFF = "You confirm each authorization first. Off because it listed any contract."  # gen_i6r4.py:92
B_BROAD_OFF = f"You confirm each {term('authorization')} first. Off because it listed any contract."
BOOK_T, BOOK_ON = "See your address book", "Every name and address you saved."
DATA_OFF = "Not shared. The app may ask again later."
EV_T, EV_ANY_T = "See private events from its contracts", "See private events from any contract"
EV_ON = "Private messages its contracts sent to your accounts, like a transfer you received."
UNK_S = "Nulo can't tell you what it allows."
ANY = "Any contract"
MORE = "wants more permissions on {}"
UNDECIDED = "[string not decided]"


def sw(on: bool, sub_on: str, sub_off: str, label: str) -> dict:
    return {"on": on, "html": True, "sub_on": sub_on, "sub_off": sub_off, "label": label}


BOOK_SW = sw(True, BOOK_ON, DATA_OFF, "Share address book")
BOOK_ROW = row("contacts", BOOK_T, switch=BOOK_SW)
EV_ROW = row("mail_lock", EV_T, switch=sw(True, EV_ON, DATA_OFF, "Share private events"))
AUTH_BROAD = row("signature", AUTH_T, flagged=True, switch=sw(False, BROAD_ON, B_BROAD_OFF, "Authorizations without asking"))
ADDR_ROW = row("visibility", "See Account 1's address")
ADDRS_ROW = row("visibility", "See the addresses of the accounts you share")
ADD_ROW = row("add_circle", "Add contracts to your wallet")
ADD_ANY = "Add any contract to your wallet"
SIM_ANY = row("play_circle", "Run simulations on any contract", "Results can include your private balances.", flagged=True, flag=ANY)
TX_ANY = row("task_alt", "Every transaction, on any contract")
# Rows the fold shows read-only: no switch, the line of the stored state (A-12).
AUTH_HELD = row("signature", AUTH_T, B_ON)
BOOK_HELD = row("contacts", BOOK_T, BOOK_ON)
EV_HELD = row("mail_lock", EV_T, EV_ON)
# "previously denied" on the title line (A-4); CapabilityCard.vue:97 wraps it 6px from the title.
DENIED = f'<span class="n-flag quiet">{T_DENIED}</span>'


def denied(title: str) -> str:
    return f'<span class="n-tline"><span>{title}</span>{DENIED}</span>'
ERR_SNACK = (
    '<div class="n-toast-wrap" style="bottom:16px"><div class="n-snack err" role="alert" style="position:relative">'
    '<svg class="ic c-red"><use href="#i-close-circle"/></svg><div class="n-snack-text"><span class="n-snack-title">Couldn\'t save this setting</span></div>'
    '<span class="n-snack-x" role="button" aria-label="Close"><span class="ms">close</span></span></div></div>'
)


def ev_any(title: str = EV_ANY_T, flagged: bool = True) -> str:
    return row("mail_lock", title, flagged=flagged, flag=ANY, switch=sw(False, EV_ON, DATA_OFF, "Share private events"))


def unk_row(n: int, flagged: bool = False) -> str:
    word = "permission" if n == 1 else "permissions"
    return row("help", f"Use {n} {word} Nulo doesn't recognize", flagged=flagged, switch=sw(False, UNK_S, UNK_S, "Unknown permission"))


def sec(inner: str) -> str:
    return f'<div class="n-sections" style="padding:0">{inner}</div>'


def srline(text: str, sid: str | None = None) -> str:
    return f'<div class="srline"{fit_id(sid)}>{text}</div>'


def allowed(n: int, groups: list[str] | None = None) -> str:
    """U1's "Already allowed" fold, closed, or opened on the groups it holds (A-12)."""
    head = f'<span>Already allowed <span class="n-tag-quiet">· {n}</span></span><span class="ms">chevron_right</span>'
    if groups is None:
        return f'<div class="n-details" role="button" tabindex="0" aria-expanded="false">{head}</div>'
    return f'<div><div class="n-details" role="button" tabindex="0" aria-expanded="true">{head}</div><div class="n-detail-panel">{"".join(groups)}</div></div>'


def held_groups(extra_allow: tuple[str, ...] = ()) -> list[str]:
    """The five rows the tools app holds (U1A's "· 5"), in their groups."""
    return [
        group("Without asking, it can", [ADDR_ROW, SIM_ROW, ADD_ROW]),
        group("If you allow, it can", [AUTH_HELD, *extra_allow]),
        group("Always asks you first", [TX_ROW]),
    ]


def more(sections: list[str], fid: str, strip_net: str = "Testnet") -> str:
    return window(strip_net, "tools.nulo.sh", "nulo-tools", MORE.format("Testnet"), sections, "Allow", fid=fid)


def dt(known: list[tuple], unknown: list[tuple], anyc: tuple | None = None, open_row: str | None = None) -> str:
    """A static Details table in gen_i6.table's markup; rows are (label, simulate fns, add, transact fns)."""
    out = [
        '<div class="n-dt">',
        '<div class="n-dt-head" aria-hidden="true"><span>Contract</span><span>Simulate</span><span>Add</span><span>Transact</span><span></span></div>',
    ]

    def emit(label: str, named: bool, sim: list[str], add: bool, tx: list[str]) -> None:
        is_open = label == open_row
        name = f'<span class="n-dt-name">{label}</span>' if named else f'<span class="n-dt-addr">{label}<span class="ms" aria-hidden="true">content_copy</span></span>'
        out.append(
            f'<div class="n-dt-row" aria-expanded="{str(is_open).lower()}">{name}{mark(bool(sim), "check")}{mark(add, "check")}{mark(bool(tx), "check")}'
            '<span class="ms chev" aria-hidden="true">chevron_right</span></div>'
        )
        fns = "".join(f'<div class="n-dt-fn"><b>{k}</b><span>{" · ".join(v)}</span></div>' for k, v in (("Simulate", sim), ("Transact", tx)) if v)
        out.append(f'<div class="n-dt-fns"{"" if is_open else " hidden"}>{fns}</div>')

    if known:
        out.append('<div class="n-dt-sub">Nulo knows</div>')
        for r in known:
            emit(r[0], True, *r[1:])
    if unknown:
        out.append('<div class="n-dt-sub">Nulo doesn\'t know</div>')
        for r in unknown:
            emit(r[0], False, *r[1:])
    if anyc:
        emit(ANY, True, *anyc)
    out.append('<div class="n-dt-foot">Function names come from the app. Anything it didn\'t list is refused instantly; you won\'t be asked.</div></div>')
    return "".join(out)


def dt_open(label: str, table_html: str) -> str:
    return (
        f'<div class="n-details" aria-expanded="true"><span>Details <span class="n-tag-quiet">· {label}</span></span><span class="ms">chevron_right</span></div>'
        f'<div class="n-detail-panel">{table_html}</div>'
    )


def settings(groups_html: str, grants: list[str]) -> str:
    """U7A's Settings → Connected apps → app page."""
    g = "".join(
        f'<div class="n-grant"><span class="l"><svg class="ic"><use href="#i-check-circle"/></svg>{x}</span><svg class="ic"><use href="#i-chevron"/></svg></div>'
        for x in grants
    )
    return (
        '<div class="n-subhdr"><span class="ms">arrow_back</span><span class="n-subhdr-title">Connected App</span></div>'
        f'<div class="n-sections" style="padding:16px 0 0">{groups_html}'
        f'<div class="n-group"><div class="n-seclabel">Granted permissions<span class="count">{len(grants)}</span></div><div class="n-grants">{g}</div></div></div>'
    )


# Today's CapabilityCard.vue: `tick` True/False is the check-circle/circle glyph (:91-92), None no tick.
def card(label: str, desc: str, risk: str | None = None, tick: bool | None = None, badges: tuple[str, ...] = (), granted: bool = False, mono: bool = False) -> str:
    if granted:
        lead = '<svg class="ic c-tertiary"><use href="#i-check-circle"/></svg>'
    elif tick is None:
        lead = ""
    else:
        lead = f'<svg class="ic {"c-primary" if tick else "c-secondary"}"><use href="#i-{"check-circle" if tick else "circle"}"/></svg>'
    tags = "".join(f'<span class="n-tag-warn">{b}</span>' for b in badges)
    labels = f'<span class="n-cap-labels"><span class="n-cap-label{" mono" if mono else ""}">{label}</span>{tags}</span>'
    right = ("" if granted or not risk else f'<span class="n-risk">{T_RISK[risk]}</span>') + '<svg class="ic n-chev"><use href="#i-chevron"/></svg>'
    return (
        f'<div class="n-cap{" granted" if granted else ""}"><div class="n-cap-head">{lead}<div class="n-cap-body"><div class="n-cap-line">'
        f'{labels}<span class="n-cap-right">{right}</span></div><span class="n-cap-desc">{desc}</span></div></div></div>'
    )


def cards(label: str, items: list[str]) -> str:
    return f'<div class="n-group"><div class="n-seclabel">{label}<span class="count">{len(items)}</span></div><div class="n-caps">{"".join(items)}</div></div>'


def today_account(name: str, chip: str, addr: str, selected: bool = True, alias: str | None = None) -> str:
    """Today's AccountSelectRow.vue: the Alias field shows on a selected row the app doesn't hold yet."""
    lead = '<svg class="ic c-primary"><use href="#i-check-circle"/></svg>' if selected else '<svg class="ic c-secondary"><use href="#i-circle"/></svg>'
    field = (
        f'<div class="n-alias"><span class="n-alias-label">{T_ALIAS} <svg class="ic"><use href="#i-info"/></svg></span><div class="n-alias-input">{alias}</div></div>'
        if alias is not None
        else ""
    )
    return (
        f'<div class="n-arow"><div class="n-arow-top">{lead}<div class="n-arow-text"><div class="n-arow-line"><span class="n-arow-name">{name}</span>'
        f'<span class="n-chain">{chip}</span></div><span class="n-arow-addr">{addr}</span></div></div>{field}</div>'
    )


def today_window(sections: list[str], fid: str) -> str:
    return window("Testnet", "tools.nulo.sh", "nulo-tools", T_ACTION.format("Testnet"), sections, T_APPROVE, fid=fid)


def plain_card(t: tuple[str, str, str]) -> str:
    return card(t[0], t[1], t[2])


def held_card(t: tuple[str, ...]) -> str:
    return card(t[0], t[1], granted=True)


def a1() -> str:
    auth = card(AUTH_T, AUTH_ON, T_RIDER_RISK, tick=True)
    win = today_window([
        accounts_group(T_SELECT, [today_account("Account 1", "TESTNET", "0x1dd7...d930", alias="Account 1")], 1),
        cards(T_NEW, [auth, plain_card(T_CONTRACTS), plain_card(T_SIM), plain_card(T_TX)]),
    ], "i6a1-window")

    def one(inner: str, fid: str) -> str:
        return crop(f'<div class="n-caps">{inner}</div>', fid=fid)

    stage = (
        win + cap("Arc 5a, first connect · today's window, a tick only on the authorizations card")
        + one(card(AUTH_T, AUTH_OFF, T_RIDER_RISK, tick=False), "i6a1-auth-off") + cap("Authorizations, switched off")
        + one(card(AUTH_T, BROAD_OFF, T_RIDER_RISK, tick=False), "i6a1-auth-broad") + cap("A broad request: starts off")
        + one(card(AUTH_T, BROAD_ON, T_RIDER_RISK, tick=True), "i6a1-auth-broad-on") + cap("A broad request, switched on")
        + one(card(BOOK_T, BOOK_ON, T_DATA_RISK, tick=True) + card(EV_T, EV_ON, T_DATA_RISK, tick=True), "i6a1-data") + cap("<code>data</code> as two cards")
        + one(card(BOOK_T, DATA_OFF, T_DATA_RISK, tick=False) + card(EV_ANY_T, DATA_OFF, T_DATA_RISK, tick=False), "i6a1-data-off")
        + cap("Both off · private events from any contract start off")
        + one(card(*T_UNKNOWN[:2], T_UNKNOWN[2], tick=False, badges=(T_UNREC,), mono=True), "i6a1-unknown") + cap("Unknown: today's card, unchanged")
    )
    oa = opt("A1", "Arc 5a: today's window, four switches", stage, [
        "Today's window and cards. Only four cards keep a tick: authorizations, address book, private events and unknown. Each tick becomes a switch you can reach with Tab and flip with Enter or Space, named \"Authorizations without asking\", \"Share address book\", \"Share private events\" and \"Unknown permission\". The glyph stays.",
        "The \"Act on your behalf\" card becomes the authorizations card, in the row list's words. \"Authorization\" stays plain text until arc 5b.",
        "<code>data</code> becomes two cards. Each card's chevron opens only its half of the permission (not drawn open).",
        "Every other card keeps its title, description, risk tag and detail panel, and loses its tick: Connect grants it as requested.",
        "Risk tags stay as today: ▲ HIGH on the authorizations card (the old card's) and on both data cards (Private data's).",
        "The action, section titles, banner and footer don't change.",
        "Alternatives: round 3's groups land in arc 5a already (shot 06-window-S1), or arcs 5a and 5b merge so no interim window ships.",
    ], rec=True)
    held = [held_card(T_ACCOUNTS), held_card(T_CONTRACTS), held_card(T_SIM), held_card(T_TX)]
    asked = cards(T_NEW, [card(EV_ANY_T, DATA_OFF, T_DATA_RISK, tick=False, badges=(T_DENIED,))])
    ob = opt("A1H", "Arc 5a, asking again: the held half shows", today_window([asked, cards(T_HELD, [*held, card(BOOK_T, BOOK_ON, granted=True)])], "i6a1-held")
             + cap("It holds the address book and private events from one contract; you declined any contract; it asks again"), [
        "Already granted takes its data cards from what the app holds: one card for each part it holds and isn't asking for anew. Here that's the address book.",
        "The declined permission drops out of the list today's window reads, so without this the address book would show nowhere until arc 5b.",
    ], rec=True)
    oc = opt("A1T", "Today's source: the held half hidden", today_window([asked, cards(T_HELD, held)], "i6a1-held-hidden") + cap("Same request"), [
        "Already granted as today. The address book the app still holds shows nowhere in arc 5a.",
    ])
    return block(
        "i6-a1",
        "Arc 5a changes what Off means before arc 5b redraws the window, and the two PRs may land one at a time. So 5a ships today's window, changed only where the new behaviour forces it.",
        [oa, ob, oc],
        [pick("i6a1", "A-1 · arc 5a interim window", "As drawn|Held half hidden|Groups in 5a|5a with 5b|Other")],
        "My pick: the interim as drawn, with the held half shown",
        "Every new word comes from the row list you already have, so arc 5b only moves them into groups. After a declined widening the app still holds the address book, and the window should say so.",
        tag="Round 5 · A-1",
    )


def a2() -> str:
    inner = group("Without asking, it can", [ADDR_ROW, ADD_ROW]) + group("Always asks you first", [row("signature", AUTH_T, B_OFF)])
    o = opt("A2", "Authorizations with nothing to sign without asking", crop(sec(inner), fid="i6a2-rows") + cap("It asks for authorizations and lists no transactions or simulations"), [
        "Nulo signs without asking only for a call inside the app's listed transactions or simulations. With none listed, every authorization opens the confirmation window, whatever a switch says.",
        "So the row has no switch and sits with what always asks, with round 4's off line.",
    ], rec=True)
    return block(
        "i6-a2",
        "An app can ask for authorizations without listing a transaction or a simulation. Then nothing is ever signed without asking.",
        [o],
        [pick("i6a2", "A-2 · nothing to sign silently", "As drawn|Other")],
        "My pick: as drawn",
        "A switch that changes nothing would promise something the wallet can't do. The row says what happens instead.",
        tag="Round 5 · A-2",
    )


def a4() -> str:
    denied_book = row("contacts", denied(BOOK_T), switch=BOOK_SW)
    win = more([group("If you allow, it can", [denied_book]), allowed(5), details("12 contracts")], "i6a4-row")
    data = crop(group("If you allow, it can", [ev_any(denied(EV_ANY_T))]), fid="i6a4-data")
    oa = opt("A4", "Keep \"previously denied\", quietly", win + cap("You declined the address book once; the app asks again")
             + data + cap("A data re-request: only the new row carries it; the address book it holds folds without it (A-32)"), [
        "Today's badge stays on the row's title line, in the style of the \"Any contract\" chip without its icon, and grey: a fact, not a warning.",
        "It marks a row you declined before that the app asks for again.",
    ], rec=True)
    ob = opt("A4X", "Drop it", more([group("If you allow, it can", [BOOK_ROW]), allowed(5), details("12 contracts")], "i6a4-dropped") + cap("Same request"), [
        "The row reads like a first request.",
    ])
    return block(
        "i6-a4",
        "Today's window marks a permission you declined before with \"previously denied\". No round drew it in the new window.",
        [oa, ob],
        [pick("i6a4", "A-4 · previously denied", "As drawn|Drop it|Other")],
        "My pick: keep it, quietly",
        "It answers \"didn't I say no to this?\" without raising an alarm.",
        tag="Round 5 · A-4",
    )


def a5() -> str:
    broad = more([group("Without asking, it can", [SIM_ANY]), group("If you allow, it can", [AUTH_BROAD]), group("Always asks you first", [TX_ANY]), allowed(5), details("any contract")], "i6a5-broad")
    listed = more([group("Without asking, it can", [SIM_ROW]), group("Always asks you first", [TX_ROW]), allowed(5), details("14 contracts")], "i6a5-listed")
    surfaced = more([group("Without asking, it can", [SIM_ROW]), group("If you allow, it can", [AUTH_ROW]), group("Always asks you first", [TX_ROW]), allowed(5), details("14 contracts")], "i6a5-surfaced")
    oa = opt("A5", "Ask again only when it widens to any contract", broad + cap("Authorizations on; the app now asks for any contract")
             + listed + cap("Authorizations on; the app lists two more contracts"), [
        "Widened to any contract: your On stops signing without asking. The authorizations row comes back among the new rows, flagged and off, with the broad request's line.",
        "Widened to more listed contracts or functions: you allow the new list here and your On carries over to it, so the row stays folded, as U1A draws it.",
    ], rec=True)
    ob = opt("A5B", "Show the row on every widening", surfaced + cap("Two more contracts, the row among the new ones"), [
        "Whenever its transactions or simulations widen, the row comes back among the new rows with its current line and switch.",
        "More to read on each widening, for a choice that hasn't changed.",
    ])
    return block(
        "i6-a5",
        "A connected app with authorizations on can later ask for more. What happens to your On depends on how far it widens.",
        [oa, ob],
        [pick("i6a5", "A-5 · widening later", "As drawn|Row on every widening|Other")],
        "My pick: ask again only for any contract",
        "That's the case the default already treats differently. A longer list is one you allow in this window, so your On goes with it.",
        tag="Round 5 · A-5",
    )


def a6() -> str:
    broad = crop(group("If you allow, it can", [AUTH_BROAD, row("contacts", BOOK_T, flagged=True, switch=BOOK_SW), unk_row(1, flagged=True)]), fid="i6a6-broad")
    listed = crop(group("If you allow, it can", [AUTH_ROW, BOOK_ROW, unk_row(1)]), fid="i6a6-listed")
    never = crop(group("If you allow, it can", [AUTH_BROAD, BOOK_ROW, unk_row(1)]), fid="i6a6-never")
    oa = opt("A6", "Flagged in a broad request only", broad + cap("A broad request (S3)") + listed + cap("A listed request"), [
        "S3 flags both rows. The spec says only the authorizations row changes in S3, so both keep S3's flag there.",
        "In a request that lists its contracts, neither is flagged, as U1A and the row list draw them.",
    ], rec=True)
    ob = opt("A6N", "Never flagged", never + cap("A broad request"), [
        "As the later drawings: only the authorizations row and the \"Any contract\" rows turn orange.",
    ])
    return block(
        "i6-a6",
        "The broad request (S3) flags the address book and the unknown permission. The later drawings don't.",
        [oa, ob],
        [pick("i6a6", "A-6 · flags on two rows", "As drawn|Never flagged|Other")],
        "My pick: as S3 drew it",
        "S3 was picked as drawn, and the spec says nothing else in it changes.",
        tag="Round 5 · A-6",
    )


def a7() -> str:
    broad = crop(dt_open("any contract", dt([], [], (["Any function"], False, ["Any function"]), open_row=ANY)), fid="i6a7-broad")
    mixed = crop(dt_open("any contract", dt([], [("0x0c1e…5a7f", [], False, ["claim_public", "claim_private"])], (["Any function"], False, []), open_row=ANY)), fid="i6a7-mixed")
    o = opt("A7", "Details with an \"Any contract\" row", broad + cap("A broad request (S3), Details open") + mixed + cap("One listed transaction contract, simulations on any contract"), [
        "Every scope stays as the app sent it. A listed contract is its own row; a scope that is \"any contract\" adds one row, \"Any contract\", marked in each column that scope feeds.",
        "The label reads \"any contract\" whenever that row exists, even beside listed contracts.",
        "An opened row lists the functions as sent: \"Any function\" when the scope takes every function (A-8).",
        "The plan doesn't say where the row sits; drawn last, under no sub-header.",
    ], rec=True)
    return block(
        "i6-a7",
        "S3 draws \"Details · any contract\" closed. Opened, and for a request that mixes listed contracts with any contract, it has no drawing.",
        [o],
        [pick("i6a7", "A-7 · Details, any contract", "As drawn|Other")],
        "My pick: as drawn",
        "Nothing is merged or hidden: each scope shows as sent, so the table is the request.",
        tag="Round 5 · A-7",
    )


def a8() -> str:
    t = dt([], [
        ("0x0024…6502", ["balance_of_private", "balance_of_public"], True, ["Any function"]),
        ("0x0c1e…5a7f", ["token_for", "portal_for"], True, ["claim_public", "claim_private"]),
    ], open_row="0x0024…6502")
    o = opt("A8", "\"Any function\"", crop(dt_open("2 contracts", t), fid="i6a8-fns") + cap("A contract listed with every function"), [
        "A listed contract whose function is \"*\" reads \"Any function\" when its row opens.",
    ], rec=True)
    return block(
        "i6-a8",
        "An app can list a contract with every function on it. The opened row has to say so.",
        [o],
        [pick("i6a8", "A-8 · every function", "As drawn|Other")],
        "My pick: as drawn",
        "Two plain words instead of a star.",
        tag="Round 5 · A-8",
    )


def a10() -> str:
    counts = crop(sec(group("If you allow, it can", [unk_row(2)]) + details("1 contract")), fid="i6a10-counts")
    fold = crop(allowed(5), fid="i6a10-fold")
    o = opt("A10", "Counts and plurals", counts + cap("Two unknown permissions, one contract") + fold + cap("Four permissions, five rows"), [
        "\"Details · 1 contract\", then \"· 2 contracts\" and up.",
        "Two unknown types are one row with one switch, \"Use 2 permissions Nulo doesn't recognize\": all on or all off.",
        "\"Already allowed · N\" counts rows. The tools app holds four permissions, and its accounts permission gives two rows (the address and authorizations), so it reads 5.",
    ], rec=True)
    return block(
        "i6-a10",
        "The drawings show one count each. The singulars, the plurals and what the fold counts are undrawn.",
        [o],
        [pick("i6a10", "A-10 · counts and plurals", "As drawn|Other")],
        "My pick: as drawn",
        "Counting rows matches what opens under the fold.",
        tag="Round 5 · A-10",
    )


def a11() -> str:
    a1_ = account_row("Account 1", "Testnet", "0x1dd7...d930")
    a2_off = account_row("Account 2", "Testnet", "0x8c02...41fa", selected=False, rename=False)
    a2_on = account_row("Account 2", "Testnet", "0x8c02...41fa")
    typing = account_row("Account 1", "Testnet", "0x1dd7...d930", alias="Trading")

    def state(rows: list[str], first: str, fid: str) -> str:
        return crop(sec(accounts_group("Accounts to share", rows, 2) + group("Without asking, it can", [first, SIM_ROW])), fid=fid)

    o = opt("A11", "The address row follows the selection", state([a1_, a2_off], ADDR_ROW, "i6a11-one") + cap("One shared: its name in the wallet")
            + state([typing, a2_off], ADDR_ROW, "i6a11-typing") + cap("Renaming it for this app: still the wallet's name")
            + state([a1_, a2_on], ADDRS_ROW, "i6a11-two") + cap("Two shared: U2's sentence"), [
        "The row names the one shared account by its name in the wallet, never the name being typed for this app.",
        "Share a second and it reads U2's sentence; unshare one and it names the other. It changes with every click.",
    ], rec=True)
    return block(
        "i6-a11",
        "One shared account and several are drawn. Switching between them, and renaming, are not.",
        [o],
        [pick("i6a11", "A-11 · whose address", "As drawn|Other")],
        "My pick: as drawn",
        "The row says what the app will see, the address. The name you type for this app shouldn't rewrite the sentence as you type it.",
        tag="Round 5 · A-11",
    )


def a12() -> str:
    win = more([group("If you allow, it can", [BOOK_ROW]), allowed(5, held_groups()), details("12 contracts")], "i6a12-open")
    o = opt("A12", "The fold opened: what it holds, read-only", win + cap("The tools app asks for the address book; the fold opened"), [
        "Opened, the fold shows everything the app holds, in the same three groups, read-only: no switches, and each switch row shows the line of its current state.",
        "It includes a grant whose later widening you declined (A-30), and the authorizations row when the app only adds accounts (A-31).",
        "Opening it changes nothing.",
        "A disabled switch would draw a lock that no round has drawn, so the fold has none.",
    ], rec=True)
    return block(
        "i6-a12",
        "U1A draws \"Already allowed · 5\" closed. Opened, it has no drawing.",
        [o],
        [pick("i6a12", "A-12 · the fold opened", "As drawn|Other")],
        "My pick: as drawn",
        "What the app has reads the way it did when you allowed it, and nothing in it can be changed by accident.",
        tag="Round 5 · A-12",
    )


def a13() -> str:
    win = window("Mainnet", "tools.nulo.sh", "nulo-tools", MORE.format("Testnet"), [
        banner("Connecting on Testnet", "Your wallet is on Mainnet. Allow as is, or switch to see Testnet balances.", "Switch wallet to Testnet"),
        group("If you allow, it can", [BOOK_ROW]),
        allowed(5),
        details("12 contracts"),
    ], "Allow", fid="i6a13-banner")
    o = opt("A13", "\"Allow as is\"", win + cap("Asking for more while the wallet is on another network"), [
        "The banner's sentence names the footer's button: \"Allow as is\" when it reads \"Allow\". The banner's button stays \"Switch wallet to Testnet\", and its title stays today's.",
        "Keeping \"Connect as is\" here would point at a button the window doesn't have.",
    ], rec=True)
    return block(
        "i6-a13",
        "U3 draws the banner on a first connect, where the button reads \"Connect\". Asking for more, it reads \"Allow\".",
        [o],
        [pick("i6a13", "A-13 · banner when asking for more", "As drawn|Keep Connect as is|Other")],
        "My pick: as drawn",
        "The sentence names the button you can press.",
        tag="Round 5 · A-13",
    )


def a14() -> str:
    def ident(action: str, fid: str) -> str:
        return crop(dapp("tools.nulo.sh", "nulo-tools", "X").replace("wants to connect on X", action), pad="0", fid=fid)

    o = opt("A14", "Unknown chain", ident("wants to connect on " + T_CHAIN.format(1337), "i6a14-id") + cap("A chain Nulo has no name for: today's fallback name")
            + ident("wants to connect on this network", "i6a14-none") + cap("No name resolves at all")
            + ident(UNDECIDED, "i6a14-more") + cap("Asking for more, no name: no words in the plan"), [
        "Today's fallback stays: a chain Nulo has no name for reads \"Aztec:\" and its number.",
        "Where no name resolves at all, the action reads \"wants to connect on this network\".",
        "The plan gives no words for asking for more in that case; drawn as a placeholder.",
    ], rec=True)
    return block(
        "i6-a14",
        "The action names the network. Sometimes Nulo has no name for it.",
        [o],
        [pick("i6a14", "A-14 · unknown chain", "As drawn|Other")],
        "My pick: as drawn",
        "Today's fallback already names an unknown chain; \"this network\" covers the rest.",
        tag="Round 5 · A-14",
    )


def a15() -> str:
    broad = crop(settings(group("If you allow, it can", [AUTH_BROAD]), ["Account access", "Transaction simulation", "Send transactions", "Private data"]), fid="i6a15-broad")
    noscope = crop(settings(group("If you allow, it can", [row("signature", AUTH_T, B_OFF)]), ["Account access", "Contract registration"]), fid="i6a15-noscope")
    o = opt("A15", "Settings keeps the window's row", broad + cap("Settings → Connected apps → swap.example") + noscope + cap("An app with nothing to sign without asking (A-2)"), [
        "A broad app's row keeps its flag and the broad request's lines, and stays a switch: you can turn it on knowingly, which records an On for any contract.",
        "An app without authorizations has no row.",
        "An app with authorizations but no listed transactions or simulations gets the row without a switch and with the off line, as in the window (A-2). Drawn under U7A's group; the window puts that row under \"Always asks you first\", which Settings could follow instead.",
    ], rec=True)
    return block(
        "i6-a15",
        "U7A draws the switch for the tools app. A broad app, and one with nothing to sign without asking, are undrawn.",
        [o],
        [pick("i6a15", "A-15 · Settings for a broad app", "As drawn|Other")],
        "My pick: as drawn",
        "Settings says what the window said, so changing your mind reads the same as deciding.",
        tag="Round 5 · A-15",
    )


def a17() -> str:
    inner = group("Without asking, it can", [row("add_circle", ADD_ANY, flagged=True, flag=ANY), row("info", "See details of contracts in your wallet")]) + group("If you allow, it can", [ev_any()])
    o = opt("A17", "Icons for three new rows", crop(sec(inner), fid="i6a17-icons") + cap("Adding any contract, contract details, private events from any contract"), [
        "<code>add_circle</code> for adding any contract, as its listed sibling has; <code>info</code> for contract details; <code>mail_lock</code> for private events from any contract, as its listed sibling has.",
        "All three are in the icon font the wallet ships.",
    ], rec=True)
    return block(
        "i6-a17",
        "U4 draws two icons. Three of the row list's new rows have none.",
        [o],
        [pick("i6a17", "A-17 · icons for new rows", "As drawn|Other")],
        "My pick: as drawn",
        "Each reuses its listed sibling's icon where it has one.",
        tag="Round 5 · A-17",
    )


def a18() -> str:
    accts = [account_row("Account 1", "Testnet", "0x1dd7...d930"), account_row("Account 2", "Testnet", "0x8c02...41fa")]
    c = crop(sec(accounts_group("Accounts to share", accts, 2) + group("If you allow, it can", [AUTH_ROW])), fid="i6a18-terms")
    o = opt("A18", "One rename link per shared account", c + cap("Two shared accounts: three dotted words, two terms"), [
        "The tooltip map allows two dotted terms per screen. U2 draws one \"Rename for this app\" per shared account, so two accounts and \"authorizations\" make three dotted words.",
        "Built as drawn, reading the rule as two different terms.",
        "If the rule means two dotted words, some of these lose their dots; that version isn't drawn.",
    ], rec=True)
    return block(
        "i6-a18",
        "The tooltip map's rule and U2's drawing disagree once two accounts are shared.",
        [o],
        [pick("i6a18", "A-18 · dotted-term count", "Two distinct terms|Two per screen|Other")],
        "My pick: two different terms",
        "Every rename link is the same word with the same tooltip; a second one teaches nothing new.",
        tag="Round 5 · A-18",
    )


def a23() -> str:
    tab = crop(dt_open("12 contracts", table("i6a23", None, False, "check")), fid="i6a23-tab")
    path = srline("Tab: Details → Fee Juice → Sponsored fee payer → Private fee payer → Auth registry → 0x0c1e…5a7f → 0x0024…6502 → … → 0x14e0…d592<br>The copy buttons are not on the path.")
    path_alt = srline("Tab: Details → Fee Juice → … → Auth registry → 0x0c1e…5a7f → Copy address → 0x0024…6502 → Copy address → … → 0x14e0…d592 → Copy address")
    oa = opt("A23", "Copy buttons off the Tab path", tab + cap("Details open") + path + cap("The Tab path"), [
        "The copy glyph in an address is its own small button beside the row, named \"Copy address\", and out of the Tab path: a pointer or a screen reader reaches it, Tab doesn't.",
        "Pressing it never opens the row. It copies the address and shows batch 4's snackbar, \"Address is copied\".",
        "It's the rule CLAUDE.md sets for an inline copy, and what the drawing shows.",
    ], rec=True)
    ob = opt("A23T", "A Tab stop after each address", path_alt + cap("The Tab path"), [
        "As copy buttons are elsewhere in batch 4. Eight more stops in the tools app's table.",
    ])
    return block(
        "i6-a23",
        "The copy glyph in Details has no drawn behaviour: whether Tab stops on it, and what pressing it does.",
        [oa, ob],
        [pick("i6a23", "A-23 · copy in Details", "As drawn|Tab stop|Other")],
        "My pick: off the Tab path",
        "Tab walks the table row by row, as you read it; copying stays one click away.",
        tag="Round 5 · A-23",
    )


def a24() -> str:
    win = window("Testnet", "tools.nulo.sh", "nulo-tools", "wants to connect on Testnet", [
        account("Testnet"),
        group("Without asking, it can", [ADDR_ROW, SIM_ANY]),
        group("If you allow, it can", [AUTH_ROW]),
        group("Always asks you first", [TX_ROW]),
        details("any contract"),
    ], "Connect", fid="i6a24-util")
    o = opt("A24", "Utilities on any contract", win + cap("Listed transactions and simulated transactions, utilities on any contract"), [
        "Either kind of simulation on any contract gives \"Run simulations on any contract\" with its chip.",
        "Authorizations still start on and unflagged: they follow transactions and simulated transactions only, since a utility never authorizes a call.",
    ], rec=True)
    return block(
        "i6-a24",
        "A simulation permission has two parts, transactions and utilities. S3 draws both on any contract; one alone is undrawn.",
        [o],
        [pick("i6a24", "A-24 · utilities on any contract", "As drawn|Other")],
        "My pick: as drawn",
        "The row says what can run anywhere; the switch keeps the default that its own reach calls for.",
        tag="Round 5 · A-24",
    )


def a25() -> str:
    rows = [
        account_row("Account 1", "Testnet", "0x1dd7...d930", selected=False, rename=False),
        account_row("Account 2", "Testnet", "0x8c02...41fa", selected=False, rename=False),
        account_row("Savings", "Testnet", "0x2b9e...07c4", selected=False, rename=False),
    ]
    c = crop(sec(accounts_group("Accounts to share", rows, 3) + group("Without asking, it can", [ADDRS_ROW, SIM_ROW])), fid="i6a25-none")
    o = opt("A25", "None selected yet", c + cap("Three accounts, none shared yet"), [
        "Nothing shared yet, so the row names no account: U2's sentence.",
        f"Connect with nothing selected keeps today's warning, \"{T_PICK_ONE}\".",
    ], rec=True)
    return block(
        "i6-a25",
        "With several accounts and none picked yet, the address row has nothing to name.",
        [o],
        [pick("i6a25", "A-25 · none selected", "As drawn|Other")],
        "My pick: as drawn",
        "The sentence is true before and after you pick.",
        tag="Round 5 · A-25",
    )


def a26() -> str:
    rows = [account_row("Account 1", "Shared", "0x1dd7...d930", rename=False), account_row("Account 2", "Testnet", "0x8c02...41fa")]
    o = opt("A26", "No rename link on a SHARED row", crop(sec(accounts_group("Accounts to share", rows, 2)), fid="i6a26-locked") + cap("The app already has Account 1"), [
        "An account the app already has reads SHARED and can't be unticked here. It gets no rename link, as today's rows hide the alias field on it.",
    ], rec=True)
    return block(
        "i6-a26",
        "An account the app already holds shows locked, marked SHARED. The new rename link isn't drawn for it.",
        [o],
        [pick("i6a26", "A-26 · SHARED rows", "As drawn|Other")],
        "My pick: as drawn",
        "Its name for this app was set when you first shared it; this window isn't asking about it.",
        tag="Round 5 · A-26",
    )


def a27() -> str:
    c = crop(dt_open("12 contracts", table("i6a27", None, False, "check")), fid="i6a27-spoken")
    spoken = srline(
        "Fee Juice: simulate, transact<br>Sponsored fee payer: simulate, transact<br>Private fee payer: simulate, add, transact<br>"
        f"Auth registry: simulate, transact<br>{UNDECIDED}: simulate, add, transact"
    )
    o = opt("A27", "Each row names itself", c + cap("Details open") + spoken + cap("What a screen reader says for each row"), [
        "The column heads are hidden from screen readers, as drawn, so each row's button carries its own name: what the contract is, then the columns it's in.",
        "For a contract Nulo doesn't know, the name is its address; which form of the address is read out isn't decided.",
    ], rec=True)
    return block(
        "i6-a27",
        "Details is a table you read by its column heads. A screen reader hears no heads, so each row needs a name.",
        [o],
        [pick("i6a27", "A-27 · spoken Details rows", "As drawn|Other")],
        "My pick: as drawn",
        "One sentence per row carries what the marks show.",
        tag="Round 5 · A-27",
    )


def a28() -> str:
    page = settings(group("If you allow, it can", [AUTH_ROW]), ["Account access", "Transaction simulation", "Contract registration", "Send transactions", "Private data"])
    o = opt("A28", "The switch goes back; an error says why", crop(page + ERR_SNACK, pad="16px 16px 84px", fid="i6a28-error") + cap("You switched it off and the save failed"), [
        "The switch returns to on, and the error snackbar stays until closed, as item 10 decided.",
        "Nothing changes until a save succeeds.",
    ], rec=True)
    return block(
        "i6-a28",
        "The Settings switch saves as you flip it. A failed save has no drawing.",
        [o],
        [pick("i6a28", "A-28 · failed Settings write", "As drawn|Other")],
        "My pick: as drawn",
        "The switch never shows a state Nulo didn't store.",
        tag="Round 5 · A-28",
    )


def a29() -> str:
    def rows(flagged: bool, fid: str) -> str:
        inner = group("Without asking, it can", [row("add_circle", ADD_ANY, flagged=flagged, flag=ANY)]) + group("If you allow, it can", [ev_any(flagged=flagged)])
        return crop(sec(inner), fid=fid)

    oa = opt("A29", "Flag and chip, like S3", rows(True, "i6a29-flag") + cap("The two new any-contract rows"), [
        "The row list marks both with the \"Any contract\" chip, as S3 marks its simulation row. S3 also turns that row's icon orange; these do the same.",
    ], rec=True)
    ob = opt("A29C", "The chip alone", rows(False, "i6a29-chip") + cap("Same rows"), [
        "The chip stays; the icon stays grey.",
    ])
    return block(
        "i6-a29",
        "The row list gives two new rows the \"Any contract\" chip. Whether their icons turn orange too isn't drawn.",
        [oa, ob],
        [pick("i6a29", "A-29 · two any-contract rows", "Flag and chip|Chip alone|Other")],
        "My pick: flag and chip",
        "One look for every any-contract row.",
        tag="Round 5 · A-29",
    )


def a30() -> str:
    win = more([group("If you allow, it can", [ev_any()]), allowed(7, held_groups((BOOK_HELD, EV_HELD))), details("12 contracts")], "i6a30-window")
    both = more([group("If you allow, it can", [BOOK_ROW, EV_ROW]), allowed(6), details("12 contracts")], "i6a30-both")
    o = opt("A30", "Off keeps what it held", win + cap("It holds the address book and private events from contract A, and asks for any contract")
            + both + cap("It holds private events from A, and asks for the address book and B too"), [
        "The new row keeps its drawn off line, \"Not shared. The app may ask again later.\", which is true of what it asked for.",
        "Off keeps what the app already had: the fold still lists both data rows, and the app is told it holds them.",
        "Each data row decides on its own: a row left off keeps what the app held for it, a row switched on takes what it asked for. The tables below list every case.",
        "Alternative: Off also takes back what it held. Every \"unchanged\" cell below would change, and the row would need a new line.",
    ], rec=True)

    def ledger(heads: list[str], rows: list[list[str]]) -> str:
        th = "".join(f"<th>{h}</th>" for h in heads)
        trs = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
        return f'<div class="scroll-x"><table class="ledger rowdict"><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table></div>'

    star = "<code>{ addressBook: true, privateEvents: { contracts: \"*\" } }</code>"
    t1 = ledger(["Request", "Address-book row", "Private-events row", "Stored after Allow"], [
        [star, "folded (held)", "new, Off", "unchanged (type rejected)"],
        ["same", "folded (held)", "new, On", star],
    ])
    t2 = ledger(["Address-book row", "Private-events row", "Stored after Allow"], [
        ["On", "Off", "<code>{ addressBook: true, privateEvents: { contracts: [A] } }</code>"],
        ["Off", "On", "<code>{ privateEvents: { contracts: [A, B] } }</code>"],
        ["Off", "Off", "unchanged (type rejected)"],
        ["On", "On", "<code>{ addressBook: true, privateEvents: { contracts: [A, B] } }</code>"],
    ])
    extra = (
        '<div id="i6a30-tables">'
        '<div class="rowdict-wrap"><h3>It holds the address book and private events from A</h3>'
        '<p class="conf">Held: <code>{ addressBook: true, privateEvents: { contracts: [A] } }</code></p>' + t1 + "</div>"
        '<div class="rowdict-wrap"><h3>It holds private events from A, both rows new</h3>'
        '<p class="conf">Held: <code>{ privateEvents: { contracts: [A] } }</code> · asked: <code>{ addressBook: true, privateEvents: { contracts: [A, B] } }</code></p>' + t2 + "</div>"
        "</div>"
    )
    return block(
        "i6-a30",
        "Declining a wider version of a permission keeps the older one, as today. No round drew what the window shows then.",
        [o],
        [pick("i6a30", "A-30 · declined widening", "As drawn|Off revokes|Other")],
        "My pick: as drawn",
        "Off answers the question asked. Taking back an earlier yes deserves its own question.",
        extra,
        tag="Round 5 · A-30",
    )


def a31() -> str:
    rows = [account_row("Account 1", "Shared", "0x1dd7...d930", rename=False), account_row("Account 2", "Testnet", "0x8c02...41fa")]
    accts = accounts_group("Accounts to share", rows, 2)
    win = more([accts, group("Without asking, it can", [ADDRS_ROW]), allowed(5), details("12 contracts")], "i6a31-window")
    interim = today_window([
        accounts_group(T_ADD, [today_account("Account 1", "SHARED", "0x1dd7...d930"), today_account("Account 2", "TESTNET", "0x8c02...41fa", alias="Account 2")], 2),
        cards(T_HELD, [card(AUTH_T, AUTH_ON, granted=True), held_card(T_CONTRACTS), held_card(T_SIM), held_card(T_TX)]),
    ], "i6a31-interim")
    oa = opt("A31", "Only the accounts are new", win + cap("The app has Account 1 and asks for another") + interim + cap("Arc 5a: today's window"), [
        "Only the accounts are new. The authorizations row folds into \"Already allowed\" with its current line, and your choice stays as it is.",
        "The label is U2's \"Accounts to share\" (\"Account to share\" with one row), with today's count of accounts on this network, on a widening too.",
        "Arc 5a keeps today's window here: \"Add accounts to share\", and the authorizations card under Already granted, with no switch.",
    ], rec=True)
    ob = opt("A31R", "The row with its switch", more([accts, group("Without asking, it can", [ADDRS_ROW]), group("If you allow, it can", [AUTH_ROW]), allowed(5), details("12 contracts")], "i6a31-switch") + cap("Same request"), [
        "The authorizations row among the new rows, with its switch, every time accounts are added.",
    ])
    oc = opt("A31L", "Keep \"Add accounts to share\"", crop(sec(accounts_group(T_ADD, rows, 2)), fid="i6a31-label") + cap("Same request, today's label"), [
        "Today's label whenever the app already holds accounts.",
    ])
    return block(
        "i6-a31",
        "Adding an account to an app that holds authorizations keeps the stored grant, as today. Its window and its accounts label are undrawn.",
        [oa, ob, oc],
        [pick("i6a31", "A-31 · adding accounts", "As drawn|Row with switch|Keep Add accounts label|Other")],
        "My pick: as drawn",
        "Adding an account isn't a new question about authorizations, so the window doesn't ask one.",
        tag="Round 5 · A-31",
    )


def a32() -> str:
    again = more([group("If you allow, it can", [ev_any(denied(EV_ANY_T))]), allowed(7), details("12 contracts")], "i6a32-again")
    none = srline("No window opens. The app asked for exactly what it holds, the address book and private events from contract A, and gets that answer.", "i6a32-none")
    today = more([group("If you allow, it can", [row("contacts", denied(BOOK_T), switch=BOOK_SW), ev_any(denied(EV_ANY_T))]), allowed(7), details("12 contracts")], "i6a32-today")
    oa = opt("A32", "Only what's new is asked, and badged", again + cap("The same request again, after you declined any contract") + none + cap("A request for exactly what it holds"), [
        "Only the new row carries \"previously denied\". The address book it holds folds, without the badge.",
        "A request the held grant already covers opens no window: the app is answered from what it holds. Today it reopens the window for the declined permission.",
        "Contract classes keep today's rule and open the window again: Nulo checks only that the app holds contract classes, not which ones.",
        "The declined answer stays stored, so a later widening is badged again.",
    ], rec=True)
    ob = opt("A32T", "Today's rule", today + cap("The same request again"), [
        "Every row of a declined permission is new and badged, and a covered request still opens a window, one whose groups would be empty.",
    ])
    return block(
        "i6-a32",
        "After you decline a wider data permission, the app can ask again. Two cases have no drawing: the same request, and one the held grant already covers.",
        [oa, ob],
        [pick("i6a32", "A-32 · asking again after declining", "As drawn|Today's rule|Other")],
        "My pick: as drawn",
        "The window asks only what's new, and a question you've already answered doesn't come back.",
        tag="Round 5 · A-32",
    )


def addendum() -> str:
    head = """<div class="r2 r3" id="i6-r5-add">
	<div class="r2-head"><span class="r2-tag">Round 5 addendum</span><span class="r2-said">The permission window's undrawn states. Batch 5 builds each of these and no round drew them, so each is drawn here with a pick. Without a pick, the drawn option is built and its PR lists it as "sign-off pending".</span></div>
</div>
"""
    asks = [a1, a2, a4, a5, a6, a7, a8, a10, a11, a12, a13, a14, a15, a17, a18, a23, a24, a25, a26, a27, a28, a29, a30, a31, a32]
    return head + "".join(a() for a in asks)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    (OUT / "i6.html").write_text(item6() + addendum())
    (OUT / "tips.html").write_text(tips())
    (OUT / "i5.html").write_text(item5())
    (OUT / "i8.html").write_text(item8())
    (OUT / "i3.html").write_text(item3())
    print("wrote src/r5/{i3,i5,i6,i8,tips}.html")


if __name__ == "__main__":
    main()
