import type { HudPrefs, HudSnapshot } from '../types'
import { GLYPHS, SPACE_ADVANCE, SPRITE_DEFS } from './sprites'
import { columnsOf } from './text'
import type { HudColumn } from './text'
import { halvesLeft } from './usage'

/**
 * The vanilla Java Edition layout, in GUI pixels, with the hotbar left out:
 * armour (left) and air (right) on the top row, hearts and food 10 below,
 * the experience bar under them and its level number centred on its top edge.
 */
export const HUD_WIDTH = 182
/** The HUD's 25 rows and three more: the columns' bottom line, its descenders and its shadow end there. */
export const HUD_HEIGHT = 28
const TOP_ROW = 0
const MIDDLE_ROW = 10
const XP_BAR_Y = 20
const LEVEL_Y = 14
const LEVEL_COLOR = '#80ff20'
/** One game tick, in seconds: the clock every Minecraft animation runs on. */
const TICK = 0.05
const BLINK_MS = 1100
const WAVE_MS = 3000

/** A column's three lines sit on the HUD's three rows (armour, hearts, XP bar), ten pixels apart. */
const COLUMN_LINES = [TOP_ROW, MIDDLE_ROW, XP_BAR_Y] as const
/** Label and detail a darker grey, the figure a lighter one: all quieter than the sprites. */
const LABEL_COLOR = 0x808080
const VALUE_COLOR = 0xc0c0c0
/** The least room between two pieces of the band, in CSS pixels, however wide it is. */
const MIN_GAP_PX = 20
/** A desktop band cell in CSS pixels (its code font's advance), to turn `bodyColumns` into room. */
const CELL_PX = 7.8

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`

/** The game's text shadow: the colour at a quarter, one pixel down and right. */
const shadowOf = (color: number) => (color & 0xfcfcfc) >> 2

const use = (id: string, x: number, y: number) => `<use href="#${id}" x="${x}" y="${y}"/>`

const glyphId = (char: string) => `t${char.codePointAt(0)}`

/** A discrete per-tick vertical offset animation, as the game jiggles a sprite. */
const shake = (offsets: number[], begin = 0) =>
  `<animateTransform attributeName="transform" type="translate" calcMode="discrete" repeatCount="indefinite"` +
  ` dur="${(offsets.length * TICK).toFixed(2)}s" begin="${begin.toFixed(2)}s" values="${offsets.map(dy => `0 ${dy}`).join(';')}"/>`

const advanceOf = (char: string) => (char === ' ' ? SPACE_ADVANCE : (GLYPHS[char]?.[1] ?? 6))

/** How wide `text` runs in the game's font, without the gap after its last glyph. */
export const textWidth = (text: string) => [...text].reduce((width, char) => width + advanceOf(char), 0) - 1

/** Collects the glyphs a drawing uses and its lines per colour; writes each colour with its shadow. */
class Writer {
  private readonly used = new Set<string>()
  private readonly lines = new Map<number, string>()

  /** The glyphs of `text` placed from x, y: the uses, for text drawn in a group of its own. */
  place(text: string, x: number, y: number): string {
    let pen = x
    let uses = ''
    for (const char of text) {
      if (GLYPHS[char] !== undefined) {
        this.used.add(char)
        uses += use(glyphId(char), pen, y)
      }
      pen += advanceOf(char)
    }
    return uses
  }

  /** `text` at x, y in `color`, with the game's shadow under it. */
  write(text: string, x: number, y: number, color: number) {
    this.lines.set(color, (this.lines.get(color) ?? '') + this.place(text, x, y))
  }

  /** The used glyphs' paths, uncoloured, so each <use> paints them. */
  defs() {
    return [...this.used].map(char => `<path id="${glyphId(char)}" d="${GLYPHS[char]?.[0] ?? ''}"/>`).join('')
  }

  /** Each colour's lines twice: their shadow, then themselves. */
  body() {
    let out = ''
    let n = 0
    for (const [color, uses] of this.lines) {
      out += `<defs><g id="k${n}">${uses}</g></defs>`
      out += `<use href="#k${n}" x="1" y="1" fill="${hex(shadowOf(color))}"/><use href="#k${n}" fill="${hex(color)}"/>`
      n += 1
    }
    return out
  }
}

export type DesktopDrawing = { svg: string; alt: string; width: number; height: number }

export type DrawArgs = {
  /** CSS pixels per sprite pixel. */
  scale: number
  now: number
  /** 0 to 1, as Math.random; tests pass a seeded one. */
  random: () => number
}

/** Ten hearts over their containers: the 7-day limit left, jiggling at two hearts or less. */
function hearts(snapshot: HudSnapshot, { now, random }: DrawArgs) {
  const health = halvesLeft(snapshot.week)
  const isLow = snapshot.week !== undefined && health <= 4
  const isHurt = snapshot.hurtAt !== undefined && now - snapshot.hurtAt < BLINK_MS
  const isHealing = snapshot.healAt !== undefined && now - snapshot.healAt < WAVE_MS
  const lostFrom = isHurt ? Math.max(health, snapshot.hurtFrom ?? health) : health
  let body = ''
  let blink = ''
  for (let i = 0; i < 10; i += 1) {
    const x = i * 8
    let heart = use('hc', x, MIDDLE_ROW)
    if (i * 2 + 1 < health) {
      heart += use('hf', x, MIDDLE_ROW)
    } else if (i * 2 + 1 === health) {
      heart += use('hh', x, MIDDLE_ROW)
    }
    let motion = ''
    if (isLow) {
      motion = shake(Array.from({ length: 8 }, () => (random() < 0.5 ? 0 : 1)), -random())
    } else if (isHealing) {
      // the regeneration wave: one heart a tick hops two pixels, over maxHealth + 5 ticks
      motion = shake(Array.from({ length: 25 }, (_, tick) => (tick === i ? -2 : 0)))
    }
    body += motion === '' ? heart : `<g>${heart}${motion}</g>`
    if (isHurt) {
      blink += use('hcb', x, MIDDLE_ROW)
      if (i * 2 + 1 < lostFrom && i * 2 + 1 >= health) {
        blink += use('hfb', x, MIDDLE_ROW)
      } else if (i * 2 + 1 === lostFrom && lostFrom > health) {
        blink += use('hhb', x, MIDDLE_ROW)
      }
    }
  }
  if (blink !== '') {
    // the damage blink: three ticks on, three off, for a second
    body +=
      `<g opacity="0">${blink}<animate attributeName="opacity" calcMode="discrete" fill="freeze"` +
      ` dur="${(BLINK_MS / 1000).toFixed(2)}s" values="1;0;1;0;1;0;0"/></g>`
  }
  return snapshot.week === undefined ? `<g opacity="0.35">${body}</g>` : body
}

/** Ten armour icons: Fable's weekly limit left; gone when nothing is left, as in the game. */
function armor(snapshot: HudSnapshot) {
  if (snapshot.fable === undefined) {
    return ''
  }
  const points = halvesLeft(snapshot.fable)
  let body = ''
  for (let i = 0; points > 0 && i < 10; i += 1) {
    const id = i * 2 + 1 < points ? 'af' : i * 2 + 1 === points ? 'ah' : 'ae'
    body += use(id, i * 8, TOP_ROW)
  }
  return body
}

/** Ten drumsticks filled from the right: the 5-hour limit left; shaking when it runs low, green when it is gone. */
function food(snapshot: HudSnapshot, { random }: DrawArgs) {
  const level = halvesLeft(snapshot.session)
  const isStarving = snapshot.session !== undefined && level === 0
  const isHungry = snapshot.session !== undefined && level <= 4
  const empty = isStarving ? 'feh' : 'fe'
  // the game shakes every drumstick on one tick in (food level * 3 + 1) once saturation is gone
  const period = Math.max(2, level * 3 + 1)
  let body = ''
  for (let i = 0; i < 10; i += 1) {
    const x = HUD_WIDTH - i * 8 - 9
    let shank = use(empty, x, MIDDLE_ROW)
    if (i * 2 + 1 < level) {
      shank += use('ff', x, MIDDLE_ROW)
    } else if (i * 2 + 1 === level) {
      shank += use('fh', x, MIDDLE_ROW)
    }
    if (isHungry) {
      // four shakes of fresh random offsets per loop, so it does not look canned
      const offsets = Array.from({ length: period * 4 }, (_, tick) => (tick % period === 0 ? Math.floor(random() * 3) - 1 : 0))
      body += `<g>${shank}${shake(offsets)}</g>`
    } else {
      body += shank
    }
  }
  return snapshot.session === undefined ? `<g opacity="0.35">${body}</g>` : body
}

/** Air bubbles over the food: another model's weekly limit, shown only once it is in use (under water). */
function air(snapshot: HudSnapshot, { random }: DrawArgs) {
  if (snapshot.air === undefined) {
    return ''
  }
  const left = Math.max(0, 100 - snapshot.air.used)
  const full = Math.floor(left / 10)
  const isPopping = left % 10 > 0
  const isDrowning = left === 0
  let body = ''
  for (let i = 1; i <= 10; i += 1) {
    const x = HUD_WIDTH - (i - 1) * 8 - 9
    if (i <= full) {
      body += use('oa', x, TOP_ROW)
    } else if (isPopping && i === full + 1) {
      body += use('ob', x, TOP_ROW)
    } else if (isDrowning) {
      body += `<g>${use('oe', x, TOP_ROW)}${shake([0, Math.floor(random() * 2), 0, Math.floor(random() * 2)])}</g>`
    } else {
      body += use('oe', x, TOP_ROW)
    }
  }
  return body
}

/** The experience bar: the context window's fill, its percentage as the level, outlined as the game draws it. */
function experience(snapshot: HudSnapshot, writer: Writer) {
  const fill = snapshot.context?.percent
  const width = fill === undefined ? 0 : Math.min(HUD_WIDTH, Math.floor((fill / 100) * (HUD_WIDTH + 1)))
  let body = use('xb', 0, XP_BAR_Y)
  if (width > 0) {
    // clipped on a group: on the <use> itself the clip would move with its y
    body +=
      `<clipPath id="xc"><rect x="0" y="${XP_BAR_Y}" width="${width}" height="5"/></clipPath>` +
      `<g clip-path="url(#xc)">${use('xp', 0, XP_BAR_Y)}</g>`
  }
  const level = fill === undefined ? 0 : Math.round(fill)
  if (level > 0) {
    const text = String(level)
    const x = Math.floor((HUD_WIDTH - textWidth(text)) / 2)
    body += `<defs><g id="lv">${writer.place(text, 0, 0)}</g></defs>`
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      body += `<use href="#lv" x="${x + dx}" y="${LEVEL_Y + dy}" fill="#000000"/>`
    }
    body += `<use href="#lv" x="${x}" y="${LEVEL_Y}" fill="${LEVEL_COLOR}"/>`
  }
  return body
}

const count = (halves: number) => `${halves / 2}`.replace('.', ',')

const svgOf = (viewWidth: number, scale: number, defs: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewWidth} ${HUD_HEIGHT}"` +
  ` width="${Math.round(viewWidth * scale * 100) / 100}" height="${Math.round(HUD_HEIGHT * scale * 100) / 100}"` +
  ` shape-rendering="crispEdges"><defs>${defs}</defs>${body}</svg>`

/** The HUD itself, the vanilla layout without the hotbar, at `scale` CSS pixels per sprite pixel. */
export function drawHud(snapshot: HudSnapshot, args: DrawArgs): DesktopDrawing {
  const writer = new Writer()
  const sprites =
    experience(snapshot, writer) + armor(snapshot) + air(snapshot, args) + hearts(snapshot, args) + food(snapshot, args)
  const alt = [
    `Herzen ${count(halvesLeft(snapshot.week))} von 10`,
    snapshot.fable === undefined ? undefined : `Rüstung ${count(halvesLeft(snapshot.fable))} von 10`,
    `Hunger ${count(halvesLeft(snapshot.session))} von 10`,
    snapshot.air === undefined ? undefined : `Luft ${Math.floor((100 - snapshot.air.used) / 10)} von 10`,
    snapshot.context?.percent === undefined ? undefined : `XP-Level ${Math.round(snapshot.context.percent)}`,
  ]
    .filter(part => part !== undefined)
    .join(', ')
  return {
    svg: svgOf(HUD_WIDTH, args.scale, SPRITE_DEFS + writer.defs(), sprites + writer.body()),
    alt: `Minecraft-HUD: ${alt}`,
    width: Math.round(HUD_WIDTH * args.scale * 100) / 100,
    height: Math.round(HUD_HEIGHT * args.scale * 100) / 100,
  }
}

/**
 * How wide a column is drawn: its widest line, the figure and the detail at the width of their
 * widest form (`100 %`, `Reset Mi 00:00`), so the band does not shift as the figures change.
 */
export function columnWidth(column: HudColumn): number {
  const widest = column.key === 'context' ? '000k von 000k' : 'Reset Mi 00:00'
  const detail = column.detail === '' ? 0 : Math.max(textWidth(column.detail), textWidth(widest))
  // one more for the shadow
  return Math.max(textWidth(column.label), textWidth(column.value), textWidth('100 %'), detail) + 1
}

/** One column: label, figure and detail on the HUD's three rows, in the game's font with its shadow. */
export function drawColumn(column: HudColumn, scale: number): DesktopDrawing {
  const writer = new Writer()
  const [labelY, valueY, detailY] = COLUMN_LINES
  writer.write(column.label, 0, labelY, LABEL_COLOR)
  writer.write(column.value, 0, valueY, VALUE_COLOR)
  if (column.detail !== '') {
    writer.write(column.detail, 0, detailY, LABEL_COLOR)
  }
  const width = columnWidth(column)
  return {
    svg: svgOf(width, scale, writer.defs(), writer.body()),
    alt: [column.label, column.value, column.detail].filter(part => part !== '').join(' '),
    width: Math.round(width * scale * 100) / 100,
    height: Math.round(HUD_HEIGHT * scale * 100) / 100,
  }
}

/** The CSS pixels the band needs for the HUD and these columns at `scale`, the least gaps included. */
export const bandWidth = (columns: readonly HudColumn[], scale: number) =>
  (HUD_WIDTH + columns.reduce((sum, column) => sum + columnWidth(column), 0)) * scale + MIN_GAP_PX * columns.length

/**
 * What a narrow band gives up, first to last: the weekly details before the session's reset
 * (Fable's reset stands for the week too), the other model before Fable, the session last.
 */
const GIVE_UP: readonly (readonly ['detail' | 'column', string])[] = [
  ['detail', 'air'],
  ['detail', 'week'],
  ['column', 'air'],
  ['detail', 'fable'],
  ['column', 'week'],
  ['detail', 'context'],
  ['column', 'fable'],
  ['detail', 'session'],
  ['column', 'context'],
  ['column', 'session'],
]

export type BandLayout = { scale: number; hud: DesktopDrawing; columns: DesktopDrawing[] }

/** How many of GIVE_UP's first steps scale 2 may take and still count as having room for everything. */
const LARGE_ENOUGH = 2

/**
 * Gives up GIVE_UP's steps until the columns fit `room` at `scale`, then gives back every detail
 * that fits again once a column has gone, the most important first. Answers the columns and how
 * many steps it took.
 */
function fit(wanted: readonly HudColumn[], scale: number, room: number): { columns: HudColumn[]; steps: number } {
  let columns = [...wanted]
  let steps = 0
  for (const [kind, key] of GIVE_UP) {
    if (bandWidth(columns, scale) <= room) {
      break
    }
    columns =
      kind === 'detail'
        ? columns.map(column => (column.key === key ? { ...column, detail: '' } : column))
        : columns.filter(column => column.key !== key)
    steps += 1
  }
  for (const [kind, key] of [...GIVE_UP].reverse()) {
    const original = wanted.find(column => column.key === key)
    const index = columns.findIndex(column => column.key === key)
    if (kind !== 'detail' || original === undefined || index < 0 || columns[index]?.detail !== '') {
      continue
    }
    const trial = columns.map((column, i) => (i === index ? original : column))
    if (bandWidth(trial, scale) <= room) {
      columns = trial
    }
  }
  return { columns, steps }
}

/**
 * Lays the band out for the room `bodyColumns` gives. With `auto` it takes scale 2 where the HUD and
 * every column fit (giving up at most the details another column repeats), else 1.5 with as much as
 * fits there, details before columns, the session last. The surface spreads what is left across the
 * band (space-between), so a wider band grows the gaps, never the pixels: the art stays crisp and the
 * band keeps its height.
 */
export function layoutBand(
  snapshot: HudSnapshot,
  prefs: Pick<HudPrefs, 'scale' | 'numbers'>,
  args: Omit<DrawArgs, 'scale'> & { bodyColumns: number },
): BandLayout {
  const room = args.bodyColumns > 0 ? args.bodyColumns * CELL_PX : Infinity
  const wanted =
    prefs.numbers === 'off' ? [] : columnsOf(snapshot, args.now).map(column => (prefs.numbers === 'short' ? { ...column, detail: '' } : column))
  let scale: number = prefs.scale === 'auto' ? 2 : prefs.scale
  let laid = fit(wanted, scale, room)
  if (prefs.scale === 'auto' && laid.steps > LARGE_ENOUGH) {
    scale = bandWidth([], 1.5) <= room ? 1.5 : 1
    laid = fit(wanted, scale, room)
  }
  return {
    scale,
    hud: drawHud(snapshot, { ...args, scale }),
    columns: laid.columns.map(column => drawColumn(column, scale)),
  }
}
