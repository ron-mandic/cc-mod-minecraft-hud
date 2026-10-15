import type { HudSnapshot } from '../types'
import { resetText } from './text'
import { halvesLeft } from './usage'

/** One run of text in one colour: the terminal band is a row of these. */
export type Segment = { text: string; color?: string; isBold?: boolean; isDim?: boolean }

/** The terminal band: the glyph bars on the left, the figures on the right, the room between them free. */
export type TerminalBand = { left: Segment[]; right: Segment[] }

/** The sprites' own colours, sampled from the original textures. */
const COLOR = {
  heart: '#ff1313',
  heartHalf: '#bb1313',
  armor: '#b8b9c4',
  armorHalf: '#696a70',
  food: '#b88458',
  hunger: '#4f7a32',
  air: '#56b8ff',
  xp: '#80ff20',
  xpEmpty: '#2e3a33',
  empty: '#5a5a5a',
}

/** The least room between the bars and the figures, in cells. */
const GAP = 3

/** Ten glyphs for half-steps (0 to 20) filled from the left, or from the right with `isFromRight`. */
function bar(halves: number, glyphs: [string, string, string], colors: [string, string, string], isFromRight = false): Segment[] {
  const cells: Segment[] = []
  for (let i = 0; i < 10; i += 1) {
    const state = i * 2 + 1 < halves ? 0 : i * 2 + 1 === halves ? 1 : 2
    cells.push({ text: glyphs[state], color: colors[state] })
  }
  return isFromRight ? cells.reverse() : cells
}

/** Ten cells of experience bar with the level written into its middle, as the game sets it on top. */
function experienceBar(fill: number | undefined): Segment[] {
  const cells: Segment[] = Array.from({ length: 10 }, (_, i) => ({
    text: '━',
    color: fill !== undefined && i < Math.round(fill / 10) ? COLOR.xp : COLOR.xpEmpty,
  }))
  const level = fill === undefined ? 0 : Math.round(fill)
  if (level > 0) {
    const text = String(level)
    const start = Math.floor((10 - text.length) / 2)
    for (let i = 0; i < text.length; i += 1) {
      cells[start + i] = { text: text[i] ?? '', color: COLOR.xp, isBold: true }
    }
  }
  return cells
}

const join = (...groups: Segment[][]) =>
  groups.filter(group => group.length > 0).flatMap((group, i) => (i === 0 ? group : [{ text: ' ' }, ...group]))

const widthOf = (segments: readonly Segment[]) => segments.reduce((sum, segment) => sum + [...segment.text].length, 0)

/** The glyph bars in the HUD's order: hearts, armour, the XP bar with its level, food (from the right), air. */
function bars(snapshot: HudSnapshot): Segment[] {
  const unknown = (glyph: string): Segment[] => [{ text: glyph.repeat(4) + '?' + glyph.repeat(5), color: COLOR.empty, isDim: true }]
  const hearts = snapshot.week === undefined ? unknown('♡') : bar(halvesLeft(snapshot.week), ['♥', '♥', '♡'], [COLOR.heart, COLOR.heartHalf, COLOR.empty])
  const armor =
    snapshot.fable === undefined || halvesLeft(snapshot.fable) === 0
      ? []
      : bar(halvesLeft(snapshot.fable), ['◆', '◈', '◇'], [COLOR.armor, COLOR.armorHalf, COLOR.empty])
  const isStarving = snapshot.session !== undefined && halvesLeft(snapshot.session) === 0
  const food = snapshot.session === undefined ? unknown('○') : bar(halvesLeft(snapshot.session), ['●', '◑', '○'], [COLOR.food, COLOR.food, isStarving ? COLOR.hunger : COLOR.empty], true)
  const air =
    snapshot.air === undefined
      ? []
      : Array.from({ length: 10 }, (_, i): Segment => {
          const left = 100 - (snapshot.air?.used ?? 0)
          const full = Math.floor(left / 10)
          const slot = 9 - i
          return slot < full
            ? { text: '○', color: COLOR.air }
            : slot === full && left % 10 > 0
              ? { text: '◌', color: COLOR.air }
              : { text: '·', color: COLOR.empty }
        })
  return join(hearts, armor, experienceBar(snapshot.context?.percent), food, air)
}

/** A figure as words; `short` stands in where `text` does not fit. */
type Figure = { text: string; short?: string; priority: number }

/** The figures as words, in reading order; `priority` says what a narrow terminal keeps (0 first). */
function figures(snapshot: HudSnapshot, now: number): Figure[] {
  const out: (Figure | undefined)[] = [
    snapshot.session === undefined
      ? undefined
      : {
          text: `Sitzung ${Math.round(snapshot.session.used)} %` + ((reset => (reset === undefined ? '' : ` · ${reset}`))(resetText(snapshot.session.resetsAt, now))),
          short: `Sitzung ${Math.round(snapshot.session.used)} %`,
          priority: 0,
        },
    snapshot.week === undefined ? undefined : { text: `Woche ${Math.round(snapshot.week.used)} %`, priority: 3 },
    snapshot.fable === undefined ? undefined : { text: `Fable ${Math.round(snapshot.fable.used)} %`, priority: 2 },
    snapshot.air === undefined ? undefined : { text: `${snapshot.air.model} ${Math.round(snapshot.air.used)} %`, priority: 4 },
    snapshot.context?.percent === undefined ? undefined : { text: `Kontext ${Math.round(snapshot.context.percent)} %`, priority: 1 },
  ]
  return out.filter((figure): figure is Figure => figure !== undefined)
}

/** The figures that fit `room` cells, most important first (each in its short form if need be), in reading order. */
function fitting(all: Figure[], room: number): string {
  const kept = new Map<Figure, string>()
  const line = (with_: Map<Figure, string>) => all.filter(one => with_.has(one)).map(one => with_.get(one)).join('   ')
  for (const figure of [...all].sort((a, b) => a.priority - b.priority)) {
    for (const words of [figure.text, figure.short].filter((one): one is string => one !== undefined)) {
      const trial = new Map(kept).set(figure, words)
      if ([...line(trial)].length <= room) {
        kept.set(figure, words)
        break
      }
    }
  }
  return line(kept)
}

/**
 * The reduced HUD for the terminal: one line, the bars left and the figures right, spread over the
 * band. A narrow band keeps the bars and the most important figures; too narrow for the bars, the
 * figures alone.
 */
export function terminalBand(snapshot: HudSnapshot, columns: number, now: number, isWithNumbers: boolean): TerminalBand {
  const left = bars(snapshot)
  const all = isWithNumbers ? figures(snapshot, now) : []
  const room = columns - widthOf(left) - GAP
  const words = fitting(all, room)
  if (widthOf(left) <= columns && (words !== '' || all.length === 0)) {
    return { left, right: words === '' ? [] : [{ text: words, isDim: true }] }
  }
  return { left: [], right: [{ text: fitting(all, columns), isDim: true }] }
}

/** The plain-text form for the status line under the prompt: the figures as words, nothing else. */
export function statusText(snapshot: HudSnapshot, now: number): string {
  return figures(snapshot, now)
    .map(figure => figure.text)
    .join(' · ')
}

/** Neighbouring segments of one look folded into one, so the line is a few Text elements, not forty. */
export function fold(segments: Segment[]): Segment[] {
  const out: Segment[] = []
  for (const segment of segments) {
    const last = out[out.length - 1]
    if (last !== undefined && last.color === segment.color && last.isBold === segment.isBold && last.isDim === segment.isDim) {
      last.text += segment.text
    } else {
      out.push({ ...segment })
    }
  }
  return out
}
