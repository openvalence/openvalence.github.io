# openvalence.github.io

The OpenValence website, live at https://openvalence.github.io. The
documentation is built from the Valence repo and lives at
https://openvalence.github.io/Valence/.

## Editing

The site is `index.html`, `style.css` and `mark.svg`, with no build step.
Edit them, open `index.html` in a browser to check, and push to `main`:
GitHub Pages serves the branch root within a minute.

## Attaching a custom domain

Add a file named `CNAME` at the repo root holding the bare domain (for
example `www.example.org`), and set the same domain under Settings > Pages,
then turn on Enforce HTTPS once the certificate is issued. There is no
`CNAME` file yet because there is no domain yet.

At the DNS host, point a `CNAME` record for `www` at
`openvalence.github.io`, and give the apex the `A` records 185.199.108.153,
185.199.109.153, 185.199.110.153, 185.199.111.153 and the `AAAA` records
2606:50c0:8000::153, 2606:50c0:8001::153, 2606:50c0:8002::153,
2606:50c0:8003::153. On Cloudflare, use the same records with the proxy
off (DNS only) until GitHub has issued its certificate, then proxy them if
you want, with SSL mode set to Full.

The docs follow the domain on their own once it is set, but their
canonical links come from the Valence repo variable `VALENCE_SITE_URL`:
set it to the new origin plus `/Valence/` so the sitemap agrees.
