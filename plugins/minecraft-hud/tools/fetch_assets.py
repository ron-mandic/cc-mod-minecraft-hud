#!/usr/bin/env python3
"""Fetch the HUD sprites and font sheets from Mojang's official client and rebuild hooks/sprites.ts.

The assets belong to Mojang/Microsoft and are not part of this repository (see .gitignore): each
person fetches them on their own machine, straight from Mojang's servers.

  python3 tools/fetch_assets.py                  # the version this mod was built with
  python3 tools/fetch_assets.py --version latest # the newest release
  python3 tools/fetch_assets.py --jar client.jar # a client.jar you already have
  python3 tools/fetch_assets.py --dry-run        # say what would be fetched, fetch nothing

Standard library only.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
BUILT_WITH = '26.3'

# path in client.jar (under assets/minecraft/) -> path under this plugin's assets/
HUD = 'textures/gui/sprites/hud/'
FILES = [
    *(HUD + name + '.png' for name in [
        'air', 'air_bursting', 'air_empty', 'armor_empty', 'armor_full', 'armor_half',
        'experience_bar_background', 'experience_bar_progress',
        'food_empty', 'food_full', 'food_half', 'food_empty_hunger', 'food_full_hunger', 'food_half_hunger',
        'heart/container', 'heart/container_blinking', 'heart/full', 'heart/full_blinking',
        'heart/half', 'heart/half_blinking',
    ]),
    'textures/font/ascii.png',
    'textures/font/nonlatin_european.png',
    'font/include/default.json',
]


def get_json(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.load(response)


def resolve(version):
    manifest = get_json(MANIFEST)
    wanted = manifest['latest']['release'] if version == 'latest' else version
    entry = next((v for v in manifest['versions'] if v['id'] == wanted), None)
    if entry is None:
        raise SystemExit(f'Mojang lists no version {wanted!r}')
    client = get_json(entry['url'])['downloads']['client']
    return wanted, client['url'], client['sha1'], client['size']


def download(url, sha1, path):
    digest = hashlib.sha1()
    with urllib.request.urlopen(url, timeout=120) as response, open(path, 'wb') as out:
        while chunk := response.read(1 << 20):
            digest.update(chunk)
            out.write(chunk)
    if digest.hexdigest() != sha1:
        raise SystemExit(f'SHA-1 mismatch for {url}: got {digest.hexdigest()}, Mojang says {sha1}')


def extract(jar):
    with zipfile.ZipFile(jar) as archive:
        for name in FILES:
            data = archive.read('assets/minecraft/' + name)
            target = os.path.join(ROOT, 'assets', name)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, 'wb') as out:
                out.write(data)
    print(f'extracted {len(FILES)} files into {os.path.join(ROOT, "assets")}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--version', default=BUILT_WITH, help=f'a release id, or latest (default {BUILT_WITH})')
    parser.add_argument('--jar', help='use this client.jar instead of downloading one')
    parser.add_argument('--dry-run', action='store_true', help='resolve the download, fetch nothing')
    args = parser.parse_args()
    if args.jar:
        extract(args.jar)
    else:
        version, url, sha1, size = resolve(args.version)
        print(f'Minecraft {version}: {url} ({size / 1e6:.1f} MB, sha1 {sha1})', flush=True)
        if args.dry_run:
            return
        with tempfile.TemporaryDirectory() as tmp:
            jar = os.path.join(tmp, 'client.jar')
            download(url, sha1, jar)
            extract(jar)
    subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'build_sprites.py')], check=True)


if __name__ == '__main__':
    main()
