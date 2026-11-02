# openvalence.github.io

This repo holds the static OpenValence website, live at
https://openvalence.org, and its GitHub Pages configuration. The
documentation is built from the Valence repo and lives at
https://openvalence.org/Valence/.

## Site files

Plain HTML, no build step:

- `index.html`, `privacy.html`, `404.html`, and one folder per page
  (`valence/`, `components/`, `nucleus/`, `phosphor/` with `phosphor/docs/`,
  `kinetic/`, `hardware/`, `isotope/`, `diagrams/`, `demos/`, `downloads/`)
- `style.css` (dark and light: `prefers-color-scheme`, overridden by `data-theme` from the header toggle and the head script in `tools/chrome.html`, which also stands Dark Reader down), `mark.svg`, `favicon.ico`, `icons/` (`icons/ui.svg` is the line-icon sprite pages use with `<use href>`)
- `site.js`: small progressive extras (looping clips that pause off screen, the Kinetic sketch, click-to-load embeds, the downloads page's newest-release lookup from the GitHub API). Pages read fine without it, and it starts nothing moving under `prefers-reduced-motion`
- `fonts/`: the self-hosted fonts (SIL OFL, notice in `fonts/LICENSE`)
- `images/`: screenshots and clips (`images/phosphor/`, light and dark), PCB renders from the KiCad project (`images/hardware/`), the playground shot (`images/kinetic/`), the demo capture, and each page's link-preview card (`images/og/<page>.png`)
- `sitemap.xml`, `robots.txt`

The site has its own look, separate from Phosphor's: Archivo (wide, heavy) for display type, the system face for text, Martian Mono for numbers, and one accent, ultramarine `#2E4BFF`, used as solid bands. The tokens sit at the top of `style.css`. Every page carries the same head, header and footer
between `<!-- chrome:* -->` markers. Edit them in `tools/chrome.html`, then run
`python tools/chrome.py` to copy them into every page. The same run gives every
`h2` and `h3` in `<main>` that lacks one an id from its text, plus a `#` mark
that copies the section's link (`site.js`); run it after adding a heading, and
never rename an id once published. Add a new page's URL to `sitemap.xml`.

Each page's head also gets its own social card: `og:title`, `og:description`,
`og:image` and `twitter:image` come from the page's `<title>`, meta description
and `images/og/<page>.png` (the canonical path's segments joined by `-`, `home`
for `/`). `node tools/og.mjs` renders every card from `tools/og.html` with
Playwright (an installed `playwright` package, or the sibling Phosphor
checkout's); run it after adding a page or changing a title, a description or a
figure a card borrows, then run `chrome.py`. Per-page title, subject and picture
overrides are the `CARDS` table in `tools/og.mjs`; a page without an entry gets
its h1, its description's first sentence and its first figure or image.

1. Edit the files.
2. Preview with `python -m http.server` from the repo root (pages use
   root-relative links, so opening a file directly won't style it).
3. Push to `main`.

Every push to `main` runs `.github/workflows/pages.yml`, which deploys the
repo (minus `tools/` and `.github/`) to GitHub Pages with every firmware
release's files under `/flash/fw/`; the site updates a minute or two later.
A published, edited or deleted release runs it too, once the release's tag
points at a commit that has the workflow (GitHub reads it from the tag); for
the releases tagged before it, `nucleus-p4b-0.1.79` and `barnacle-shim-0.1.78`,
use Run workflow on the Actions tab or `gh workflow run pages.yml`. Pages > Source is "GitHub Actions". The lowercase page
folders sit beside the docs at `/Valence/` and the Kinetic playground at
`/Kinetic/`, which are separate Pages sites; GitHub's paths are
case-sensitive.

## Copy

Page text follows the OpenValence string standard, whose one home is the
rules file `.claude/rules/strings.md` in the Nucleus repo; changed copy
runs its string pass before it is pushed.

## Firmware releases

The web flasher at `/flash/` offers the files of every release on this repo.
The visitor picks a card (hub, helper or remote), then a board. The page
loads that board's newest full release, else its newest prerelease. No file
is chosen. The boards are `BOARDS` in `flash/image.js`. Each key is the URL
hash the guides link to (`/flash/#barnacle`, `#helper`, `#m5-remote`). Never
rename a key. The binaries live only as release assets, never in git.
Each build is one release:

- Tag `<product>-<version>`: `nucleus-p4b-0.1.82`, `nucleus-p4-0.1.85`,
  `barnacle-shim-0.1.82`, `garnet-m5-remote-0.1.1`. The product picks the
  board: `nucleus-p4` (OSSM Flagship), `nucleus-p4b` (barnacle),
  `barnacle-shim` (the barnacle helper), `garnet-m5-remote`,
  `garnet-cores3se`, `garnet-waveshare-s3-43`.
- Assets: exactly the files the flasher writes, plus `SHA256SUMS.txt`. A file's
  name picks its slot (`tools/fw_index.py`): `bootloader*.bin` 0x2000,
  `partition*.bin` 0x8000, `ota_data*.bin` 0xF000, `*-app.bin` or
  `firmware.bin` the app at 0x20000, any other `.bin` a full image at 0x0.
- A Garnet release is one full image per board at 0x0. Make it with
  `esptool merge-bin` from `.pio/build/<env>`: `bootloader.bin` at 0x0,
  `partitions.bin` at 0x8000, `firmware.bin` at 0x10000. The bytes equal
  PlatformIO's `firmware.factory.bin`. Its NVS region is blank, so the remote
  opens its setup hotspot.
- Prerelease while the flasher is WIP.
- No image built with Wi-Fi credentials or a bench OTA key in `secrets.h`.

```
cd <folder holding only the release files>
sha256sum *.bin > SHA256SUMS.txt
gh release create nucleus-p4b-0.1.82 *.bin SHA256SUMS.txt -R openvalence/openvalence.github.io   --target main --prerelease --title "nucleus-p4b 0.1.82" --notes-file NOTES.md
```

The deploy downloads every release, refuses one whose files do not match its
`SHA256SUMS.txt`, and writes `/flash/fw/index.json`. Check an index locally
with `node tools/flash_check.mjs index=<path>`. Deleting a release removes it
from the site at the next deploy.

## Custom domain

Add a file named `CNAME` at the repo root holding the bare domain (for
example `www.example.org`). Set the same domain under Settings > Pages, then
turn on Enforce HTTPS once the certificate is issued. This repo's `CNAME`
holds `openvalence.org`.

At the DNS host, point a `CNAME` record for `www` at `openvalence.github.io`.
Give the apex these records:

| Type | Values |
| --- | --- |
| `A` | 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153 |
| `AAAA` | 2606:50c0:8000::153, 2606:50c0:8001::153, 2606:50c0:8002::153, 2606:50c0:8003::153 |

On Cloudflare, use the same records with the proxy off (DNS only) until
GitHub has issued its certificate. Proxying is optional after that; set SSL
mode to Full.

When the site moves to the custom domain, the docs move with it. Their
canonical links come from the Valence repo variable `VALENCE_SITE_URL`: set it
to the new origin plus `/Valence/` so the sitemap and canonical links use that
origin.
