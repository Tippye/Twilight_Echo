import type { StartupExperience } from '../../../shared/pluginExperience.ts'
import type { UiContribution } from '../extensions/registry'
import type { useAppNavigation } from './useAppNavigation'

export function applyStartupExperience(
  navigation: ReturnType<typeof useAppNavigation>,
  selection: StartupExperience | null,
  pages: UiContribution[]
): 'builtin' | 'opened' | 'unavailable' {
  if (!selection) return 'builtin'
  const page = pages.find(
    (entry) =>
      entry.kind === 'sidebarPage' &&
      entry.pluginId === selection.pluginId &&
      entry.experience?.id === selection.experienceId
  )
  if (!page) return 'unavailable'
  navigation.selectSidebarPage({ kind: 'plugin', page })
  return 'opened'
}
