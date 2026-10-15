// Previews the band without a session: `bun tools/preview.ts` writes docs/preview.html (the desktop band at
// several chat widths, grouped inside one SVG as the desktop does, plus the terminal
// line); `bun tools/preview.ts --docs` also renders the README images in ../../docs pixel-exact.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { layoutBand } from '../hooks/desktop'
import { fold, terminalBand } from '../hooks/terminal'
import { rasterize, writePng } from './raster'
import type { HudSnapshot } from '../types'

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
const MILLION = { ...LIVE, context: { window: 1_000_000, tokens: 684_000, percent: 68.4 } }
const UNKNOWN: HudSnapshot = { context: LIVE.context, source: 'none' }
const PARTIAL: HudSnapshot = { ...LIVE, week: undefined }
const TIGHT = { ...LIVE, week: { ...LIVE.week, used: 86 }, session: { ...LIVE.session, used: 83 }, context: { window: 200000, tokens: 182000, percent: 91 } }
/** The desktop band's padding and its cell width in CSS px, as desktop.ts assumes it (CELL_PX). */
const PAD = 12
const CELL = 7.8

const layout = (snapshot: HudSnapshot, width: number) =>
  layoutBand(snapshot, { scale: 'auto', numbers: 'full' }, { now: NOW, random: Math.random, bodyColumns: Math.floor((width - 2 * PAD) / CELL) })

function bandHtml(width: number, snapshot: HudSnapshot, label: string, background = '#262626') {
  const band = layout(snapshot, width)
  const d = band.drawing
  const image = `<img alt="" width="${d.width}" height="${d.height}" src="data:image/svg+xml;base64,${Buffer.from(d.svg).toString('base64')}">`
  return (
    `<p>${label} · Größe ${String(band.scale).replace('.', ',')} · ${band.columns.length} Spalten</p>` +
    `<div style="width:${width}px;box-sizing:border-box;background:${background};border-radius:12px;padding:${PAD}px">${image}</div>`
  )
}

function terminalHtml(columns: number) {
  const band = terminalBand(LIVE, columns, NOW, true)
  const span = (s: { text: string; color?: string; isBold?: boolean; isDim?: boolean }) =>
    `<span style="color:${s.color ?? (s.isDim ? '#777' : '#ccc')};font-weight:${s.isBold ? 700 : 400}">${s.text}</span>`
  return `<div style="display:flex;justify-content:space-between;width:${columns}ch">${'<span>' + fold(band.left).map(span).join('') + '</span>'}${'<span>' + band.right.map(span).join('') + '</span>'}</div>`
}

/** One band as a PNG at device pixel ratio 2, as the desktop draws its one image. */
function bandPng(path: string, width: number, snapshot: HudSnapshot = LIVE) {
  const band = layout(snapshot, width)
  const dpr = 2
  const image = rasterize(band.drawing.svg, band.scale * dpr, [38, 38, 38])
  const W = width * dpr
  const H = image.h + 2 * PAD * dpr
  const out = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i++) out.set([38, 38, 38, 255], i * 4)
  for (let y = 0; y < image.h; y++) {
    const row = image.px.subarray(y * image.w * 4, Math.min(image.w, W - 2 * PAD * dpr) * 4 + y * image.w * 4)
    out.set(row, ((y + PAD * dpr) * W + PAD * dpr) * 4)
  }
  writePng(path, W, H, out)
  console.log('wrote', path)
}

let html = '<!doctype html><meta charset="utf-8"><title>minecraft-hud preview</title><body style="background:#1a1a1a;color:#999;font:12px Menlo,monospace;padding:16px">'
for (const width of [1500, 1200, 1000, 900, 770, 680, 560, 440]) html += bandHtml(width, LIVE, `${width} px Chatbreite`)
html += bandHtml(1000, SONNET, '1000 px · mit Sonnet') + bandHtml(770, TIGHT, '770 px · knapp') + bandHtml(770, LIVE, '770 px · hell', '#f4f3ef')
for (const width of [1200, 796, 700, 560]) html += bandHtml(width, MILLION, `${width} px · 1M-Kontext`)
html += bandHtml(770, UNKNOWN, '770 px · Budgets unbekannt') +
  bandHtml(770, PARTIAL, '770 px · nur Woche unbekannt') +
  bandHtml(770, UNKNOWN, '770 px · unbekannt, hell', '#f4f3ef')
html += '<p>Terminal, 140 / 100 / 80 / 60 / 40 Spalten</p><pre>' + [140, 100, 80, 60, 40].map(terminalHtml).join('') + '</pre>'
// beside the README, outside the plugin folder, so an install does not copy it along
const PREVIEW = join(ROOT, '..', '..', 'docs', 'preview.html')
writeFileSync(PREVIEW, html)
console.log('wrote', PREVIEW)
if (process.argv.includes('--docs')) {
  bandPng(join(ROOT, '..', '..', 'docs', 'hud-preview.png'), 770)
  bandPng(join(ROOT, '..', '..', 'docs', 'hud-preview-wide.png'), 1200)
  bandPng(join(ROOT, '..', '..', 'docs', 'hud-preview-unknown.png'), 770, UNKNOWN)
  bandPng(join(ROOT, '..', '..', 'docs', 'hud-preview-sonnet.png'), 1000, SONNET)
}
