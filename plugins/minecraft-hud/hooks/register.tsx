import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { HudLimit, HudNumbers, HudPrefs, HudScale, HudSnapshot, HudTerminalStyle } from '../types'
import { layoutBand } from './desktop'
import { fold, statusText, terminalBand } from './terminal'
import type { Segment } from './terminal'
import { card, percent, until } from './text'
import { USAGE_URL, halvesLeft, liveOf, merge, planResultOf } from './usage'
import type { LiveReading, PlanCache, PlanResult } from './usage'

const snapshotAtom = atom({ plugin: 'minecraft-hud', key: 'snapshot' } as const, null)
const prefsAtom = atom({ plugin: 'minecraft-hud', key: 'prefs' } as const, null)

const MINUTE = 60_000
const BLINK_MS = 1100
const WAVE_MS = 3000
/** From this share used of a plan window on, the HUD warns once per window. */
const WARN_AT = 90

const TERMINAL_STYLES: readonly HudTerminalStyle[] = ['compact', 'status', 'off']
const NUMBER_MODES: readonly HudNumbers[] = ['off', 'short', 'full']
const SCALES: readonly HudScale[] = ['auto', 1, 1.5, 2, 3]

/** What `/hud` keeps for every repository: the global overrides of the plugin's options. */
type StoredPrefs = {
  isEnabled?: boolean
  terminal?: HudTerminalStyle
  scale?: HudScale
  numbers?: HudNumbers
  hasWarnings?: boolean
}

type Store = Record<string, unknown>

const isRecord = (value: unknown): value is Store => typeof value === 'object' && value !== null && !Array.isArray(value)

const storedPrefsOf = (value: unknown): StoredPrefs => (isRecord(value) ? (value as StoredPrefs) : {})

const reposOf = (value: unknown): Record<string, { isEnabled: boolean }> =>
  isRecord(value) ? (value as Record<string, { isEnabled: boolean }>) : {}

const planOf = (value: unknown): PlanCache | undefined =>
  isRecord(value) && typeof value.at === 'number' ? (value as PlanCache) : undefined

const pickOne = <T,>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

// Module state, started over by a reload: the plugin's options, the session's own figures (whose
// age is unknown after a reload, so the shared endpoint reading wins until the next turn), and
// whether an endpoint read is under way.
let options: PluginOptions = {}
let live: LiveReading = { at: 0, models: {} }
let isFetching = false
/** What the band last drew, or why it could not, for `/hud debug`. */
let lastDrawn: { at: number; surface: string; images: number; scale: number; columns: number } | undefined
let lastDrawError: string | undefined

async function loadPrefs($: EngineInterface): Promise<HudPrefs> {
  const repo = (await $.session.repo())?.root ?? (await $.session.root())
  const stored = storedPrefsOf(await $.store.get('prefs'))
  const perRepo = reposOf(await $.store.get('repos'))[repo]
  const option = String(options.desktop_scale ?? 'auto')
  const scale = option === 'auto' ? 'auto' : Number(option.replace(',', '.'))
  return {
    isEnabled: perRepo?.isEnabled ?? stored.isEnabled ?? true,
    isRepoSetting: perRepo !== undefined,
    repo,
    terminal: pickOne(stored.terminal ?? options.terminal_style, TERMINAL_STYLES, 'compact'),
    scale: pickOne(stored.scale ?? scale, SCALES, 'auto'),
    numbers: pickOne(stored.numbers ?? options.numbers, NUMBER_MODES, 'full'),
    hasWarnings: stored.hasWarnings ?? options.warnings !== false,
    refreshMinutes: Math.min(60, Math.max(2, Number(options.refresh_minutes ?? 5) || 5)),
  }
}

async function savePrefs($: EngineInterface, change: (stored: StoredPrefs) => StoredPrefs) {
  await $.store.set('prefs', change(storedPrefsOf(await $.store.get('prefs'))))
}

async function saveRepo($: EngineInterface, repo: string, isEnabled: boolean | undefined) {
  const repos = reposOf(await $.store.get('repos'))
  if (isEnabled === undefined) {
    delete repos[repo]
  } else {
    repos[repo] = { isEnabled }
  }
  await $.store.set('repos', repos)
}

/** Asks the usage endpoint with the session's own login: the token stays with the engine. */
async function fetchPlan($: EngineInterface): Promise<PlanResult> {
  let auth
  try {
    auth = await $.session.authorize()
  } catch {
    return { problem: 'Login der Sitzung nicht abrufbar', retryInMs: 30 * MINUTE }
  }
  if (auth === null || auth.kind !== 'bearer') {
    return { problem: 'kein claude.ai-Login in dieser Sitzung', retryInMs: 30 * MINUTE }
  }
  try {
    const response = await $.http.fetch(USAGE_URL, {
      auth: auth.handle,
      headers: { accept: 'application/json', 'anthropic-beta': 'oauth-2025-04-20' },
    })
    return planResultOf(response.status, response.text)
  } catch {
    return { problem: 'Usage-Endpoint nicht erreichbar', retryInMs: 2 * MINUTE }
  }
}

/** The status line entry, for terminal sessions set to `status`; cleared everywhere else. */
async function pinStatus($: EngineInterface, snapshot: HudSnapshot, prefs: HudPrefs | null, now: number) {
  const isWanted = prefs?.isEnabled === true && prefs.terminal === 'status'
  const isTerminal = isWanted && (await $.session.surfaces()).includes('terminal')
  $.ui.status(isTerminal ? statusText(snapshot, now) : undefined)
}

/** One toast per plan window once it passes WARN_AT, worded as the game would. */
async function warn($: EngineInterface, snapshot: HudSnapshot, now: number) {
  const resetNote = (limit: HudLimit) => {
    const reset = until(limit.resetsAt, now)
    return reset === undefined ? '' : ` (Reset ${reset})`
  }
  const checks: [string, HudLimit | undefined, (limit: HudLimit) => string][] = [
    ['session', snapshot.session, limit => `Dein Hunger-Balken ist fast leer: Sitzungslimit ${percent(limit.used)} genutzt${resetNote(limit)}`],
    ['week', snapshot.week, limit => `Nur noch ${String(halvesLeft(limit) / 2).replace('.', ',')} Herzen: Wochenlimit ${percent(limit.used)} genutzt${resetNote(limit)}`],
    ['fable', snapshot.fable, limit => `Deine Rüstung bricht gleich: Fable-Limit ${percent(limit.used)} genutzt${resetNote(limit)}`],
  ]
  const stored = await $.store.get('warned')
  const warned: Record<string, string> = isRecord(stored) ? (stored as Record<string, string>) : {}
  let isChanged = false
  for (const [key, limit, words] of checks) {
    const window = limit?.resetsAt ?? 'unbekannt'
    if (limit !== undefined && limit.used >= WARN_AT && warned[key] !== window) {
      $.ui.toast(words(limit), { timeoutMs: 8000 })
      warned[key] = window
      isChanged = true
    }
  }
  if (isChanged) {
    await $.store.set('warned', warned)
  }
}

/** Merges what is known into the snapshot the band draws; then the status line, the warnings, the blinks. */
async function publish($: EngineInterface, cache?: PlanCache) {
  const now = await $.clock.now()
  const plan = cache ?? planOf(await $.store.get('plan'))
  const previous = await read($, snapshotAtom)
  const snapshot = merge(plan, live, previous, now)
  await update($, snapshotAtom, () => snapshot)
  const prefs = await read($, prefsAtom)
  await pinStatus($, snapshot, prefs, now)
  if (prefs?.isEnabled === true && prefs.hasWarnings) {
    await warn($, snapshot, now)
  }
  // draw again once the damage blink or the regeneration wave has played, so each plays once
  if (snapshot.hurtAt === now) {
    $.clock.after(BLINK_MS + 100, () => $.ui.invalidate('ui.render'))
  }
  if (snapshot.healAt === now) {
    $.clock.after(WAVE_MS + 100, () => $.ui.invalidate('ui.render'))
  }
}

/**
 * Reads the usage endpoint when the shared reading is older than `maxAgeMs` (every session on the
 * machine shares one through `$.store`, so several sessions ask no more often than one), else draws
 * again from the reading there is. `maxAgeMs` 0 asks now, waiting out no back-off.
 */
async function refresh($: EngineInterface, maxAgeMs: number) {
  const prefs = await read($, prefsAtom)
  if (prefs === null || !prefs.isEnabled) {
    return
  }
  const now = await $.clock.now()
  const cache = planOf(await $.store.get('plan'))
  const isFresh = cache !== undefined && now - cache.at < maxAgeMs
  const isWaiting = maxAgeMs > 0 && cache?.retryAt !== undefined && cache.retryAt > now
  if (isFetching || isFresh || isWaiting) {
    await publish($, cache)
    return
  }
  isFetching = true
  try {
    const result = await fetchPlan($)
    const at = await $.clock.now()
    const next: PlanCache =
      result.reading !== undefined
        ? { at, reading: result.reading, shape: result.shape }
        : { at: cache?.at ?? at, reading: cache?.reading, shape: cache?.shape, problem: result.problem, retryAt: at + (result.retryInMs ?? 5 * MINUTE) }
    await $.store.set('plan', next)
    await publish($, next)
  } finally {
    isFetching = false
  }
}

/** Runs work no hook waits for; a failure goes to the debug log, never to an unhandled rejection. */
function background($: EngineInterface, work: Promise<unknown>) {
  work.catch((error: unknown) => $.ui.log(`minecraft-hud: ${String(error)}`, { to: 'debug' }))
}

/** Everything a fresh session needs, and a /clear, /resume or /branch too (they empty $.state). */
async function setup($: EngineInterface) {
  const prefs = await loadPrefs($)
  await update($, prefsAtom, () => prefs)
  live = { ...liveOf(await $.session.usage(), 0), at: 0 }
  await publish($)
  background($, refresh($, prefs.refreshMinutes * MINUTE))
}

/** The timer's beat: a new endpoint read when the shared one is due, else a redraw for the countdowns. */
async function beat($: EngineInterface) {
  const prefs = await read($, prefsAtom)
  if (prefs?.isEnabled === true) {
    await refresh($, prefs.refreshMinutes * MINUTE)
  }
}

/** Takes the session's own figures, pushed after every main-thread turn and whenever a window moves a point. */
async function measure($: EngineInterface, usage: Parameters<typeof liveOf>[0]) {
  const now = await $.clock.now()
  const fresh = liveOf(usage, now)
  live = usage.rateLimits.length > 0 ? fresh : { ...live, context: fresh.context }
  await publish($)
}

/** After a main-thread turn: Fable has no response header of its own, so read the endpoint (sooner after a Fable turn). */
async function afterTurn($: EngineInterface, model: string | undefined) {
  const name = model ?? (await $.session.model())
  await refresh($, (/fable/i.test(name) ? 1 : 2) * MINUTE)
}

const HELP = 'Befehle: /hud · /hud an|aus (dieses Repo) · /hud global an|aus · /hud terminal kompakt|status|aus · /hud größe 1|1.5|2|3 · /hud zahlen aus|kurz|voll · /hud warnungen an|aus · /hud refresh · /hud reset'

const TERMINAL_WORDS: Record<string, HudTerminalStyle> = { kompakt: 'compact', compact: 'compact', status: 'status', statuszeile: 'status', aus: 'off', off: 'off' }
const NUMBER_WORDS: Record<string, HudNumbers> = { aus: 'off', off: 'off', kurz: 'short', short: 'short', voll: 'full', full: 'full' }
const isOn = (word: string | undefined) => ['an', 'ein', 'on', 'enable'].includes(word ?? '')
const isOff = (word: string | undefined) => ['aus', 'off', 'disable'].includes(word ?? '')

/** `/hud` and its words; answers the line the transcript shows. */
async function runCommand($: EngineInterface, args: string): Promise<string> {
  const [first, second] = args.trim().toLowerCase().split(/\s+/).filter(word => word !== '')
  const prefs = (await read($, prefsAtom)) ?? (await loadPrefs($))
  let reply: string
  if (first === undefined || first === 'status' || first === 'info') {
    return card(await read($, snapshotAtom), prefs, await $.clock.now())
  } else if (first === 'hilfe' || first === 'help') {
    return HELP
  } else if (first === 'debug') {
    const plan = planOf(await $.store.get('plan'))
    const now = await $.clock.now()
    const age = (at: number | undefined) => (at === undefined ? '–' : `vor ${Math.round((now - at) / 1000)} s`)
    return [
      `Endpoint: ${plan === undefined ? 'noch nie gefragt' : `zuletzt gelesen ${age(plan.reading === undefined ? undefined : plan.at)}`}`,
      `Felder: ${plan?.shape ?? '–'}`,
      `Problem: ${plan?.problem ?? 'keins'}${plan?.retryAt !== undefined && plan.retryAt > now ? ` · nächster Versuch in ${Math.round((plan.retryAt - now) / 1000)} s` : ''}`,
      `Sitzungswerte: ${live.at === 0 ? 'unbekannten Alters' : age(live.at)} · ${[live.session && 'five_hour', live.week && 'seven_day', ...Object.keys(live.models)].filter(Boolean).join(', ') || 'keine Limits'}`,
      `Repo-Schlüssel: ${prefs.repo}`,
      lastDrawn === undefined
        ? 'Band: noch nicht gezeichnet'
        : `Band: ${age(lastDrawn.at)} auf ${lastDrawn.surface} gezeichnet · ${lastDrawn.images} Bilder · Größe ${String(lastDrawn.scale).replace('.', ',')} · ${lastDrawn.columns} Zellen breit`,
      `Band-Fehler: ${lastDrawError ?? 'keiner'}`,
    ].join('\n')
  } else if (isOn(first) || isOff(first)) {
    await saveRepo($, prefs.repo, isOn(first))
    reply = `HUD in diesem Repo ${isOn(first) ? 'an' : 'aus'} (${prefs.repo}). Gilt für jede Sitzung hier; /hud reset nimmt es zurück.`
  } else if (first === 'global' && (isOn(second) || isOff(second))) {
    await savePrefs($, stored => ({ ...stored, isEnabled: isOn(second) }))
    reply = `HUD global ${isOn(second) ? 'an' : 'aus'}. Repos mit eigenem /hud an|aus behalten ihre Einstellung.`
  } else if (first === 'terminal') {
    const style = TERMINAL_WORDS[second ?? '']
    if (style === undefined) {
      return 'Terminal-Darstellung: /hud terminal kompakt | status | aus'
    }
    await savePrefs($, stored => ({ ...stored, terminal: style }))
    reply = {
      compact: 'Terminal: eine farbige Zeile über dem Prompt.',
      status: 'Terminal: nur Text in der Statuszeile unter dem Prompt.',
      off: 'Terminal: aus. Die Desktop-App zeigt das HUD weiter.',
    }[style]
  } else if (['größe', 'groesse', 'grösse', 'scale', 'size'].includes(first)) {
    const scale: HudScale | undefined = second === 'auto' ? 'auto' : SCALES.find(one => one === Number((second ?? '').replace(',', '.')))
    if (scale === undefined) {
      return 'Größe in der Desktop-App: /hud größe auto | 1 | 1.5 | 2 | 3 (CSS-Pixel je Sprite-Pixel; auto: 2, wenn alles Platz hat, sonst 1,5)'
    }
    await savePrefs($, stored => ({ ...stored, scale }))
    reply =
      scale === 'auto'
        ? 'Größe auto: 2, wenn HUD und alle Spalten mit Details Platz haben, sonst 1,5.'
        : `Größe ${String(scale).replace('.', ',')}: das HUD ist jetzt ${Math.round(182 * scale)} × ${Math.round(28 * scale)} px groß.`
  } else if (first === 'zahlen' || first === 'numbers') {
    const mode = NUMBER_WORDS[second ?? '']
    if (mode === undefined) {
      return 'Zahlen neben dem HUD: /hud zahlen aus | kurz | voll'
    }
    await savePrefs($, stored => ({ ...stored, numbers: mode }))
    reply = {
      off: 'Zahlen aus: nur das HUD (/hud zeigt die Werte).',
      short: 'Zahlen kurz: die Tabelle neben dem HUD ohne Reset-Zeiten und Tokens.',
      full: 'Zahlen voll: die Tabelle mit Reset-Zeiten (⌛) und Tokens.',
    }[mode]
  } else if (first === 'warnungen' || first === 'warnings') {
    if (!isOn(second) && !isOff(second)) {
      return 'Warnungen ab 90 %: /hud warnungen an | aus'
    }
    await savePrefs($, stored => ({ ...stored, hasWarnings: isOn(second) }))
    reply = `Warnungen ${isOn(second) ? 'an' : 'aus'}.`
  } else if (first === 'refresh' || first === 'aktualisieren' || first === 'neu') {
    await refresh($, 0)
    return card(await read($, snapshotAtom), prefs, await $.clock.now())
  } else if (first === 'reset') {
    await $.store.delete('prefs')
    await saveRepo($, prefs.repo, undefined)
    reply = 'Zurückgesetzt: es gelten wieder die Plugin-Optionen, und das HUD ist hier an.'
  } else {
    return `Unbekannt: /hud ${args.trim()}\n${HELP}`
  }
  const fresh = await loadPrefs($)
  await update($, prefsAtom, () => fresh)
  await refresh($, fresh.refreshMinutes * MINUTE)
  await publish($)
  return reply
}

export const register: Register = (on, pluginOptions) => {
  options = pluginOptions

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'hud',
      description: 'Minecraft-HUD: Werte, pro Repo an/aus, Terminal, Größe, Zahlen',
      argumentHint: '[an|aus|terminal …|größe …|zahlen …|refresh|reset]',
      immediate: true,
    })
    await setup($)
    $.clock.every(MINUTE, () => background($, beat($)))
    return next(e)
  })

  // /clear, /resume and /branch empty $.state without a new session.start
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await setup($)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await measure($, { startedAt: 0, context: e.context, rateLimits: e.rateLimits, cost: e.cost })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      background($, afterTurn($, e.usage?.model))
    }
    return done
  })

  on('command.run', { command: 'hud' }, async ($, e) => ({ text: await runCommand($, e.args) }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const prefs = await read($, prefsAtom)
    const snapshot = await read($, snapshotAtom)
    if (prefs === null || snapshot === null || !prefs.isEnabled) {
      return next(e)
    }
    const now = await $.clock.now()
    if (e.surface === 'terminal') {
      if (prefs.terminal !== 'compact') {
        return next(e)
      }
      const { Box, Text } = $.ui.resolve(e)
      const band = terminalBand(snapshot, e.props.bodyColumns, now, prefs.numbers !== 'off')
      const theirs = await next(e)
      const texts = (segments: Segment[]) =>
        fold(segments).map(segment => (
          <Text
            {...(segment.color === undefined ? {} : { color: segment.color })}
            {...(segment.isBold === true ? { bold: true } : {})}
            {...(segment.isDim === true ? { dimColor: true } : {})}
          >
            {segment.text}
          </Text>
        ))
      return (
        <Box flexDirection="column" width="100%">
          <Box flexDirection="row" justifyContent="space-between" width="100%">
            <Box flexDirection="row">{texts(band.left)}</Box>
            <Box flexDirection="row">{texts(band.right)}</Box>
          </Box>
          {theirs}
        </Box>
      )
    }
    const { Box, Svg } = $.ui.resolve(e)
    let band
    try {
      band = layoutBand(snapshot, prefs, { now, random: Math.random, bodyColumns: e.props.bodyColumns })
      lastDrawError = undefined
    } catch (error) {
      lastDrawError = String(error)
      return next(e)
    }
    const drawings = [band.hud, ...band.columns]
    lastDrawn = { at: now, surface: e.surface, images: drawings.length, scale: band.scale, columns: e.props.bodyColumns }
    const theirs = await next(e)
    // Images, not interactive frames, so they stay transparent on every theme. Each one gets its
    // size: without it an image in a flex row can collapse to nothing. The row is as wide as the
    // band already, so space-between spreads the HUD and the columns across it.
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          {drawings.map(drawing => (
            <Svg source={drawing.svg} alt={drawing.alt} width={drawing.width} height={drawing.height} />
          ))}
        </Box>
        {theirs}
      </Box>
    )
  })
}
