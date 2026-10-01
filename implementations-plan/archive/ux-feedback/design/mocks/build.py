#!/usr/bin/env python3
"""Assemble the single-file proposal page: inline CSS/JS, base64 fonts, SVG icon sprite."""
import base64
import json
import re
import pathlib

HERE = pathlib.Path(__file__).parent
REPO = HERE.resolve().parents[3]
FONTS = REPO / "packages/design/src/fonts"
ICONS = REPO / "packages/design/src/internal/icons.json"


def b64(name: str) -> str:
    return base64.b64encode((FONTS / name).read_bytes()).decode()


def font_css() -> str:
    faces = [
        ("InterVariable", "100 900", "InterVariable.woff2", "swap"),
        ("Space Grotesk", "300 700", "SpaceGrotesk-latin.woff2", "swap"),
        ("Space Grotesk", "300 700", "SpaceGrotesk-latin-ext.woff2", "swap"),
        ("JetBrains Mono", "400 700", "JetBrainsMono-latin.woff2", "swap"),
        ("Material Symbols Outlined", "100 700", "MaterialSymbolsOutlined.woff2", "block"),
    ]
    out = []
    for family, weight, file, display in faces:
        out.append(
            f'@font-face{{font-family:"{family}";font-style:normal;font-weight:{weight};'
            f"font-display:{display};src:url(data:font/woff2;base64,{b64(file)}) format(\"woff2\")}}"
        )
    return "\n".join(out)


def sprite() -> str:
    icons = json.loads(ICONS.read_text())
    symbols = []
    for name, data in sorted(icons.items()):
        if isinstance(data, str):
            body = f'<path d="{data}"/>'
        else:
            parts = []
            for p in data:
                attrs = f'd="{p["path"]}"'
                if p.get("opacity") is not None:
                    attrs += f' opacity="{p["opacity"]}"'
                parts.append(f"<path {attrs}/>")
            body = "".join(parts)
        symbols.append(f'<symbol id="i-{name}" viewBox="0 0 24 24">{body}</symbol>')
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" '
        'style="position:absolute;width:0;height:0;overflow:hidden">' + "".join(symbols) + "</svg>"
    )


def fold(key: str, label: str, inner: str) -> str:
    toggle = (
        f'<button type="button" class="r1-toggle" data-toggle="{key}" aria-expanded="false">'
        f"{label}</button>"
    )
    return f'\n{toggle}\n<div class="r1" id="{key}" hidden>{inner}</div>'


R1_LABEL = "Round 1 <em>· facts, research, options and my pick</em>"
ROUND_LABEL = "Round {n} <em>· options and my pick</em>"
LATER = ("r5", "r4", "r3", "r2")
# The tooltip map's part body holds its round-2 content and its round-3 block.
BODY_LABEL = {"tips": "Rounds 2–3 <em>· options and my picks</em>"}


def rounds(part: str, src: pathlib.Path) -> str:
    """Put the item's latest block under its quote and fold every earlier round, newest first."""
    m = re.search(r'<section class="wrap item" id="([\w-]+)"', part)
    if not m:
        return part
    sid = m.group(1)
    present = [r for r in LATER if (src / r / f"{sid}.html").exists()]
    if not present:
        return part
    q = part.index("</blockquote>") + len("</blockquote>")
    end = part.rindex("</section>")
    head, body = part[:q], part[q:end]
    blocks = [(r, (src / r / f"{sid}.html").read_text()) for r in present]
    inner = "\n" + blocks[0][1]
    for r, html in blocks[1:]:
        inner += fold(f"{sid}-f{r[1]}", ROUND_LABEL.format(n=r[1]), html)
    if "r2" in present:
        inner += fold(f"{sid}-f1", R1_LABEL, body)
    else:
        # Items that were new in round 2 carry their round-2 content in the part body itself.
        inner += fold(f"{sid}-f2", BODY_LABEL.get(sid, ROUND_LABEL.format(n=2)), body)
    return head + inner + "\n</section>"


def main() -> None:
    src = HERE / "src"
    page = (src / "page.html").read_text()
    parts = "\n".join(rounds(p.read_text(), src) for p in sorted((src / "parts").glob("*.html")))
    page = page.replace("<!--@PARTS@-->", parts)
    page = page.replace("/*@PAGE_CSS@*/", (src / "page.css").read_text())
    page = page.replace("/*@NULO_CSS@*/", (src / "nulo.css").read_text())
    page = page.replace("/*@JS@*/", (src / "page.js").read_text())
    page = page.replace("<!--@SPRITE@-->", sprite())
    page = page.replace("/*@FONTS@*/", font_css())
    known = set(json.loads(ICONS.read_text()))
    missing = sorted({m for m in re.findall(r'href="#i-([\w-]+)"', parts)} - known)
    if missing:
        raise SystemExit(f"unknown sprite icons: {missing}")
    ids = re.findall(r'\sid="([^"]+)"', page)
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    if dupes:
        raise SystemExit(f"duplicate ids: {dupes}")
    pickers = re.findall(r'data-pick="([^"]+)"', parts)
    twice = sorted({i for i in pickers if pickers.count(i) > 1})
    if twice:
        raise SystemExit(f"picker shown twice: {twice}")
    for marker in ("/*@", "<!--@"):
        if marker in page:
            raise SystemExit(f"unresolved placeholder: {marker}")
    dist = HERE / "dist"
    dist.mkdir(exist_ok=True)
    out = dist / "nulo-feedback.html"
    out.write_text(page)
    print(f"{out} {out.stat().st_size / 1024:.0f} KiB")


if __name__ == "__main__":
    main()
