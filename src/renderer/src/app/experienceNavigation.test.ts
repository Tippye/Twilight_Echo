import test from 'node:test'
import assert from 'node:assert/strict'
import { useAppNavigation } from './useAppNavigation.ts'
import type { UiContribution } from '../extensions/registry.ts'
import { applyStartupExperience } from './startupExperience.ts'
import {
  normalizeStartupExperience,
  startupExperienceKey
} from '../../../shared/pluginExperience.ts'
import { createNavigationSessionPersistence } from './useNavigationSessionPersistence.ts'
import { NAVIGATION_SESSION_KEY } from './navigationSession.ts'
const page: UiContribution = {
  pluginId: 'com.example.rhine',
  id: 'rhine',
  kind: 'sidebarPage',
  title: 'Rhine',
  experience: {
    pluginId: 'com.example.rhine',
    id: 'rhine',
    name: 'Rhine',
    version: '0.1.0',
    entry: 'dist/index.html',
    url: 'plugin-ui://com.example.rhine/0.1.0/dist/index.html',
    bridgeVersion: 1,
    permissions: ['ui:inject']
  }
}
test('experience has a recovery destination even when opened as a navigation root', () => {
  const navigation = useAppNavigation()
  navigation.selectSidebarPage({ kind: 'plugin', page })
  navigation.closePluginPage()
  assert.equal(navigation.activePluginPage.value, null)
  assert.equal(navigation.localViewVisible.value, true)
})
test('disabling and upgrading the active experience retires its old session', () => {
  const navigation = useAppNavigation()
  navigation.onSelectPluginPage(page)
  navigation.closeMissingPluginPage([
    { ...page, experience: { ...page.experience!, version: '0.2.0' } }
  ])
  assert.equal(navigation.activePluginPage.value?.experience?.version, '0.2.0')
  navigation.closeMissingPluginPage([])
  assert.equal(navigation.activePluginPage.value, null)
})

test('startup selection is normalized independently from CSS themes and plugin versions', () => {
  for (const value of [
    undefined,
    null,
    'rhine',
    [],
    {},
    { pluginId: '../bad', experienceId: 'rhine' },
    { pluginId: 'com.example', experienceId: 'bad:id' }
  ]) {
    assert.equal(normalizeStartupExperience(value), null)
  }
  const selection = { pluginId: page.pluginId, experienceId: page.id }
  assert.deepEqual(normalizeStartupExperience({ ...selection, version: 'old' }), selection)
  assert.equal(startupExperienceKey(selection), 'com.example.rhine:rhine')
  assert.equal(startupExperienceKey(null), '')
})

test('explicit startup interface replaces saved settings and has a builtin recovery route', () => {
  const navigation = useAppNavigation()
  navigation.openSettingsPage('appearance')
  assert.equal(
    applyStartupExperience(navigation, { pluginId: page.pluginId, experienceId: page.id }, [page]),
    'opened'
  )
  assert.equal(navigation.activePluginPage.value?.id, page.id)
  assert.equal(navigation.showSettingsPage.value, false)
  navigation.closePluginPage()
  assert.equal(navigation.localViewVisible.value, true)
})

test('unavailable experiences never enter a legacy plugin page with the same identity', () => {
  const selection = { pluginId: page.pluginId, experienceId: page.id }
  const navigation = useAppNavigation()
  for (const pages of [[], [{ ...page, experience: undefined }]]) {
    assert.equal(applyStartupExperience(navigation, selection, pages), 'unavailable')
    assert.equal(navigation.activePluginPage.value, null)
  }
})

test('builtin selection does not revive an experience saved in navigation history', () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    }
  }
  const navigation = useAppNavigation()
  navigation.onSelectPluginPage(page)
  storage.setItem(NAVIGATION_SESSION_KEY, JSON.stringify(navigation.session.value))
  const reopened = useAppNavigation()
  const persistence = createNavigationSessionPersistence(reopened, storage)
  persistence.start()
  persistence.resolvePluginPages([page].filter((entry) => !entry.experience))
  assert.equal(applyStartupExperience(reopened, null, [page]), 'builtin')
  assert.equal(reopened.activePluginPage.value, null)
  persistence.stop()
})
