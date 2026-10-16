"""Copies the shared head, header and footer blocks from tools/chrome.html into every page.

Each page marks the blocks with <!-- chrome:NAME --> ... <!-- /chrome:NAME -->.
The header's aria-current is set from the page's canonical link. The Kinetic repo's playground/
(/Kinetic/) carries a copy of the header and its CSS: a header change updates it too. Run from the repo root:
    python tools/chrome.py
"""
import pathlib, re

# pages without a header link of their own, and the link that stands for them
SECTION = {f"/{c}/": "/components/" for c in ("nucleus", "neutrino", "kinetic", "hardware", "isotope")}
root = pathlib.Path(__file__).resolve().parent.parent
blocks = dict(re.findall(r"<!-- chrome:(\w+) -->\n(.*?)<!-- /chrome:\1 -->", (root / "tools/chrome.html").read_text(encoding="utf-8"), re.S))
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
    new = re.sub(r"<!-- chrome:(\w+) -->\n.*?<!-- /chrome:\1 -->", fill, text, flags=re.S)
    if new != text:
        page.write_text(new, encoding="utf-8", newline="\n")
        changed += 1
print(f"{changed} page(s) updated")
