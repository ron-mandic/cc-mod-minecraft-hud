import type { HudLimit, HudPrefs, HudSnapshot } from '../types'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** `41 %`, German style; `41%` with `isTight` for the terminal. */
export const percent = (value: number, isTight = false) =>
  `${Math.round(value * 10) / 10}`.replace('.', ',') + (isTight ? '%' : ' %')

/** How long until `iso`, in German: `in 2 Std. 13 Min.`, `in 3 T. 4 Std.`, `gleich`. */
export function until(iso: string | undefined, now: number): string | undefined {
  const at = iso === undefined ? NaN : Date.parse(iso)
  if (!Number.isFinite(at)) {
    return undefined
  }
  const left = at - now
  if (left < MINUTE) {
    return 'gleich'
  }
  const days = Math.floor(left / DAY)
  const hours = Math.floor((left % DAY) / HOUR)
  const minutes = Math.floor((left % HOUR) / MINUTE)
  if (days > 0) {
    return hours > 0 ? `in ${days} T. ${hours} Std.` : `in ${days} T.`
  }
  if (hours > 0) {
    return minutes > 0 ? `in ${hours} Std. ${minutes} Min.` : `in ${hours} Std.`
  }
  return `in ${minutes} Min.`
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

const twoDigits = (value: number) => String(value).padStart(2, '0')

/**
 * When a window resets, as a local clock time: `Reset 16:30` today, `Reset Mi 00:00` on another day.
 * Rounded to the minute (the endpoint says 21:59:59.57 for midnight). Stays put between readings,
 * unlike a countdown, so the drawing changes only when the figures do.
 */
export function resetText(iso: string | undefined, now: number): string | undefined {
  const at = iso === undefined ? NaN : Date.parse(iso)
  if (!Number.isFinite(at)) {
    return undefined
  }
  const when = new Date(Math.round(at / MINUTE) * MINUTE)
  const today = new Date(now)
  const isToday = when.getFullYear() === today.getFullYear() && when.getMonth() === today.getMonth() && when.getDate() === today.getDate()
  const clock = `${twoDigits(when.getHours())}:${twoDigits(when.getMinutes())}`
  return isToday ? `Reset ${clock}` : `Reset ${WEEKDAYS[when.getDay()] ?? ''} ${clock}`
}

const ago = (at: number | undefined, now: number) => {
  if (at === undefined) {
    return undefined
  }
  const minutes = Math.round((now - at) / MINUTE)
  return minutes < 1 ? 'gerade eben' : minutes < 60 ? `vor ${minutes} Min.` : `vor ${Math.round(minutes / 60)} Std.`
}

const tokens = (value: number) => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

const limitLine = (limit: HudLimit | undefined, now: number) => {
  if (limit === undefined) {
    return 'keine Daten'
  }
  const clock = resetText(limit.resetsAt, now)
  const reset = until(limit.resetsAt, now)
  return `${percent(limit.used)} genutzt, ${percent(100 - limit.used)} übrig` + (clock === undefined ? '' : ` · ${clock} (${reset})`)
}

const sourceLine = (snapshot: HudSnapshot, now: number) => {
  const when = ago(snapshot.readAt, now)
  const from =
    snapshot.source === 'endpoint'
      ? 'Usage-Endpoint'
      : snapshot.source === 'session'
        ? 'letzte API-Antwort (ohne Fable)'
        : 'noch keine Plan-Daten'
  return `Quelle: ${from}${when === undefined ? '' : `, ${when}`}` + (snapshot.problem === undefined ? '' : ` · ${snapshot.problem}`)
}

/** Each bar's line in `/hud`: what it stands for and the exact figures. */
export type Titles = { hearts: string; armor: string; food: string; air: string; xp: string }

export function titlesOf(snapshot: HudSnapshot, now: number): Titles {
  const source = sourceLine(snapshot, now)
  const context = snapshot.context
  const xp =
    context?.percent === undefined
      ? 'XP = Kontextfenster: noch keine Antwort in diesem Fenster'
      : `XP = Kontextfenster: ${percent(context.percent)} belegt` +
        (context.tokens === undefined ? '' : ` (${tokens(context.tokens)} von ${tokens(context.window)} Tokens)`)
  return {
    hearts: `Herzen = Wochenlimit (alle Modelle): ${limitLine(snapshot.week, now)}\n${source}`,
    armor: `Rüstung = Fable-Wochenlimit: ${limitLine(snapshot.fable, now)}\n${source}`,
    food: `Hunger = Sitzungslimit (5 Std.): ${limitLine(snapshot.session, now)}\n${source}`,
    air: snapshot.air === undefined ? '' : `Luft = ${snapshot.air.model}-Wochenlimit: ${limitLine(snapshot.air, now)}\n${source}`,
    xp,
  }
}

/** One column beside the desktop HUD: a label over its figure over a detail (the reset, the tokens). */
export type HudColumn = { key: string; label: string; value: string; detail: string }

const thousands = (value: number) => (value >= 1000 ? `${Math.round(value / 1000)}k` : String(Math.round(value)))

const limitColumn = (key: string, label: string, limit: HudLimit | undefined, now: number): HudColumn[] =>
  limit === undefined ? [] : [{ key, label, value: `${Math.round(limit.used)} %`, detail: resetText(limit.resetsAt, now) ?? '' }]

/**
 * The columns in reading order: the session first (it runs out soonest), then the weekly windows,
 * the other model while it is in use, and the context last, as the XP bar closes the HUD.
 * A window without a reading has no column.
 */
export function columnsOf(snapshot: HudSnapshot, now: number): HudColumn[] {
  const context = snapshot.context
  return [
    ...limitColumn('session', 'Sitzung', snapshot.session, now),
    ...limitColumn('week', 'Woche', snapshot.week, now),
    ...limitColumn('fable', 'Fable', snapshot.fable, now),
    ...(snapshot.air === undefined ? [] : limitColumn('air', snapshot.air.model, snapshot.air, now)),
    ...(context?.percent === undefined
      ? []
      : [
          {
            key: 'context',
            label: 'Kontext',
            value: `${Math.round(context.percent)} %`,
            detail: context.tokens === undefined ? '' : `${thousands(context.tokens)} von ${thousands(context.window)}`,
          },
        ]),
  ]
}

const ON_OFF = (value: boolean) => (value ? 'an' : 'aus')

const TERMINAL_WORDS: Record<HudPrefs['terminal'], string> = { compact: 'kompakt', status: 'Statuszeile', off: 'aus' }

const NUMBER_WORDS: Record<HudPrefs['numbers'], string> = { off: 'aus', short: 'kurz', full: 'voll' }

/** What `/hud` prints: every figure with its meaning, the settings, and the commands. */
export function card(snapshot: HudSnapshot | null, prefs: HudPrefs, now: number): string {
  const lines = ['Minecraft-HUD']
  if (snapshot === null) {
    lines.push('Noch keine Daten.')
  } else {
    const titles = titlesOf(snapshot, now)
    lines.push(
      `♥ ${titles.hearts.split('\n')[0]}`,
      `◆ ${titles.armor.split('\n')[0]}`,
      `● ${titles.food.split('\n')[0]}`,
      snapshot.air === undefined
        ? '○ Luft = ein weiteres Modell-Wochenlimit (z. B. Sonnet): erscheint erst, wenn du es nutzt'
        : `○ ${titles.air.split('\n')[0]}`,
      `✦ ${titles.xp}`,
      sourceLine(snapshot, now),
    )
  }
  lines.push(
    '',
    `Einstellungen: HUD hier ${ON_OFF(prefs.isEnabled)}${prefs.isRepoSetting ? ' (für dieses Repo gesetzt)' : ''}` +
      ` · Terminal ${TERMINAL_WORDS[prefs.terminal]} · Größe ${String(prefs.scale).replace('.', ',')}` +
      ` · Zahlen ${NUMBER_WORDS[prefs.numbers]} · Warnungen ${ON_OFF(prefs.hasWarnings)}` +
      ` · Abfrage alle ${prefs.refreshMinutes} Min.`,
    'Befehle: /hud an|aus · /hud global an|aus · /hud terminal kompakt|status|aus · /hud größe auto|1|1.5|2|3' +
      ' · /hud zahlen aus|kurz|voll · /hud warnungen an|aus · /hud refresh · /hud reset',
  )
  return lines.join('\n')
}
