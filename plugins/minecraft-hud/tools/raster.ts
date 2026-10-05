// Rasterizes the SVG subset this mod writes (pixel-run paths, <use>, groups, opacity, the XP clip) to
// RGBA, and writes PNGs: pixel-exact previews without a browser. Animations are drawn at rest.
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

type Node = { tag: string; attrs: Record<string, string>; children: Node[] }

function parse(xml: string): Node {
  const root: Node = { tag: '#root', attrs: {}, children: [] }
  const stack = [root]
  const re = /<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const [, close, tag, rest, self] = m
    if (close) {
      stack.pop()
      continue
    }
    const attrs: Record<string, string> = {}
    for (const a of rest!.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)) attrs[a[1]!] = a[2]!
    const node: Node = { tag: tag!, attrs, children: [] }
    stack[stack.length - 1]!.children.push(node)
    if (!self) stack.push(node)
  }
  return root.children[0]!
}

export function rasterize(svg: string, scale: number, bg: [number, number, number]): { w: number; h: number; px: Uint8Array } {
  const root = parse(svg)
  const [, , vw, vh] = root.attrs.viewBox!.split(' ').map(Number) as [number, number, number, number]
  const ids = new Map<string, Node>()
  const index = (n: Node) => {
    if (n.attrs.id) ids.set(n.attrs.id, n)
    n.children.forEach(index)
  }
  index(root)
  const w = vw * scale
  const h = vh * scale
  const px = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) px.set([...bg, 255], i * 4)
  const paint = (x: number, y: number, color: string, alpha: number, clipW: number) => {
    if (x < 0 || y < 0 || x >= vw || y >= vh || x >= clipW || alpha <= 0) return
    const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16)
    for (let dy = 0; dy < scale; dy++)
      for (let dx = 0; dx < scale; dx++) {
        const o = ((y * scale + dy) * w + x * scale + dx) * 4
        px[o] = Math.round(px[o]! * (1 - alpha) + r * alpha)
        px[o + 1] = Math.round(px[o + 1]! * (1 - alpha) + g * alpha)
        px[o + 2] = Math.round(px[o + 2]! * (1 - alpha) + b * alpha)
      }
  }
  const draw = (n: Node, tx: number, ty: number, fill: string, alpha: number, clipW: number) => {
    switch (n.tag) {
      case 'defs': case 'clipPath': case 'animate': case 'animateTransform': case 'title': case 'rect':
        return
      case 'path': {
        const color = n.attrs.fill ?? fill
        for (const run of n.attrs.d!.matchAll(/M(-?\d+) (-?\d+)h(\d+)v1h-\d+z/g)) {
          const x0 = Number(run[1]), y0 = Number(run[2]), len = Number(run[3])
          for (let i = 0; i < len; i++) paint(tx + x0 + i, ty + y0, color, alpha, clipW)
        }
        return
      }
      case 'use': {
        const target = ids.get(n.attrs.href!.slice(1))
        if (target) {
          const inner = { ...target, tag: target.tag === 'path' ? 'path' : 'g' }
          draw(inner, tx + Number(n.attrs.x ?? 0), ty + Number(n.attrs.y ?? 0), n.attrs.fill ?? fill, alpha, clipW)
        }
        return
      }
      default: {
        const a = alpha * Number(n.attrs.opacity ?? 1)
        let c = clipW
        const clip = n.attrs['clip-path']?.match(/#([^)]+)/)?.[1]
        if (clip) c = Math.min(c, Number(ids.get(clip)?.children[0]?.attrs.width ?? Infinity))
        for (const child of n.children) draw(child, tx, ty, fill, a, c)
      }
    }
  }
  for (const child of root.children) draw(child, 0, 0, '#000000', 1, Infinity)
  return { w, h, px }
}

export function writePng(path: string, w: number, h: number, px: Uint8Array) {
  const raw = new Uint8Array((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    raw.set(px.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1)
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Uint8Array) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    out.set(new TextEncoder().encode(type), 4)
    out.set(data, 8)
    view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)))
    return out
  }
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, w); v.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]
  writeFileSync(path, Buffer.concat(parts))
}
