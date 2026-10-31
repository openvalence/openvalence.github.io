# Checks every downloaded release against its SHA256SUMS.txt and writes flash/fw/index.json for
# the web flasher. Run by .github/workflows/pages.yml:
#   python3 tools/fw_index.py releases.json _site/flash/fw
# releases.json: `gh release list --json tagName,isPrerelease,publishedAt`; each release's files sit
# in <fw>/<tag>/.
# Constraints:
# - Exits non-zero on a tag that is not <product>-<version>, a missing or unlisted file, or a hash
#   mismatch: the deploy stops rather than serve a file the flasher cannot vouch for.
# - role names a slot id in flash/image.js PRESETS; change both together.
import hashlib, json, pathlib, re, sys

ROLES = [(r'^bootloader.*\.bin$', 'boot'), (r'^partition.*\.bin$', 'pt'), (r'^ota_?data.*\.bin$', 'ota'),
         (r'(-app|^firmware)\.bin$', 'app'), (r'\.bin$', 'image')]


def role(name):
    return next((r for pat, r in ROLES if re.search(pat, name)), None)


def main(releases_json, fw_dir):
    fw = pathlib.Path(fw_dir)
    out, bad = [], []
    for rel in json.load(open(releases_json, encoding='utf-8')):
        tag = rel['tagName']
        m = re.fullmatch(r'([a-z0-9][a-z0-9-]*?)-(\d+\.\d+\.\d+)', tag)
        if not m:
            bad.append(f'{tag}: tag is not <product>-<version>')
            continue
        d = fw / tag
        sums_file = d / 'SHA256SUMS.txt'
        if not sums_file.is_file():
            bad.append(f'{tag}: no SHA256SUMS.txt')
            continue
        sums = {}
        for line in sums_file.read_text(encoding='utf-8').splitlines():
            if line.strip():
                h, n = line.split(maxsplit=1)
                sums[n.lstrip('*')] = h.lower()
        files = []
        for p in sorted(d.iterdir()):
            if p.name == 'SHA256SUMS.txt':
                continue
            h = hashlib.sha256(p.read_bytes()).hexdigest()
            if p.name not in sums:
                bad.append(f'{tag}/{p.name}: not in SHA256SUMS.txt')
            elif sums[p.name] != h:
                bad.append(f'{tag}/{p.name}: sha256 {h}, SHA256SUMS.txt says {sums[p.name]}')
            elif role(p.name):
                files.append({'name': p.name, 'role': role(p.name), 'size': p.stat().st_size, 'sha256': h})
        for n in sums.keys() - {p.name for p in d.iterdir()}:
            bad.append(f'{tag}/{n}: listed in SHA256SUMS.txt, not in the release')
        out.append({'product': m[1], 'version': m[2], 'tag': tag, 'prerelease': rel['isPrerelease'],
                    'published': rel.get('publishedAt', ''), 'files': files})
        print(f'{tag}: {len(files)} files verified')
    if bad:
        sys.exit('fw_index: refused\n' + '\n'.join(bad))
    fw.mkdir(parents=True, exist_ok=True)
    (fw / 'index.json').write_text(json.dumps({'releases': out}, indent=1), encoding='utf-8', newline='')


if __name__ == '__main__':
    main(*sys.argv[1:3])
