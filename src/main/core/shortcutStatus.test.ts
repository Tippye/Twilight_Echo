import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildPlayerShortcutStatuses } from './shortcutStatus.ts'
import { normalizeShortcutEnabled } from '../../shared/shortcutPreferences.ts'

const shortcuts = [
  { accelerator: 'CommandOrControl+Alt+Left', action: 'previous', label: '上一首' },
  { accelerator: 'CommandOrControl+Alt+Right', action: 'next', label: '下一首' },
  { accelerator: 'CommandOrControl+Alt+Space', action: 'playPause', label: '播放 / 暂停' }
]

test('individual switches skip registration and preserve the other bindings', () => {
  const calls: string[] = []
  const definitions = shortcuts.map((shortcut) => ({
    ...shortcut,
    enabled: shortcut.action !== 'next'
  }))
  const register = (accelerator: string) => {
    calls.push(accelerator)
    return true
  }
  const statuses = buildPlayerShortcutStatuses(definitions, true, register)
  assert.deepEqual(calls, [shortcuts[0].accelerator, shortcuts[2].accelerator])
  assert.equal(statuses[1].registered, false)
  assert.equal(statuses[1].error, null)
  calls.length = 0
  buildPlayerShortcutStatuses(definitions, false, register)
  assert.deepEqual(calls, [])
  definitions[1].enabled = true
  assert.ok(
    buildPlayerShortcutStatuses(definitions, true, register).every((status) => status.registered)
  )
})

test('shortcut preferences retain explicit opt-outs across serialization and ignore invalid values', () => {
  assert.deepEqual(normalizeShortcutEnabled(undefined), {})
  const preferences = normalizeShortcutEnabled({
    closeWindow: false,
    playPause: false,
    MediaPlayPause: false,
    commandPalette: true,
    next: 'false',
    unknown: false
  })
  assert.deepEqual(preferences, { closeWindow: false, playPause: false, MediaPlayPause: false })
  assert.deepEqual(normalizeShortcutEnabled(JSON.parse(JSON.stringify(preferences))), preferences)
  assert.deepEqual(normalizeShortcutEnabled({ ...preferences, closeWindow: true }), {
    playPause: false,
    MediaPlayPause: false
  })
})

test('close-window bindings never capture Ctrl+W globally', () => {
  for (const accelerator of ['CommandOrControl+W', 'Ctrl+W', 'Command+W']) {
    const [status] = buildPlayerShortcutStatuses(
      [{ accelerator, action: 'playPause', label: '播放' }],
      true,
      () => {
        throw new Error('reserved accelerator must not register')
      }
    )
    assert.equal(status.registered, false)
    assert.match(status.error ?? '', /关闭窗口/)
  }
})

test('builds disabled shortcut status without trying to register accelerators', () => {
  let registerCalls = 0
  const statuses = buildPlayerShortcutStatuses(shortcuts, false, () => {
    registerCalls += 1
    return true
  })

  assert.equal(registerCalls, 0)
  assert.equal(statuses.length, shortcuts.length)
  assert.equal(
    statuses.every((status) => !status.registered && status.error === null),
    true
  )
})

test('records registered and failed shortcut accelerators', () => {
  const statuses = buildPlayerShortcutStatuses(
    shortcuts,
    true,
    (accelerator) => accelerator !== 'CommandOrControl+Alt+Right'
  )

  assert.equal(statuses.find((status) => status.action === 'previous')?.registered, true)
  const failed = statuses.find((status) => status.action === 'next')
  assert.equal(failed?.registered, false)
  assert.match(failed?.error ?? '', /占用|冲突|失败/)
})

test('a saved command palette conflict is reported without registering a second action', () => {
  let calls = 0
  const statuses = buildPlayerShortcutStatuses(
    [{ accelerator: 'CommandOrControl+K', action: 'playPause', label: '播放' }],
    true,
    () => {
      calls += 1
      return true
    }
  )
  assert.equal(calls, 0)
  assert.equal(statuses[0].registered, false)
  assert.match(statuses[0].error ?? '', /命令面板/)
  assert.equal(statuses[0].accelerator, 'CommandOrControl+K')
})
