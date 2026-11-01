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
Guide and docs pages (/guides/, /phosphor/docs/) with three or more headings also get an "On this page"
list (nav.toc, last in <main>): style.css shows it from 1400 px, site.js marks the current section.
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


def toc(page, path):
    """The nav.toc for a guide or docs page: every h2 and h3 of <main> that has an id, in order."""
    page = re.sub(r'\n?[ \t]*<nav class="toc".*?</nav>', "", page, flags=re.S)
    if path.parts[0] != "guides" and path.parts[:2] != ("phosphor", "docs"):
        return page
    main = re.search(r"<main\b.*?</main>", page, flags=re.S)
    heads = re.findall(r'<(h[23])\b[^>]*\sid="([^"]+)"[^>]*>(.*?)</\1>', main.group(0) if main else "", flags=re.S)
    if len(heads) < 3:
        return page
    items = ""
    for tag, hid, inner in heads:
        inner = re.sub(r'<span class="tag">.*?</span>|<a class="hl".*?</a>|<[^>]+>', "", inner, flags=re.S)
        cls = ' class="h3"' if tag == "h3" else ""
        items += f'<li{cls}><a href="#{hid}">{" ".join(inner.split())}</a></li>\n'
    nav = f'  <nav class="toc" aria-label="On this page"><div class="toc-in"><p class="toc-h">On this page</p><ul>\n{items}</ul></div></nav>\n'
    return page.replace("</main>", nav + "</main>", 1)


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


def social(text, here, page):
    """The head block's per-page values: title, description, alt and the card's URL (tools/og.mjs's name rule:
    the canonical path's segments joined by "-", "home" for /, else the file name; ".html" dropped)."""
    title = html.unescape(re.search(r"<title>(.*?)</title>", text, re.S).group(1)).strip()
    desc = re.search(r'<meta name="description" content="([^"]*)"', text)
    desc = html.unescape(desc.group(1)) if desc else ""
    name = re.sub(r"\.html$", "", ("-".join(p for p in here.split("/") if p) or "home") if here else page.name)
    card = root / "images/og" / f"{name}.png"
    if not card.is_file():
        print(f"no card for {page.relative_to(root)}: run node tools/og.mjs; using the home card")
        card = root / "images/og/home.png"
    h = hashlib.sha256(card.read_bytes()).hexdigest()[:10]
    esc = lambda s: html.escape(s, quote=True)
    return {"{title}": esc(title), "{description}": esc(desc), "{alt}": esc(f"{title}. {desc}" if desc else title),
            "{card}": f"https://openvalence.org/{card.relative_to(root).as_posix()}?v={h}"}


# page-level copies of what the head block now carries; removed so each has one home
LOCAL_SOCIAL = re.compile(r'\n<meta (?:property="og:(?:title|description)"|name="twitter:(?:title|description)") content="[^"]*">(?=\n)')

blocks = {k: stamp(v) for k, v in blocks.items()}
changed = 0
for page in sorted(root.rglob("*.html")):
    if page.parts[len(root.parts)] in ("tools", ".git"):
        continue
    orig = text = page.read_text(encoding="utf-8")
    canon = re.search(r'<link rel="canonical" href="https://openvalence\.org(/[^"]*)">', text)
    here = canon.group(1) if canon else None
    if "<!-- chrome:head -->" in text:
        text = LOCAL_SOCIAL.sub("", text)
        values = social(text, here, page)
    def fill(m):
        body = blocks[m.group(1)]
        if m.group(1) == "head":
            for k, v in values.items():
                body = body.replace(k, v)
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
    new = toc(anchor(re.sub(r"<!-- chrome:(\w+) -->\n.*?<!-- /chrome:\1 -->", fill, text, flags=re.S)), page.relative_to(root))
    if new != orig:
        page.write_text(new, encoding="utf-8", newline="\n")
        changed += 1
print(f"{changed} page(s) updated")
