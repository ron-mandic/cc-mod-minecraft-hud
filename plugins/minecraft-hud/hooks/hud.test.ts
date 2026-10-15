import { describe, expect, mock, test } from 'claude-code/testing'

import { HUD_HEIGHT, HUD_WIDTH, bandWidth, columnWidth, drawHud, layoutBand, textWidth } from './desktop'
import { fold, statusText, terminalBand } from './terminal'
import { card, columnsOf, resetClock, resetText, shortTokens, titlesOf } from './text'
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

  test('recognizes versioned Fable and Sonnet families without pinning a release', () => {
    for (const name of ['Fable', 'Claude Fable 6', 'claude-fable-6-1']) {
      const reading = parsePlan({ limits: [{ percent: 12, scope: { model: { display_name: name } } }] })
      expect(merge({ at: NOW, reading }, { at: 0, models: {} }, null, NOW).fable?.used).toBe(12)
    }
    const reading = parsePlan({ limits: [{ percent: 25, scope: { model: { id: 'claude-sonnet-6-1' } } }] })
    expect(merge({ at: NOW, reading }, { at: 0, models: {} }, null, NOW).air).toEqual({ used: 25, resetsAt: undefined, model: 'Sonnet' })
    // Old versioned cache keys and fresh header family names must merge by recency, not coexist.
    const updated = merge(
      { at: NOW - 1000, reading: { models: { 'Claude Fable 6': { used: 12 } } } },
      { at: NOW, models: { Fable: { used: 15 } } }, null, NOW,
    )
    expect(updated.fable?.used).toBe(15)
  })

  test('bubbles never fall back to Opus or an unknown family', () => {
    const modelSets: Record<string, { used: number; resetsAt?: string }>[] = [
      { Opus: { used: 42 } },
      { Opus: { used: 42 }, Sonnet: { used: 0 } },
      { Other: { used: 50 } },
      { Sonnet: { used: 12, resetsAt: new Date(NOW - 1).toISOString() } },
    ]
    for (const models of modelSets) {
      expect(merge({ at: NOW, reading: { models } }, { at: 0, models: {} }, null, NOW).air).toBeUndefined()
    }
    const reading = { models: { Opus: { used: 99 }, Sonnet: { used: 100 } } }
    expect(merge({ at: NOW, reading }, { at: 0, models: {} }, null, NOW).air?.used).toBe(100)
  })

  test('old readings become unknown, with fresh session readings preserved', () => {
    const live = { at: 0, models: {}, context: { window: 200_000, tokens: 84_000, percent: 42 } }
    const old = { at: NOW - 16 * 60_000, reading: parsePlan(ENDPOINT_BODY) }
    const stale = merge(old, live, null, NOW)
    expect(stale.session).toBeUndefined()
    expect(stale.week).toBeUndefined()
    expect(stale.fable).toBeUndefined()
    expect(stale.air).toBeUndefined()
    expect(stale.context?.percent).toBe(42)
    expect(stale.problem).toContain('15 Minuten')
    const fresh = merge(old, { ...live, at: NOW, session: { used: 8 } }, null, NOW)
    expect(fresh.session?.used).toBe(8)
    expect(fresh.week).toBeUndefined()
    const recovered = merge({ ...old, at: NOW }, live, stale, NOW)
    expect(recovered.week?.used).toBe(32)
    expect(recovered.problem).toBeUndefined()
    expect(recovered.healAt).toBeUndefined()
    const unknownAge = merge(undefined, { ...live, week: { used: 0 } }, null, NOW)
    expect(unknownAge.week).toBeUndefined()
    const expired = merge({ at: NOW, reading: { session: { used: 5, resetsAt: new Date(NOW - 1).toISOString() }, models: {} } }, live, null, NOW)
    expect(expired.session).toBeUndefined()
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
    expect(halvesLeft(undefined)).toBe(0)
    expect(halvesLeft({ used: 0 })).toBe(20)
    expect(halvesLeft({ used: 32 })).toBe(14)
    expect(halvesLeft({ used: 99.9 })).toBe(1)
    expect(halvesLeft({ used: 100 })).toBe(0)
  })

  test('merges: Fable is armour, Sonnet is air, a passed reset is unknown, a drop hurts', () => {
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
    expect(afterReset.session).toBeUndefined()
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
  const RESET = /^((Mo|Di|Mi|Do|Fr|Sa|So) )?\d\d:\d\d$/

  test('resets read as local clock times, rounded to the minute', () => {
    expect(resetText(IN_2H, NOW)).toMatch(/^Reset \d\d:\d\d$/)
    expect(resetText(IN_3D, NOW)).toMatch(/^Reset (Mo|Di|Mi|Do|Fr|Sa|So) \d\d:\d\d$/)
    expect(resetText('2026-10-06T21:59:59.570426+00:00', NOW)).toBe(resetText('2026-10-06T22:00:00+00:00', NOW))
    expect(resetText(undefined, NOW)).toBeUndefined()
    expect(resetClock(IN_2H, NOW)).toMatch(/^\d\d:\d\d$/)
    expect(resetClock(IN_3D, NOW)).toMatch(/^(Mo|Di|Mi|Do|Fr|Sa|So) \d\d:\d\d$/)
    expect(resetClock(undefined, NOW)).toBeUndefined()
    expect(resetClock('invalid', NOW)).toBeUndefined()
    expect(resetClock('2026-10-06T21:59:59.570426+00:00', NOW)).toBe(resetClock('2026-10-06T22:00:00+00:00', NOW))
  })

  test('one column per figure, in reading order, as words', () => {
    const columns = columnsOf(snapshot, NOW)
    expect(columns.map(column => column.label)).toEqual(['Sitzung', 'Woche', 'Fable', 'Sonnet', 'Kontext'])
    expect(columns.map(column => column.value)).toEqual(['41 %', '32 %', '43 %', '7 %', '42 %'])
    expect(columns[0]?.detail).toMatch(RESET)
    expect(columns[4]?.detail).toBe('84K / 200K')
    expect(columns.slice(0, 4).every(column => RESET.test(column.detail))).toBe(true)
    expect(titlesOf(snapshot, NOW).food).toContain('Reset ')
    expect(titlesOf(snapshot, NOW).xp).toContain('84.000 von 200.000 Tokens')
  })

  test('new chats keep context visible without borrowing another chats measurement', () => {
    const initial = { ...snapshot, air: undefined, context: { window: 1_000_000 } }
    const measured = { ...initial, context: { window: 1_000_000, tokens: 924_000, percent: 92 } }
    expect(columnsOf(initial, NOW).find(column => column.key === 'context')).toEqual({
      key: 'context', label: 'Kontext', value: '0 %', detail: '0 / 1M',
    })
    expect(columnsOf({ ...initial, context: undefined }, NOW).find(column => column.key === 'context')).toEqual({
      key: 'context', label: 'Kontext', value: '0 %', detail: '0 Tokens',
    })
    expect(columnsOf({ ...initial, context: { window: 1_000_000, tokens: 0, percent: 0 } }, NOW)
      .find(column => column.key === 'context')?.value).toBe('0 %')
    for (const bodyColumns of [86, 96, 130]) {
      const prefs = { scale: 1.5, numbers: 'full' } as const
      const first = layoutBand(initial, prefs, { now: NOW, random, bodyColumns })
      const later = layoutBand(measured, prefs, { now: NOW, random, bodyColumns })
      expect(first.columns.map(column => column.key)).toEqual(['session', 'week', 'fable', 'context'])
      expect(first.columnStarts).toEqual(later.columnStarts)
      expect(first.drawing.alt).toContain('Kontext 0 % 0 / 1M')
      expect(first.drawing.svg).not.toContain('href="#lv"')
    }
    const off = layoutBand(initial, { scale: 1.5, numbers: 'off' }, { now: NOW, random, bodyColumns: 100 })
    expect(off.columns).toHaveLength(0)
  })

  test('/hud is short and icon-free, with explanations only on explicit request', () => {
    const prefs = {
      isEnabled: true, isRepoSetting: false, repo: '/tmp/repo', terminal: 'compact',
      scale: 1.5, numbers: 'full', hasWarnings: true, refreshMinutes: 5,
    } as const
    const brief = card(snapshot, prefs, NOW)
    expect(brief.split('\n')).toHaveLength(5)
    expect(brief).toContain('Hunger (5 Std.): 41 % genutzt')
    expect(brief).toContain('Kontext: 42 % · 84K / 200K')
    expect(brief).not.toMatch(/[♥◆●○✦]/)
    expect(brief).not.toContain('Einstellungen:')
    expect(brief).not.toContain('Befehle:')
    expect(brief).not.toContain('Quelle:')
    const detailed = card(snapshot, prefs, NOW, true)
    expect(detailed).toContain('Einstellungen:')
    expect(detailed).toContain('84.000 von 200.000 Tokens')
    expect(detailed).not.toMatch(/[♥◆●○✦]/)
    const initial = { ...snapshot, air: undefined, context: { window: 1_000_000 } }
    const fresh = card(initial, prefs, NOW)
    expect(fresh.split('\n')).toHaveLength(4)
    expect(fresh).toContain('Kontext: 0 % · 0 / 1M')
    const missing = card({ ...initial, week: undefined, problem: 'Budgetdaten veraltet' }, prefs, NOW)
    expect(missing).toContain('Herzen (Woche): unbekannt')
    expect(missing).toContain('Daten: Budgetdaten veraltet')
    expect(card(snapshot, { ...prefs, isEnabled: false }, NOW)).toContain('HUD: aus')
    expect(card(null, prefs, NOW)).toBe('Noch keine Daten.')
  })

  test('tokens in short: K up to a million, then M', () => {
    expect(shortTokens(684)).toBe('684')
    expect(shortTokens(684_000)).toBe('684K')
    expect(shortTokens(999_600)).toBe('1M')
    expect(shortTokens(1_000_000)).toBe('1M')
    expect(shortTokens(1_500_000)).toBe('1,5M')
    const million = { ...snapshot, context: { window: 1_000_000, tokens: 684_000, percent: 68.4 } }
    const context = columnsOf(million, NOW).find(column => column.key === 'context')
    expect(context?.detail).toBe('684K / 1M')
    // the column reserves its widest form for this window, not for a 1000k one
    if (context !== undefined) {
      expect(columnWidth(context)).toBe(columnWidth({ ...context, detail: '999K / 1M' }))
      expect(columnWidth(context)).toBeLessThan(textWidth('684k von 1000k'))
    }
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
    const later = { ...session, value: '100 %', detail: 'Mi 00:00' }
    expect(columnWidth(later)).toBe(columnWidth(session))
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
    expect(narrow.columns.map(column => column.label)).toEqual(['Sitzung', 'Kontext'])
    // one image as wide as the band, the columns spread inside it
    expect(narrow.drawing.width).toBeLessThanOrEqual(60 * 7.8)
    expect(narrow.drawing.width).toBeGreaterThan(60 * 7.8 - 2)
    const fixed = layoutBand(snapshot, { scale: 3, numbers: 'off' }, { now: NOW, random, bodyColumns: 200 })
    expect(fixed.scale).toBe(3)
    expect(fixed.columns).toHaveLength(0)
  })

  test('one rule separates session from weekly budgets, never context', () => {
    const prefs = { scale: 'auto', numbers: 'full' } as const
    for (const reading of [
      snapshot,
      { ...snapshot, week: undefined },
      { ...snapshot, week: undefined, fable: undefined }, // Sonnet alone is still weekly
    ]) {
      const band = layoutBand(reading, prefs, { now: NOW, random, bodyColumns: 200 })
      const rules = [...band.drawing.svg.matchAll(/<rect x="(\d+)" y="1" width="1"/g)].map(match => Number(match[1]))
      expect(rules).toHaveLength(1)
      expect(band.drawing.svg).toContain('opacity="0.3"')
      expect(rules[0]).toBeGreaterThan(band.columnStarts[0]!)
      expect(rules[0]).toBeLessThan(band.columnStarts[1]!)
    }
    for (const reading of [
      { ...snapshot, session: undefined },
      { ...snapshot, week: undefined, fable: undefined, air: undefined },
    ]) {
      const band = layoutBand(reading, prefs, { now: NOW, random, bodyColumns: 200 })
      expect(band.drawing.svg).not.toContain('id="dv"')
    }
    const off = layoutBand(snapshot, { scale: 2, numbers: 'off' }, { now: NOW, random, bodyColumns: 100 })
    expect(off.drawing.svg).not.toContain('id="dv"')
  })
  test('all right-hand gaps stay compact at wide widths; only outer gaps grow', () => {
    for (const bodyColumns of [200, 260]) {
      const band = layoutBand(snapshot, { scale: 2, numbers: 'full' }, { now: NOW, random, bodyColumns })
      const gapAfter = (i: number) =>
        (band.columnStarts[i + 1]! - band.columnStarts[i]! - columnWidth(band.columns[i]!)) * band.scale
      expect(gapAfter(1)).toBe(24) // week -> Fable
      expect(gapAfter(2)).toBe(24) // Fable -> Sonnet
      expect(gapAfter(0)).toBeGreaterThan(gapAfter(1)) // session -> weekly
      expect(gapAfter(3)).toBe(24) // Sonnet -> context stays inside the same group
      expect(gapAfter(0)).toBeGreaterThanOrEqual(64)
    }
  })

  test('a screenshot-sized 1M band separates week from Fable without losing its reset', () => {
    const reading = {
      ...snapshot,
      air: undefined,
      context: { window: 1_000_000, tokens: 785_000, percent: 79 },
    }
    const band = layoutBand(reading, { scale: 'auto', numbers: 'full' }, { now: NOW, random, bodyColumns: 96 })
    expect(band.scale).toBe(1.5)
    expect(band.columns.map(column => column.key)).toEqual(['session', 'week', 'fable', 'context'])
    expect(band.columns[1]?.detail).toMatch(RESET)
    expect(band.columns[2]?.detail).toMatch(RESET)
    expect(band.columns[3]?.detail).toBe('785K / 1M')
    const gap = (band.columnStarts[2]! - band.columnStarts[1]! - columnWidth(band.columns[1]!)) * band.scale
    expect(gap).toBeGreaterThanOrEqual(24 - band.scale)
  })

  test('Fable stays evenly spaced inside the shared week/context group', () => {
    const reading = { ...snapshot, air: undefined }
    for (const bodyColumns of [96, 120, 200]) {
      const band = layoutBand(reading, { scale: 1.5, numbers: 'full' }, { now: NOW, random, bodyColumns })
      const week = band.columns.findIndex(column => column.key === 'week')
      const fable = band.columns.findIndex(column => column.key === 'fable')
      const context = band.columns.findIndex(column => column.key === 'context')
      expect(fable).toBe(week + 1)
      expect(context).toBe(fable + 1)
      const left = band.columnStarts[fable]! - band.columnStarts[week]! - columnWidth(band.columns[week]!)
      const right = band.columnStarts[context]! - band.columnStarts[fable]! - columnWidth(band.columns[fable]!)
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1)
      expect(left * band.scale).toBeGreaterThanOrEqual(24 - band.scale)
      expect(right * band.scale).toBe(24)
    }
  })

  test('the narrow session/Fable/context layout gives the divider more air than internal gaps', () => {
    const reading = {
      ...snapshot, air: undefined,
      session: { used: 0, resetsAt: IN_3D }, fable: { used: 0, resetsAt: IN_3D },
      context: { window: 1_000_000, tokens: 370_000, percent: 37 },
    }
    const band = layoutBand(reading, { scale: 1.5, numbers: 'full' }, { now: NOW, random, bodyColumns: 72 })
    expect(band.columns.map(column => column.key)).toEqual(['session', 'fable', 'context'])
    const internal = (band.columnStarts[2]! - band.columnStarts[1]! - columnWidth(band.columns[1]!)) * band.scale
    expect(internal).toBe(24)
    const rule = band.drawing.svg.match(/<rect x="(\d+)" y="1" width="1"/)
    expect(rule).toBeDefined()
    const ruleX = Number(rule?.[1])
    const session = band.columns[0]!
    const ink = Math.max(textWidth(session.label), textWidth(session.value), textWidth(session.detail)) + 1
    expect((ruleX - band.columnStarts[0]! - ink) * band.scale).toBeGreaterThan(internal)
    expect((band.columnStarts[1]! - ruleX - 1) * band.scale).toBeGreaterThan(internal)
  })
  test('responsive groups never overlap or leave an orphan divider', () => {
    for (const scale of [1.5, 'auto'] as const) {
      for (const numbers of ['full', 'short', 'off'] as const) {
        for (let bodyColumns = 30; bodyColumns <= 220; bodyColumns += 1) {
          if (scale !== 'auto' && bodyColumns * 7.8 < HUD_WIDTH * scale) continue
          const band = layoutBand(snapshot, { scale, numbers }, { now: NOW, random, bodyColumns })
          expect(band.drawing.width).toBeLessThanOrEqual(bodyColumns * 7.8 + 0.01)
          let end = HUD_WIDTH
          band.columns.forEach((column, i) => {
            expect(band.columnStarts[i]!).toBeGreaterThan(end)
            end = band.columnStarts[i]! + columnWidth(column)
          })
          expect(end * band.scale).toBeLessThanOrEqual(band.drawing.width + band.scale / 2 + 0.01)
          const hasSession = band.columns.some(column => column.key === 'session')
          const hasWeekly = band.columns.some(column => ['week', 'fable', 'air'].includes(column.key))
          expect(band.drawing.svg.includes('id="dv"')).toBe(hasSession && hasWeekly)
          band.columns.forEach((column, i) => {
            if (i === 0 || column.key === 'session') return
            const previous = band.columns[i - 1]!
            const gap = (band.columnStarts[i]! - band.columnStarts[i - 1]! - columnWidth(previous)) * band.scale
            if (previous.key === 'session') {
              expect(gap).toBeGreaterThanOrEqual((hasWeekly ? 64 : 32) - band.scale)
            } else {
              expect(gap).toBe(24)
            }
          })
        }
      }
    }
  })

  test('unknown budgets are unfilled, still and explicitly marked, unlike exhausted budgets', () => {
    const unknown = { ...snapshot, session: undefined, week: undefined, fable: undefined, air: undefined }
    const hud = drawHud(unknown, { scale: 1.5, now: NOW, random })
    expect(hud.svg).not.toContain('href="#hf"')
    expect(hud.svg).not.toContain('href="#ff"')
    expect(hud.svg).not.toContain('href="#feh"')
    expect(hud.svg).not.toContain('animateTransform')
    expect(hud.svg).toContain('opacity="0.25"')
    expect(hud.svg).toContain('href="#t63"') // visible ? in each unknown bar
    expect(hud.alt).toContain('Wochenbudget unbekannt')
    expect(hud.alt).toContain('Sitzungsbudget unbekannt')
    expect(titlesOf(unknown, NOW).hearts).toContain('unbekannt')
    const terminal = terminalBand(unknown, 140, NOW, false)
    const words = terminal.left.map(segment => segment.text).join('')
    expect(words).toContain('♡♡♡♡?♡♡♡♡♡')
    expect(words).toContain('○○○○?○○○○○')
    expect(words).not.toContain('♥')
    expect(words).not.toContain('●')
    const full = drawHud({ ...unknown, week: { used: 0 }, session: { used: 0 } }, { scale: 1.5, now: NOW, random })
    expect(full.svg).toContain('href="#hf"')
    expect(full.svg).toContain('href="#ff"')
    expect(full.svg).not.toContain('href="#t63"')
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
  expect(svg?.props.height).toBe(42) // compact 1.5 is the default in new sessions
  // one image for the whole band: the HUD and its columns; at 100 cells the other model's column is given up
  const images = await desktop.findAll({ type: 'Svg' })
  expect(images).toHaveLength(1)
  expect(String(images[0]?.props.alt)).toMatch(/^Minecraft-HUD: .* · Sitzung .* · Woche .* · Fable .* · Kontext /)
  expect(images[0]?.props.width).toBeGreaterThan(0)
  await desktop.unmount()

  const terminal = await $.ui.mount({ plugin: 'minecraft-hud', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await terminal.find({ type: 'Text', text: /♥/ })).toBeDefined()
  await terminal.unmount()
  const debug = await $.command.run({ command: 'hud', args: 'debug', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(debug.text).toContain('Budgetstatus:')
  expect(debug.text).toContain('Sonnet bekannt')
  const summary = await $.command.run({ command: 'hud', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(summary.text).toContain('Hunger (5 Std.):')
  expect(summary.text).not.toContain('Einstellungen:')
  expect(summary.text).not.toMatch(/[♥◆●○✦]/)
  const details = await $.command.run({ command: 'hud', args: 'details', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(details.text).toContain('Einstellungen:')
  expect(details.text).not.toMatch(/[♥◆●○✦]/)

  const off = await $.command.run({ command: 'hud', args: 'aus', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(off.text).toContain('HUD in diesem Repo aus')
  const hidden = await $.ui.mount({ plugin: 'minecraft-hud', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await hidden.find({ type: 'Svg' })).toBeUndefined()
  await hidden.unmount()
})
