#!/usr/bin/env python3
"""Turn the original Minecraft HUD sprites in assets/ into hooks/sprites.ts.

Each sprite becomes one SVG <g> of pixel runs (one <path> per colour), so the
desktop draws the real pixels at any scale. Swap a PNG in assets/ (a resource
pack's, say) and run this again:  python3 tools/build_sprites.py
Standard library only.
"""
import json
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HUD = os.path.join(ROOT, 'assets', 'textures', 'gui', 'sprites', 'hud')
FONT_DIR = os.path.join(ROOT, 'assets', 'textures', 'font')
# Mojang's table of which character sits in which cell of which font sheet
FONT_TABLE = os.path.join(ROOT, 'assets', 'font', 'include', 'default.json')
OUT = os.path.join(ROOT, 'hooks', 'sprites.ts')

# id in the SVG -> sprite path under assets/textures/gui/sprites/hud
SPRITES = {
    'hc': 'heart/container',
    'hcb': 'heart/container_blinking',
    'hf': 'heart/full',
    'hh': 'heart/half',
    'hfb': 'heart/full_blinking',
    'hhb': 'heart/half_blinking',
    'ae': 'armor_empty',
    'ah': 'armor_half',
    'af': 'armor_full',
    'fe': 'food_empty',
    'fh': 'food_half',
    'ff': 'food_full',
    'feh': 'food_empty_hunger',
    'fhh': 'food_half_hunger',
    'ffh': 'food_full_hunger',
    'oa': 'air',
    'ob': 'air_bursting',
    'oe': 'air_empty',
    'xb': 'experience_bar_background',
    'xp': 'experience_bar_progress',
}

# The characters the HUD writes: printable ASCII and a few symbols (the hourglass marks a reset)
GLYPHS = ''.join(chr(code) for code in range(33, 127)) + '·–⌛→×•'
# The space is no glyph in the game: it advances the pen by 4 pixels
SPACE_ADVANCE = 4


def decode(path):
    """RGBA rows of a non-interlaced PNG: 8-bit colour, or 1/2/4/8-bit grey or palette."""
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', path
    pos, idat, plte, trns = 8, b'', None, None
    while pos < len(data):
        (length,) = struct.unpack('>I', data[pos:pos + 4])
        kind, chunk = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if kind == b'IHDR':
            w, h, depth, color, _, _, interlace = struct.unpack('>IIBBBBB', chunk)
            assert interlace == 0, 'interlaced PNGs are not supported'
            assert depth == 8 or color in (0, 3), 'only 8-bit colour PNGs'
        elif kind == b'PLTE':
            plte = [tuple(chunk[i:i + 3]) for i in range(0, len(chunk), 3)]
        elif kind == b'tRNS':
            trns = chunk
        elif kind == b'IDAT':
            idat += chunk
    raw = zlib.decompress(idat)
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color]
    stride = (w * channels * depth + 7) // 8
    bpp = max(1, channels * depth // 8)
    prev, rows, i = bytearray(stride), [], 0
    for _ in range(h):
        f, line = raw[i], bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + ((a + b) >> 1)) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line)
        prev = line
    px = []
    for line in rows:
        if depth < 8:
            mask = (1 << depth) - 1
            vals = [(byte >> s) & mask for byte in line for s in range(8 - depth, -1, -depth)][:w]
            samples = [(v,) for v in vals]
        else:
            samples = [tuple(line[x * channels:(x + 1) * channels]) for x in range(w)]
        row = []
        for v in samples:
            if color == 3:
                r, g, b = plte[v[0]]
                row.append((r, g, b, trns[v[0]] if trns and v[0] < len(trns) else 255))
            elif color == 6:
                row.append(v)
            elif color == 2:
                row.append((v[0], v[1], v[2], 255))
            elif color == 4:
                row.append((v[0], v[0], v[0], v[1]))
            else:
                grey = v[0] * 255 // ((1 << depth) - 1)
                row.append((grey, grey, grey, 255))
        px.append(row)
    return w, h, px


def runs(px, x0=0, y0=0, w=None, h=None):
    """Horizontal runs of opaque pixels, grouped by colour: {hex: [(x, y, len)]}."""
    h = h if h is not None else len(px)
    w = w if w is not None else len(px[0])
    out = {}
    for y in range(h):
        x = 0
        while x < w:
            p = px[y0 + y][x0 + x]
            if p[3] < 128:
                x += 1
                continue
            n = 1
            while x + n < w and px[y0 + y][x0 + x + n][:3] == p[:3] and px[y0 + y][x0 + x + n][3] >= 128:
                n += 1
            out.setdefault('#%02x%02x%02x' % p[:3], []).append((x, y, n))
            x += n
    return out


def path_d(segments):
    return ''.join(f'M{x} {y}h{n}v1h-{n}z' for x, y, n in segments)


def sprite_group(sid, px):
    paths = ''.join(f'<path fill="{c}" d="{path_d(s)}"/>' for c, s in runs(px).items())
    return f'<g id="{sid}">{paths}</g>'


def ts_string(text):
    return "'" + text.replace('\\', '\\\\').replace("'", "\\'") + "'"


def main():
    defs = []
    sizes = {}
    for sid, name in SPRITES.items():
        w, h, px = decode(os.path.join(HUD, name + '.png'))
        sizes[sid] = (w, h)
        defs.append(sprite_group(sid, px))
    providers = [p for p in json.load(open(FONT_TABLE))['providers'] if p.get('type') == 'bitmap']
    sheets = {}

    def cell_of(char):
        # the first sheet that lists the character wins, as in the game
        for provider in providers:
            name = provider['file'].split('/')[-1]
            if not os.path.exists(os.path.join(FONT_DIR, name)):
                continue
            for row, chars in enumerate(provider['chars']):
                column = chars.find(char)
                if column >= 0:
                    if name not in sheets:
                        sheets[name] = decode(os.path.join(FONT_DIR, name))[2]
                    return sheets[name], column * 8, row * 8
        raise SystemExit(f'no font sheet in assets/ has {char!r}')

    glyphs = []
    for char in GLYPHS:
        sheet, cx, cy = cell_of(char)
        segs = [s for group in runs(sheet, cx, cy, 8, 8).values() for s in group]
        width = max((x + n for x, _, n in segs), default=0)
        glyphs.append(f"{ts_string(char) if char != chr(39) else chr(34) + chr(39) + chr(34)}: [{ts_string(path_d(segs))}, {width + 1}]")
    with open(OUT, 'w') as f:
        f.write('// Generated by tools/build_sprites.py from the original Minecraft HUD sprites\n')
        f.write('// in assets/ (Mojang, Minecraft Java Edition 26.3). Do not edit by hand.\n\n')
        f.write('/** One <g> per sprite, ids as tools/build_sprites.py names them. */\n')
        f.write('export const SPRITE_DEFS =\n  ' + ts_string(''.join(defs)) + '\n\n')
        f.write('/** The Minecraft font, by character: its uncoloured path and how far the pen moves after it. */\n')
        f.write('export const GLYPHS: Readonly<Record<string, readonly [string, number]>> = {\n')
        f.write(''.join(f'  {glyph},\n' for glyph in glyphs))
        f.write('}\n\n')
        f.write('/** The space is no glyph: it moves the pen on by this much. */\n')
        f.write(f'export const SPACE_ADVANCE = {SPACE_ADVANCE}\n')
    total = sum(len(d) for d in defs)
    print(f'wrote {OUT}: {len(defs)} sprites, {len(glyphs)} glyphs, {total} chars of SVG')


if __name__ == '__main__':
    main()
