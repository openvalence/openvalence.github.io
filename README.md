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
- `style.css` (dark and light, from `prefers-color-scheme`), `mark.svg`, `favicon.ico`, `icons/` (`icons/ui.svg` is the line-icon sprite pages use with `<use href>`)
- `site.js`: small progressive extras (looping clips that pause off screen, the Kinetic sketch, click-to-load embeds). Pages read fine without it, and it starts nothing moving under `prefers-reduced-motion`
- `fonts/`: the self-hosted fonts (SIL OFL, notice in `fonts/LICENSE`)
- `images/`: screenshots and clips (`images/phosphor/`, light and dark), PCB renders from the KiCad project (`images/hardware/`), the playground shot (`images/kinetic/`), the demo capture and the social card (`og.png`)
- `sitemap.xml`, `robots.txt`

The colors and type are Phosphor's default chassis (Phosphor `src/style.css`);
keep them matched to it. Every page carries the same head, header and footer
between `<!-- chrome:* -->` markers. Edit them in `tools/chrome.html`, then run
`python tools/chrome.py` to copy them into every page. Add a new page's URL to
`sitemap.xml`.

1. Edit the files.
2. Preview with `python -m http.server` from the repo root (pages use
   root-relative links, so opening a file directly won't style it).
3. Push to `main`.

GitHub Pages serves the branch root within a minute. The lowercase page
folders sit beside the docs at `/Valence/` and the Kinetic playground at
`/Kinetic/`, which are separate Pages sites; GitHub's paths are
case-sensitive.

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
