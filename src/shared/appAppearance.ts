import type {
  AppBackgroundColorPair,
  AppBackgroundEffect,
  AppBackgroundPage,
  AppBackgroundSettings,
  AppSettings,
  BackgroundEffectSettings,
  CardAppearanceSettings,
  CardAppearanceTheme
} from './appSettings.ts'
import { normalizeLiquidGlass, normalizeSurfaceMaterial } from './liquidGlass.ts'
import { backgroundDisplayUrl } from './backgroundDisplay.ts'

export type AppearanceDraft = Pick<
  AppSettings,
  'appBackground' | 'cardAppearance' | 'surfaceMaterial' | 'liquidGlass'
>
export type AppearanceTone = 'light' | 'dark'
export type AppearancePreset = 'theme' | 'transparent' | 'frosted' | 'liquidGlass'
export const BACKGROUND_PAGES: readonly AppBackgroundPage[] = [
  'local',
  'settings',
  'streaming',
  'player'
]
export const BACKGROUND_EFFECT_RANGES = {
  blur: { min: 0, max: 30, step: 1, suffix: 'px', label: '背景模糊' },
  dim: { min: 0, max: 80, step: 1, suffix: '%', label: '遮罩浓度' },
  brightness: { min: 50, max: 120, step: 1, suffix: '%', label: '背景亮度' },
  scale: { min: 1, max: 3, step: 0.01, suffix: '×', label: '画面缩放' },
  positionX: { min: 0, max: 100, step: 1, suffix: '%', label: '水平位置' },
  positionY: { min: 0, max: 100, step: 1, suffix: '%', label: '垂直位置' }
} as const

export function defaultBackgroundEffect(): AppBackgroundEffect {
  return {
    blur: 0,
    brightness: 100,
    dim: 0,
    scale: 1,
    positionX: 50,
    positionY: 50,
    textTone: 'theme'
  }
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}
function number(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}
function hex(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#?[a-f\d]{6}$/i.test(value.trim())
    ? `#${value.trim().replace(/^#/, '').toLowerCase()}`
    : fallback
}
export function normalizeBackgroundEffect(raw: unknown): AppBackgroundEffect {
  const value = object(raw)
  const result = defaultBackgroundEffect()
  for (const field of Object.keys(BACKGROUND_EFFECT_RANGES) as Array<
    keyof typeof BACKGROUND_EFFECT_RANGES
  >) {
    const range = BACKGROUND_EFFECT_RANGES[field]
    result[field] = number(value[field], range.min, range.max, result[field])
  }
  result.textTone =
    value.textTone === 'light' || value.textTone === 'dark' ? value.textTone : 'theme'
  return result
}
export function defaultBackground(
  page: 'global' | AppBackgroundPage = 'global'
): AppBackgroundColorPair {
  const lights = {
    global: '#f4f4f7',
    local: '#ffffff',
    streaming: '#fafbfe',
    settings: '#f4f4f7',
    player: '#080e17'
  }
  return {
    kind: 'color',
    image: '',
    customized: false,
    light: lights[page],
    dark: '#17181a',
    effects: { light: defaultBackgroundEffect(), dark: defaultBackgroundEffect() }
  }
}
export function normalizeAppBackgroundSettings(
  raw: unknown,
  legacy?: BackgroundEffectSettings
): AppBackgroundSettings {
  const value = object(raw)
  const pair = (rawPair: unknown, page: 'global' | AppBackgroundPage): AppBackgroundColorPair => {
    const source = object(rawPair)
    const defaults = defaultBackground(page)
    const effects = object(source.effects)
    return {
      light: hex(source.light, defaults.light),
      dark: hex(source.dark, defaults.dark),
      kind: source.kind === 'image' ? 'image' : 'color',
      image:
        typeof source.image === 'string' && /^background:\/\/[a-zA-Z0-9._-]+$/.test(source.image)
          ? source.image
          : '',
      customized:
        source.customized === true ||
        hex(source.light, defaults.light) !== defaults.light ||
        hex(source.dark, defaults.dark) !== defaults.dark,
      effects: {
        light: normalizeBackgroundEffect(
          effects.light ?? (source.effects == null && legacy?.enabled ? legacy.light : undefined)
        ),
        dark: normalizeBackgroundEffect(
          effects.dark ?? (source.effects == null && legacy?.enabled ? legacy.dark : undefined)
        )
      }
    }
  }
  const global = pair(value.global, 'global')
  const pages = object(value.pages)
  return {
    global,
    pages: Object.fromEntries(
      BACKGROUND_PAGES.map((page) => [
        page,
        { ...pair(pages[page], page), inherit: object(pages[page]).inherit !== false }
      ])
    ) as AppBackgroundSettings['pages']
  }
}
export function resolveBackground(
  background: AppBackgroundSettings,
  page: AppBackgroundPage
): AppBackgroundColorPair {
  return background.pages[page].inherit ? background.global : background.pages[page]
}
export function backgroundEffect(
  background: AppBackgroundColorPair,
  tone: AppearanceTone
): AppBackgroundEffect {
  return normalizeBackgroundEffect(background.effects?.[tone])
}
export const BACKGROUND_TEXT_PALETTES = {
  light: { text: '#f4f7fb', muted: '#c4cbd5' },
  dark: { text: '#1a202c', muted: '#4b5563' }
} as const

export function backgroundCssVariables(
  background: AppBackgroundColorPair,
  tone: AppearanceTone
): Record<string, string> {
  const effect = backgroundEffect(background, tone)
  const textLight = effect.textTone === 'theme' ? tone === 'dark' : effect.textTone === 'light'
  const palette = BACKGROUND_TEXT_PALETTES[textLight ? 'light' : 'dark']
  return {
    '--appearance-color': background[tone],
    '--appearance-image':
      background.kind === 'image' && background.image
        ? `url("${backgroundDisplayUrl(background.image).replace(/["\\\n\r]/g, '')}")`
        : 'none',
    '--appearance-blur': `${effect.blur}px`,
    '--appearance-brightness': `${effect.brightness}%`,
    '--appearance-dim': `${effect.dim / 100}`,
    '--appearance-scale': `${effect.scale}`,
    '--appearance-position': `${effect.positionX}% ${effect.positionY}%`,
    '--appearance-text': palette.text,
    '--appearance-muted': palette.muted
  }
}
export function defaultCardTheme(tone: AppearanceTone): CardAppearanceTheme {
  return {
    blurRadius: 20,
    blurSaturation: 150,
    backgroundColor: tone === 'dark' ? '#181818' : '#ffffff',
    backgroundOpacity: 100,
    borderColor: tone === 'dark' ? '#ffffff' : '#0f172a',
    borderOpacity: tone === 'dark' ? 10 : 8,
    borderWidth: 1,
    borderRadius: 16,
    shadowStrength: 'medium',
    hoverEffect: 'lift',
    glassHighlight: true
  }
}
export function defaultCardAppearance(): CardAppearanceSettings {
  return {
    enabled: false,
    light: defaultCardTheme('light'),
    dark: defaultCardTheme('dark'),
    background: {
      enabled: false,
      light: { blur: 0, brightness: 100, dim: 0 },
      dark: { blur: 0, brightness: 100, dim: 0 }
    }
  }
}
export function cloneAppearance(settings: AppearanceDraft): AppearanceDraft {
  // No proxies or shared default references escape the editing session.
  const card = settings.cardAppearance ?? defaultCardAppearance()
  return {
    appBackground: normalizeAppBackgroundSettings(settings.appBackground, card.background),
    cardAppearance: {
      enabled: card.enabled,
      light: { ...card.light },
      dark: { ...card.dark },
      background: { ...defaultCardAppearance().background }
    },
    surfaceMaterial: normalizeSurfaceMaterial(settings.surfaceMaterial),
    liquidGlass: normalizeLiquidGlass(settings.liquidGlass)
  }
}
export function applyAppearancePreset(
  draft: AppearanceDraft,
  preset: AppearancePreset
): AppearanceDraft {
  const result = cloneAppearance(draft)
  result.surfaceMaterial =
    preset === 'transparent' || preset === 'liquidGlass' ? preset : 'standard'
  if (preset === 'theme' || preset === 'frosted') {
    result.cardAppearance.enabled = preset === 'frosted'
    result.liquidGlass.navigationEnabled =
      result.liquidGlass.playbarEnabled =
      result.liquidGlass.settingsNavigationEnabled =
        false
    result.liquidGlass.homeCards.enabled = false
    result.liquidGlass.coverage = 'functional'
  }
  if (preset === 'frosted')
    for (const tone of ['light', 'dark'] as const) {
      if (JSON.stringify(result.cardAppearance[tone]) === JSON.stringify(defaultCardTheme(tone))) {
        result.cardAppearance[tone] = { ...defaultCardTheme(tone), backgroundOpacity: 60 }
      }
    }
  return result
}
export function cardCssVariables(card: CardAppearanceTheme): Record<string, string> {
  const color = (value: string, alpha: number): string =>
    `${hex(value, '#ffffff')}${Math.round(alpha * 2.55)
      .toString(16)
      .padStart(2, '0')}`
  const shadows = {
    none: 'none',
    subtle: '0 4px 16px #00000012',
    medium: '0 12px 32px #00000024',
    strong: '0 20px 48px #00000040'
  }
  const shadow = shadows[card.shadowStrength] ?? 'none'
  return {
    '--te-card-blur': `${card.blurRadius}px`,
    '--te-card-saturate': `${card.blurSaturation}%`,
    '--te-card-bg': color(card.backgroundColor, card.backgroundOpacity),
    '--te-card-bg-solid': card.backgroundColor,
    '--te-card-border': color(card.borderColor, card.borderOpacity),
    '--te-card-border-width': `${card.borderWidth}px`,
    '--te-card-radius': `${card.borderRadius}px`,
    '--te-card-shadow': shadow,
    '--te-card-hover-transform':
      card.hoverEffect === 'lift'
        ? 'translateY(-4px)'
        : card.hoverEffect === 'zoom'
          ? 'scale(1.02)'
          : 'none',
    '--te-card-hover-shadow':
      card.hoverEffect === 'glow' ? '0 0 24px rgba(var(--te-primary-rgb), .24)' : shadow,
    '--te-card-glass-highlight': card.glassHighlight
      ? 'inset 0 1px 0 #ffffff25'
      : '0 0 0 transparent'
  }
}
