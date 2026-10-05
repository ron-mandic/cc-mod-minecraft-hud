/** One plan limit as the HUD draws it. */
export type HudLimit = {
  /** Percent of the window used, 0 to 100. */
  used: number
  /** When the window resets, ISO 8601. */
  resetsAt?: string
}

/** A model-scoped weekly limit (Sonnet, Opus, ...), named by the model. */
export type HudModelLimit = HudLimit & { model: string }

/** The context window as the status line has it. */
export type HudContext = {
  /** Input tokens of the last response; absent until the first one. */
  tokens?: number
  /** The model's window, in tokens. */
  window: number
  /** tokens over window, 0 to 100; absent until the first response. */
  percent?: number
}

/** Everything the HUD draws: the usage endpoint's figures merged with the session's. */
export type HudSnapshot = {
  /** The 5-hour session limit: the hunger bar. */
  session?: HudLimit
  /** The 7-day limit across all models: the hearts. */
  week?: HudLimit
  /** Fable's weekly limit: the armour bar. */
  fable?: HudLimit
  /** Another model-scoped weekly limit in use, Sonnet first: the air bubbles. */
  air?: HudModelLimit
  /** The context window: the XP bar and its level. */
  context?: HudContext
  /** Where the plan figures came from: the usage endpoint, the session's last response, or nowhere. */
  source: 'endpoint' | 'session' | 'none'
  /** When the plan figures were read, ms since the epoch. */
  readAt?: number
  /** Why the usage endpoint gave nothing, when it did not. */
  problem?: string
  /** When the hearts last dropped (the damage blink), ms since the epoch. */
  hurtAt?: number
  /** Half-hearts shown before that drop. */
  hurtFrom?: number
  /** When the hearts last refilled (the regeneration wave), ms since the epoch. */
  healAt?: number
}

export type HudTerminalStyle = 'compact' | 'status' | 'off'

export type HudNumbers = 'off' | 'short' | 'full'

/** CSS pixels per sprite pixel on the desktop, or `auto`: 2 where the band has room for everything, else 1.5. */
export type HudScale = 'auto' | 1 | 1.5 | 2 | 3

/** The settings in force for this session's repository. */
export type HudPrefs = {
  isEnabled: boolean
  /** Whether isEnabled comes from `/hud an|aus` in this repository. */
  isRepoSetting: boolean
  /** The repository (or folder) the per-repo switch is keyed by. */
  repo: string
  terminal: HudTerminalStyle
  /** Desktop pixels per sprite pixel, or `auto`. */
  scale: HudScale
  numbers: HudNumbers
  hasWarnings: boolean
  refreshMinutes: number
}

declare module 'claude-code' {
  interface PluginState {
    'minecraft-hud': {
      snapshot: HudSnapshot | null
      prefs: HudPrefs | null
    }
  }
}
