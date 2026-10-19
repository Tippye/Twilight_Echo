export type ExperienceWindowTheme = 'default' | 'rhine' | 'rhine-night'

export interface ExperienceWindowOptions {
  theme?: ExperienceWindowTheme
}

export function normalizeExperienceWindowTheme(value: unknown): ExperienceWindowTheme {
  return value === 'rhine' || value === 'rhine-night' ? value : 'default'
}
