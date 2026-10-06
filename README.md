# openvalence.github.io

This repo holds the static OpenValence website, live at
https://openvalence.github.io, and its GitHub Pages configuration. The
documentation is built from the Valence repo and lives at
https://openvalence.github.io/Valence/.

## Site files

The site consists of:

- `index.html`
- `style.css`
- `mark.svg`
- `fonts/`: the self-hosted fonts (SIL OFL, notice in `fonts/LICENSE`)
- `images/`: the screenshot

There is no build step. The colors and type are Phosphor's default chassis
(Phosphor `src/style.css`); keep them matched to it.

1. Edit the files.
2. Open `index.html` in a browser to check.
3. Push to `main`.

GitHub Pages serves the branch root within a minute.

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
