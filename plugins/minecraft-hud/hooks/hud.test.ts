import { describe, expect, mock, test } from 'claude-code/testing'

import { HUD_HEIGHT, HUD_WIDTH, bandWidth, columnWidth, drawColumn, drawHud, layoutBand, textWidth } from './desktop'
import { fold, statusText, terminalBand } from './terminal'
import { columnsOf, resetText } from './text'
import { halvesLeft, liveOf, merge, parsePlan, planResultOf } from './usage'

const NOW = Date.parse('2026-10-05T10:00:00Z')
const IN_2H = '2026-10-05T12:13:00Z'
const IN_3D = '2026-10-08T09:00:00Z'

/** The endpoint's answer as the community has seen it: legacy windows, and the `limits` list. */
const ENDPOINT_BODY = {
  five_hour: { utilization: 41, resets_at: IN_2H },
  seven_day: { utilization: 32, resets_at: IN_3D },
  seven_day_opus: null,
  seven_day_sonnet: null,
  limits: [
    { kind: 'session', percent: 41, resets_at: IN_2H, scope: null, is_active: false },
    { kind: 'weekly_all', percent: 32, resets_at: IN_3D, scope: null, is_active: false },
    { kind: 'weekly_scoped', percent: 43, resets_at: IN_3D, scope: { model: { id: null, display_name: 'Fable' } }, is_active: true },
    { kind: 'weekly_scoped', percent: 7, resets_at: IN_3D, scope: { model: { id: null, display_name: 'Sonnet' } }, is_active: false },
  ],
}

describe('usage', () => {
  test('reads the limits list: session, week, Fable and Sonnet', () => {
    const reading = parsePlan(ENDPOINT_BODY)
    expect(reading.session).toEqual({ used: 41, resetsAt: IN_2H })
    expect(reading.week).toEqual({ used: 32, resetsAt: IN_3D })
    expect(reading.models.Fable).toEqual({ used: 43, resetsAt: IN_3D })
    expect(reading.models.Sonnet).toEqual({ used: 7, resetsAt: IN_3D })
  })

  test('falls back to the older top-level windows', () => {
    const reading = parsePlan({ five_hour: { utilization: 12.5, resets_at: IN_2H }, seven_day_overage_included: { utilization: 8.2 } })
    expect(reading.session?.used).toBe(12.5)
    expect(reading.models.Fable?.used).toBe(8.2)
    expect(parsePlan('nonsense').models).toEqual({})
  })

  test('names a refusal and a throttle instead of throwing', () => {
    expect(planResultOf(429, '').problem).toContain('429')
    expect(planResultOf(401, '').retryInMs).toBe(30 * 60_000)
    expect(planResultOf(200, '{').problem).toContain('unlesbar')
    expect(planResultOf(200, JSON.stringify(ENDPOINT_BODY)).reading?.week?.used).toBe(32)
  })

  test('rounds health up, as the game does', () => {
    expect(halvesLeft({ used: 0 })).toBe(20)
    expect(halvesLeft({ used: 32 })).toBe(14)
    expect(halvesLeft({ used: 99.9 })).toBe(1)
    expect(halvesLeft({ used: 100 })).toBe(0)
  })

  test('merges: Fable is armour, Sonnet is air, a passed reset refills, a drop hurts', () => {
    const plan = { at: NOW - 60_000, reading: parsePlan(ENDPOINT_BODY) }
    const live = liveOf({ startedAt: 0, context: { window: 200_000, tokens: 84_000, percent: 42 }, rateLimits: [] }, 0)
    const first = merge(plan, live, null, NOW)
    expect(first.fable?.used).toBe(43)
    expect(first.air).toEqual({ used: 7, resetsAt: IN_3D, model: 'Sonnet' })
    expect(first.source).toBe('endpoint')
    const later = liveOf({ startedAt: 0, context: live.context ?? { window: 1 }, rateLimits: [{ kind: 'seven_day', percentUsed: 40, resetsAt: IN_3D }] }, NOW)
    const second = merge(plan, later, first, NOW)
    expect(second.week?.used).toBe(40)
    expect(second.hurtAt).toBe(NOW)
    expect(second.hurtFrom).toBe(14)
    const afterReset = merge(plan, live, first, Date.parse(IN_2H) + 1)
    expect(afterReset.session).toEqual({ used: 0 })
  })
})

describe('drawing', () => {
  const snapshot = merge(
    { at: NOW, reading: parsePlan(ENDPOINT_BODY) },
    liveOf({ startedAt: 0, context: { window: 200_000, tokens: 84_000, percent: 42 }, rateLimits: [] }, 0),
    null,
    NOW,
  )
  let seed = 1
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const RESET = /^Reset ((Mo|Di|Mi|Do|Fr|Sa|So) )?\d\d:\d\d$/

  test('resets read as local clock times, rounded to the minute', () => {
    expect(resetText(IN_2H, NOW)).toMatch(/^Reset \d\d:\d\d$/)
    expect(resetText(IN_3D, NOW)).toMatch(/^Reset (Mo|Di|Mi|Do|Fr|Sa|So) \d\d:\d\d$/)
    expect(resetText('2026-10-06T21:59:59.570426+00:00', NOW)).toBe(resetText('2026-10-06T22:00:00+00:00', NOW))
    expect(resetText(undefined, NOW)).toBeUndefined()
  })

  test('one column per figure, in reading order, as words', () => {
    const columns = columnsOf(snapshot, NOW)
    expect(columns.map(column => column.label)).toEqual(['Sitzung', 'Woche', 'Fable', 'Sonnet', 'Kontext'])
    expect(columns.map(column => column.value)).toEqual(['41 %', '32 %', '43 %', '7 %', '42 %'])
    expect(columns[0]?.detail).toMatch(RESET)
    expect(columns[4]?.detail).toBe('84k von 200k')
  })

  test('the HUD SVG is the vanilla layout, transparent, the level outlined', () => {
    const hud = drawHud(snapshot, { scale: 2, now: NOW, random })
    expect(hud.width).toBe(HUD_WIDTH * 2)
    expect(hud.height).toBe(HUD_HEIGHT * 2)
    expect(hud.svg.length).toBeLessThan(131_072)
    expect(hud.svg).not.toContain('<title>')
    expect(hud.svg).toContain('href="#lv"')
    expect(hud.alt).toBe('Minecraft-HUD: Herzen 7 von 10, Rüstung 6 von 10, Hunger 6 von 10, Luft 9 von 10, XP-Level 42')
  })

  test('a column keeps the width of its widest form, so the band does not shift', () => {
    const [session] = columnsOf(snapshot, NOW)
    expect(session).toBeDefined()
    if (session === undefined) return
    const later = { ...session, value: '100 %', detail: 'Reset Mi 00:00' }
    expect(columnWidth(later)).toBe(columnWidth(session))
    expect(drawColumn(session, 1.5).width).toBe(columnWidth(session) * 1.5)
    expect(textWidth('Reset')).toBe(27)
  })

  test('a wide band gets scale 2 and everything; a narrower one 1.5; a narrow one gives up by rank', () => {
    const prefs = { scale: 'auto', numbers: 'full' } as const
    const all = columnsOf(snapshot, NOW)
    const wide = layoutBand(snapshot, prefs, { now: NOW, random, bodyColumns: Math.ceil(bandWidth(all, 2) / 7.8) })
    expect(wide.scale).toBe(2)
    expect(wide.columns).toHaveLength(5)
    const middle = layoutBand(snapshot, prefs, { now: NOW, random, bodyColumns: 100 })
    expect(middle.scale).toBe(1.5)
    const narrow = layoutBand(snapshot, prefs, { now: NOW, random, bodyColumns: 60 })
    expect(narrow.scale).toBe(1.5)
    expect(narrow.columns.map(column => column.alt.split(' ')[0])).toEqual(['Sitzung', 'Kontext'])
    const fixed = layoutBand(snapshot, { scale: 3, numbers: 'off' }, { now: NOW, random, bodyColumns: 200 })
    expect(fixed.scale).toBe(3)
    expect(fixed.columns).toHaveLength(0)
  })

  test('low health jiggles and an empty session starves', () => {
    const low = { ...snapshot, week: { used: 85 }, session: { used: 100 } }
    const hud = drawHud(low, { scale: 1, now: NOW, random })
    expect(hud.svg).toContain('animateTransform')
    expect(hud.svg).toContain('href="#feh"')
  })

  test('the terminal band: bars left, words right, the most important words first', () => {
    const wide = terminalBand(snapshot, 140, NOW, true)
    expect(fold(wide.left).map(segment => segment.text).join('')).toContain('♥♥♥♥♥♥♥♡♡♡')
    expect(wide.right[0]?.text).toMatch(/^Sitzung 41 % · Reset \d\d:\d\d   Woche 32 %   Fable 43 %   Sonnet 7 %   Kontext 42 %$/)
    const narrow = terminalBand(snapshot, 90, NOW, true)
    expect(narrow.right[0]?.text).toMatch(/^Sitzung 41 % · Reset \d\d:\d\d$/)
    const tiny = terminalBand(snapshot, 40, NOW, true)
    expect(tiny.left).toHaveLength(0)
    expect(statusText(snapshot, NOW)).toMatch(/^Sitzung 41 % · Reset \d\d:\d\d · Woche 32 % · Fable 43 % · Sonnet 7 % · Kontext 42 %$/)
  })
})

const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} }

test('the band draws on every surface the session can show', { timeoutMs: 10_000 }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.repo', () => ({ value: { root: '/tmp/repo', remote: null, internal: false, name: null } }))
  on('session.root', () => ({ value: '/tmp/repo' }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200_000, tokens: 84_000, percent: 42 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 41, resetsAt: IN_2H }],
    },
  }))
  on('session.authorize', () => ({ value: { handle: 'test-handle', kind: 'bearer' } }))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(ENDPOINT_BODY) } }))
  on('command.register', () => ({ value: { command: 'hud' } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  // the engine's own band, beneath the plugin: empty here
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ children: [] }))
  await $.session.start({ cwd: '/tmp/repo', surface: 'desktop', isInteractive: true })

  const desktop = await $.ui.mount({ plugin: 'minecraft-hud', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  const svg = await desktop.find({ type: 'Svg' })
  expect(String(svg?.props.source)).toContain('<svg')
  expect(svg?.props.isInteractive).toBeUndefined()
  // the HUD first, then one image per column; at 100 cells the other model's column is given up
  const images = await desktop.findAll({ type: 'Svg' })
  expect(images.map(image => String(image.props.alt).split(' ')[0])).toEqual(['Minecraft-HUD:', 'Sitzung', 'Woche', 'Fable', 'Kontext'])
  await desktop.unmount()

  const terminal = await $.ui.mount({ plugin: 'minecraft-hud', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await terminal.find({ type: 'Text', text: /♥/ })).toBeDefined()
  await terminal.unmount()

  const off = await $.command.run({ command: 'hud', args: 'aus', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(off.text).toContain('HUD in diesem Repo aus')
  const hidden = await $.ui.mount({ plugin: 'minecraft-hud', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await hidden.find({ type: 'Svg' })).toBeUndefined()
  await hidden.unmount()
})
