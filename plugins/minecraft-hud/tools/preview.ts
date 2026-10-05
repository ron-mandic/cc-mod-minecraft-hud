// Previews the band without a session: `bun tools/preview.ts` writes docs/preview.html (the desktop band at
// several chat widths, laid out with CSS flex space-between as the desktop does, plus the terminal
// line); `bun tools/preview.ts --docs` also renders the README images in ../../docs pixel-exact.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { layoutBand } from '../hooks/desktop'
import { fold, terminalBand } from '../hooks/terminal'
import { rasterize, writePng } from './raster'

// a file path, not the URL's pathname: that one is percent-encoded ("Git%20Projects")
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const NOW = Date.parse('2026-10-05T10:58:00Z')
/** The figures the endpoint answered on 2026-10-05, plus a Sonnet variant and a nearly spent one. */
const LIVE = {
  session: { used: 6, resetsAt: '2026-10-05T14:29:59.570406+00:00' },
  week: { used: 16, resetsAt: '2026-10-06T21:59:59.570426+00:00' },
  fable: { used: 0, resetsAt: '2026-10-06T22:00:00+00:00' },
  context: { window: 200000, tokens: 98000, percent: 49 },
  source: 'endpoint' as const,
}
const SONNET = { ...LIVE, air: { used: 37, model: 'Sonnet', resetsAt: '2026-10-06T22:00:00+00:00' } }
const TIGHT = { ...LIVE, week: { ...LIVE.week, used: 86 }, session: { ...LIVE.session, used: 83 }, context: { window: 200000, tokens: 182000, percent: 91 } }
/** The desktop band's padding and its cell width in CSS px, as desktop.ts assumes it (CELL_PX). */
const PAD = 12
const CELL = 7.8

const layout = (snapshot: typeof LIVE, width: number) =>
  layoutBand(snapshot, { scale: 'auto', numbers: 'full' }, { now: NOW, random: Math.random, bodyColumns: Math.floor((width - 2 * PAD) / CELL) })

function bandHtml(width: number, snapshot: typeof LIVE, label: string, background = '#262626') {
  const band = layout(snapshot, width)
  const images = [band.hud, ...band.columns]
    .map(d => `<div style="flex-shrink:0"><img alt="" width="${d.width}" height="${d.height}" src="data:image/svg+xml;base64,${Buffer.from(d.svg).toString('base64')}"></div>`)
    .join('')
  return (
    `<p>${label} · Größe ${String(band.scale).replace('.', ',')} · ${band.columns.length} Spalten</p>` +
    `<div style="width:${width}px;box-sizing:border-box;background:${background};border-radius:12px;padding:${PAD}px;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start">${images}</div>`
  )
}

function terminalHtml(columns: number) {
  const band = terminalBand(LIVE, columns, NOW, true)
  const span = (s: { text: string; color?: string; isBold?: boolean; isDim?: boolean }) =>
    `<span style="color:${s.color ?? (s.isDim ? '#777' : '#ccc')};font-weight:${s.isBold ? 700 : 400}">${s.text}</span>`
  return `<div style="display:flex;justify-content:space-between;width:${columns}ch">${'<span>' + fold(band.left).map(span).join('') + '</span>'}${'<span>' + band.right.map(span).join('') + '</span>'}</div>`
}

/** One band as a PNG at device pixel ratio 2, its pieces spread as space-between does. */
function bandPng(path: string, width: number) {
  const band = layout(LIVE, width)
  const dpr = 2
  const items = [band.hud, ...band.columns].map(d => rasterize(d.svg, band.scale * dpr, [38, 38, 38]))
  const W = width * dpr
  const H = (items[0]?.h ?? 0) + 2 * PAD * dpr
  const out = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i++) out.set([38, 38, 38, 255], i * 4)
  const gap = items.length > 1 ? (W - 2 * PAD * dpr - items.reduce((sum, it) => sum + it.w, 0)) / (items.length - 1) : 0
  let x = PAD * dpr
  for (const it of items) {
    for (let y = 0; y < it.h; y++) out.set(it.px.subarray(y * it.w * 4, (y + 1) * it.w * 4), ((y + PAD * dpr) * W + Math.round(x)) * 4)
    x += it.w + gap
  }
  writePng(path, W, H, out)
  console.log('wrote', path)
}

let html = '<!doctype html><meta charset="utf-8"><title>minecraft-hud preview</title><body style="background:#1a1a1a;color:#999;font:12px Menlo,monospace;padding:16px">'
for (const width of [1500, 1200, 1000, 900, 770, 680, 560, 440]) html += bandHtml(width, LIVE, `${width} px Chatbreite`)
html += bandHtml(1000, SONNET, '1000 px · mit Sonnet') + bandHtml(770, TIGHT, '770 px · knapp') + bandHtml(770, LIVE, '770 px · hell', '#f4f3ef')
html += '<p>Terminal, 140 / 100 / 80 / 60 / 40 Spalten</p><pre>' + [140, 100, 80, 60, 40].map(terminalHtml).join('') + '</pre>'
// beside the README, outside the plugin folder, so an install does not copy it along
const PREVIEW = join(ROOT, '..', '..', 'docs', 'preview.html')
writeFileSync(PREVIEW, html)
console.log('wrote', PREVIEW)
if (process.argv.includes('--docs')) {
  bandPng(join(ROOT, '..', '..', 'docs', 'hud-preview.png'), 770)
  bandPng(join(ROOT, '..', '..', 'docs', 'hud-preview-wide.png'), 1200)
}
