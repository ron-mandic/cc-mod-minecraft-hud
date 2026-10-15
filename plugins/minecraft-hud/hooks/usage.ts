import type { SessionUsage } from 'claude-code'

import type { HudContext, HudLimit, HudSnapshot } from '../types'

/** The endpoint `/usage` reads: undocumented, so every field is read defensively. */
export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

const MINUTE = 60_000
/** Three normal polling intervals without confirmation: do not present cached budgets as current. */
const MAX_READING_AGE_MS = 15 * MINUTE

/** What one read of the usage endpoint gave. */
export type PlanReading = {
  session?: HudLimit
  week?: HudLimit
  /** Model-scoped weekly limits by display name ("Fable", "Sonnet", ...). */
  models: Record<string, HudLimit>
}

/** The last endpoint read, shared by every session through `$.store`. */
export type PlanCache = {
  /** When it was read (or tried), ms since the epoch. */
  at: number
  reading?: PlanReading
  problem?: string
  /** No new try before this, ms since the epoch. */
  retryAt?: number
  /** Which windows the last answer carried (field names, kinds, models; no figures): for `/hud debug`. */
  shape?: string
}

/** The session's own figures: the last API response's rate-limit headers and the context window. */
export type LiveReading = {
  at: number
  session?: HudLimit
  week?: HudLimit
  models: Record<string, HudLimit>
  context?: HudContext
}

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const numberOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const textOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

const clampPercent = (value: number) => Math.min(100, Math.max(0, Math.round(value * 10) / 10))

const limitOf = (used: number | undefined, resetsAt: unknown): HudLimit | undefined =>
  used === undefined ? undefined : { used: clampPercent(used), resetsAt: textOf(resetsAt) }

/** Family matching, never a pinned model version. Preserve names outside known families. */
const modelKey = (name: string) =>
  /fable/i.test(name) ? 'Fable' : /sonnet/i.test(name) ? 'Sonnet' : /opus/i.test(name) ? 'Opus' : name

/** Also normalize caches saved by earlier plugin versions before merging sources by recency. */
const familyModels = (models: Record<string, HudLimit>) =>
  Object.fromEntries(Object.entries(models).map(([name, limit]) => [modelKey(name), limit]))

/** Legacy top-level keys of model-scoped weekly windows, by the model they count. */
const LEGACY_MODEL_KEYS: Record<string, string> = {
  seven_day_fable: 'Fable',
  seven_day_overage_included: 'Fable',
  seven_day_opus: 'Opus',
  seven_day_sonnet: 'Sonnet',
}

/** Reads the endpoint's JSON: the `limits` list first, the older top-level windows after. */
export function parsePlan(body: unknown): PlanReading {
  const reading: PlanReading = { models: {} }
  if (!isObject(body)) {
    return reading
  }
  const limits = Array.isArray(body.limits) ? body.limits : []
  for (const entry of limits) {
    if (!isObject(entry)) {
      continue
    }
    const used = numberOf(entry.percent) ?? numberOf(entry.percent_used) ?? numberOf(entry.utilization)
    const limit = limitOf(used, entry.resets_at ?? entry.resetsAt)
    if (limit === undefined) {
      continue
    }
    const kind = textOf(entry.kind) ?? ''
    const scope = isObject(entry.scope) ? entry.scope : undefined
    const model = isObject(scope?.model) ? (textOf(scope.model.display_name) ?? textOf(scope.model.id)) : undefined
    if (model !== undefined) {
      reading.models[modelKey(model)] ??= limit
    } else if (kind === 'session' || kind === 'five_hour') {
      reading.session ??= limit
    } else if (kind === 'weekly_all' || kind === 'seven_day' || kind === 'weekly') {
      reading.week ??= limit
    }
  }
  const legacy = (key: string) => {
    const window = body[key]
    return isObject(window) ? limitOf(numberOf(window.utilization), window.resets_at) : undefined
  }
  reading.session ??= legacy('five_hour')
  reading.week ??= legacy('seven_day')
  for (const [key, model] of Object.entries(LEGACY_MODEL_KEYS)) {
    const limit = legacy(key)
    if (limit !== undefined) {
      reading.models[model] ??= limit
    }
  }
  return reading
}

/** What one answer of the usage endpoint means: a reading, or why not and when to try again. */
export type PlanResult = { reading?: PlanReading; problem?: string; retryInMs?: number; shape?: string }

/** The answer's outline without its figures: `five_hour, seven_day, limits[session, weekly_scoped:Fable]`. */
export function shapeOf(body: unknown): string {
  if (!isObject(body)) {
    return typeof body
  }
  return Object.entries(body)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => {
      if (key !== 'limits' || !Array.isArray(value)) {
        return key
      }
      const kinds = value.filter(isObject).map(entry => {
        const scope = isObject(entry.scope) ? entry.scope : undefined
        const model = isObject(scope?.model) ? (textOf(scope.model.display_name) ?? textOf(scope.model.id)) : undefined
        return `${textOf(entry.kind) ?? '?'}${model === undefined ? '' : `:${model}`}`
      })
      return `limits[${kinds.join(', ')}]`
    })
    .join(', ')
}

/** Reads the endpoint's HTTP answer (status and body text) into a reading or a reason. */
export function planResultOf(status: number, body: string): PlanResult {
  if (status === 429) {
    return { problem: 'Usage-Endpoint drosselt (429)', retryInMs: 10 * MINUTE }
  }
  if (status === 401 || status === 403) {
    return { problem: `Usage-Endpoint verweigert (${status})`, retryInMs: 30 * MINUTE }
  }
  if (status < 200 || status > 299) {
    return { problem: `Usage-Endpoint antwortet ${status}`, retryInMs: 5 * MINUTE }
  }
  try {
    const json: unknown = JSON.parse(body)
    return { reading: parsePlan(json), shape: shapeOf(json) }
  } catch {
    return { problem: 'Antwort des Usage-Endpoints unlesbar', retryInMs: 10 * MINUTE }
  }
}

/** The session's figures: `five_hour` and `seven_day` from the last response, and the context window. */
export function liveOf(usage: SessionUsage, at: number): LiveReading {
  const live: LiveReading = { at, models: {}, context: usage.context }
  for (const window of usage.rateLimits) {
    const limit = limitOf(window.percentUsed, window.resetsAt)
    if (limit === undefined) {
      continue
    }
    const kind = window.kind.toLowerCase()
    if (kind === 'five_hour') {
      live.session = limit
    } else if (kind === 'seven_day') {
      live.week = limit
    } else if (kind.includes('fable') || kind.includes('overage_included')) {
      live.models.Fable = limit
    } else if (kind.includes('sonnet')) {
      live.models.Sonnet = limit
    } else if (kind.includes('opus')) {
      live.models.Opus = limit
    }
  }
  return live
}

/** After the reset, the old reading cannot tell us how much the new window has already used. */
const expire = (limit: HudLimit | undefined, now: number): HudLimit | undefined => {
  if (limit?.resetsAt === undefined) {
    return limit
  }
  const resetsAt = Date.parse(limit.resetsAt)
  return Number.isFinite(resetsAt) && resetsAt <= now ? undefined : limit
}

/** Half icons left in a bar of ten (0 to 20), as Minecraft rounds health: up. */
export const halvesLeft = (limit: HudLimit | undefined) =>
  limit === undefined ? 0 : Math.min(20, Math.max(0, Math.ceil(Math.round((100 - limit.used) * 10) / 50)))

/**
 * Merges the endpoint's reading and the session's into what the HUD draws: per window the newer
 * reading wins (`live.at` is 0 when the session's figures are of unknown age, as after a reload).
 */
export function merge(plan: PlanCache | undefined, live: LiveReading, previous: HudSnapshot | null, now: number): HudSnapshot {
  const isFresh = (at: number) => at > 0 && now - at <= MAX_READING_AGE_MS
  const isPlanStale = plan?.reading !== undefined && !isFresh(plan.at)
  const reading = isPlanStale ? undefined : plan?.reading
  const planAt = reading === undefined ? 0 : (plan?.at ?? 0)
  const currentLive = isFresh(live.at) ? live : { ...live, session: undefined, week: undefined, models: {} }
  const hasLive = currentLive.session !== undefined || currentLive.week !== undefined || Object.keys(currentLive.models).length > 0
  const liveAt = hasLive ? live.at : 0
  const isLiveNewer = reading === undefined || liveAt > planAt
  const pick = (fromLive: HudLimit | undefined, fromPlan: HudLimit | undefined) =>
    expire(isLiveNewer ? (fromLive ?? fromPlan) : (fromPlan ?? fromLive), now)
  const models: Record<string, HudLimit> = isLiveNewer
    ? { ...familyModels(reading?.models ?? {}), ...familyModels(currentLive.models) }
    : { ...familyModels(currentLive.models), ...familyModels(reading?.models ?? {}) }
  const fableName = Object.keys(models).find(name => /fable/i.test(name))
  const airName = Object.keys(models)
    .find(name => /sonnet/i.test(name) && (expire(models[name], now)?.used ?? 0) > 0)
  const air = airName === undefined ? undefined : expire(models[airName], now)
  const snapshot: HudSnapshot = {
    session: pick(currentLive.session, reading?.session),
    week: pick(currentLive.week, reading?.week),
    fable: fableName === undefined ? undefined : expire(models[fableName], now),
    air: air === undefined ? undefined : { ...air, model: 'Sonnet' },
    context: live.context,
    source: reading !== undefined ? 'endpoint' : hasLive ? 'session' : 'none',
    readAt: Math.max(planAt, liveAt) || undefined,
    problem: [plan?.problem, isPlanStale ? 'Budgetdaten älter als 15 Minuten; aktuelle Bestätigung fehlt' : undefined]
      .filter(part => part !== undefined).join(' · ') || undefined,
    hurtAt: previous?.hurtAt,
    hurtFrom: previous?.hurtFrom,
    healAt: previous?.healAt,
  }
  if (previous !== null && previous.week !== undefined && snapshot.week !== undefined) {
    const before = halvesLeft(previous.week)
    const after = halvesLeft(snapshot.week)
    if (after < before) {
      snapshot.hurtAt = now
      snapshot.hurtFrom = before
    } else if (after > before) {
      snapshot.healAt = now
    }
  }
  return snapshot
}
