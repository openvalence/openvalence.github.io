"""Copies the shared head, header and footer blocks from tools/chrome.html into every page.

Each page marks the blocks with <!-- chrome:NAME --> ... <!-- /chrome:NAME -->.
The header's aria-current is set from the page's canonical link. Run from the repo root:
    python tools/chrome.py
"""
import pathlib, re

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
            # the nav chip for this page, or for its section (/phosphor/docs/... marks Phosphor)
            for href in sorted(re.findall(r'class="chip" href="(/[^"]+)"', body), key=len, reverse=True):
                if here.startswith(href):
                    body = body.replace(f'class="chip" href="{href}"', f'class="chip" href="{href}" aria-current="page"', 1)
                    break
        return f"<!-- chrome:{m.group(1)} -->\n{body}<!-- /chrome:{m.group(1)} -->"
    new = re.sub(r"<!-- chrome:(\w+) -->\n.*?<!-- /chrome:\1 -->", fill, text, flags=re.S)
    if new != text:
        page.write_text(new, encoding="utf-8", newline="\n")
        changed += 1
print(f"{changed} page(s) updated")
