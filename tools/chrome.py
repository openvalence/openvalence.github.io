"""Copies the shared head, header and footer blocks from tools/chrome.html into every page, then gives
every h2 and h3 in <main> an id and a section link mark (style.css .hl; site.js copies the link).

Each page marks the blocks with <!-- chrome:NAME --> ... <!-- /chrome:NAME -->.
Every site-root .css/.js the blocks reference gets ?v=<first 10 hex of the file's sha256>, so a deploy
that changes the file changes the URL and no cache serves the old one against new HTML.
The header's aria-current is set from the page's canonical link. The Kinetic repo's playground/
(/Kinetic/) carries a copy of the header and its CSS: a header change updates it too. Run from the repo root:
    python tools/chrome.py
Constraints: never change an id once published; Phosphor and shared links point at them. A heading
that is itself a link (a card title) gets neither id nor mark.
"""
import hashlib, html, pathlib, re

MARK = '<a class="hl" href="#{}" aria-label="Copy link to this section"></a>'


def slug(inner, taken):
    text = re.sub(r'<span class="tag">.*?</span>', "", inner, flags=re.S)
    text = html.unescape(re.sub(r"<[^>]+>", "", text)).lower().replace("'", "").replace("’", "")
    s = ""
    for w in re.findall(r"[a-z0-9]+", text):
        if s and len(s) + len(w) >= 32:
            break
        s = f"{s}-{w}" if s else w
    base, n = s or "section", 2
    s = base
    while s in taken:
        s, n = f"{base}-{n}", n + 1
    taken.add(s)
    return s


def anchor(page):
    taken = set(re.findall(r'\sid="([^"]+)"', page))

    def one(m):
        tag, attrs, inner = m.groups()
        if re.search(r'<a\b(?![^>]*class="hl")', inner):
            return m.group(0)
        hid = re.search(r'\sid="([^"]+)"', attrs)
        if hid:
            hid = hid.group(1)
        else:
            hid = slug(inner, taken)
            attrs += f' id="{hid}"'
        if 'class="hl"' not in inner:
            inner = inner.rstrip() + MARK.format(hid)
        return f"<{tag}{attrs}>{inner}</{tag}>"

    heads = lambda mm: re.sub(r"<(h[23])\b([^>]*)>(.*?)</\1>", one, mm.group(0), flags=re.S)
    return re.sub(r"<main\b.*?</main>", heads, page, flags=re.S)


# pages without a header link of their own, and the link that stands for them
SECTION = {f"/{c}/": "/components/" for c in ("nucleus", "neutrino", "kinetic", "hardware", "isotope")}
root = pathlib.Path(__file__).resolve().parent.parent
blocks = dict(re.findall(r"<!-- chrome:(\w+) -->\n(.*?)<!-- /chrome:\1 -->", (root / "tools/chrome.html").read_text(encoding="utf-8"), re.S))


def stamp(body):
    def one(m):
        f = root / m.group(2).lstrip("/")
        if not f.is_file():
            return m.group(0)
        h = hashlib.sha256(f.read_bytes().replace(b"\r\n", b"\n")).hexdigest()[:10]
        return f'{m.group(1)}"{m.group(2)}?v={h}"'
    return re.sub(r'((?:href|src)=)"(/[^"?]+\.(?:css|js))"', one, body)


blocks = {k: stamp(v) for k, v in blocks.items()}
changed = 0
for page in sorted(root.rglob("*.html")):
    if page.parts[len(root.parts)] in ("tools", ".git"):
        continue
    text = page.read_text(encoding="utf-8")
    canon = re.search(r'<link rel="canonical" href="https://openvalence\.org(/[^"]*)">', text)
    here = canon.group(1) if canon else None
    def fill(m):
        body = blocks[m.group(1)]
        if here and here != "/":
            # the header link for this page or its section (/phosphor/docs/... marks Phosphor,
            # the component pages mark Components)
            mark = SECTION.get(here, here)
            for cls, href in sorted(re.findall(r'class="(chip[^"]*|get)" href="(/[^"]+)"', body), key=lambda m: len(m[1]), reverse=True):
                if mark.startswith(href):
                    body = body.replace(f'class="{cls}" href="{href}"', f'class="{cls}" href="{href}" aria-current="page"', 1)
                    break
            # the page's own entry in the Components menu
            body = body.replace(f'class="item" href="{here}"', f'class="item" href="{here}" aria-current="page"', 1)
        return f"<!-- chrome:{m.group(1)} -->\n{body}<!-- /chrome:{m.group(1)} -->"
    new = anchor(re.sub(r"<!-- chrome:(\w+) -->\n.*?<!-- /chrome:\1 -->", fill, text, flags=re.S))
    if new != text:
        page.write_text(new, encoding="utf-8", newline="\n")
        changed += 1
print(f"{changed} page(s) updated")
