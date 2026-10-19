import assert from 'node:assert/strict'
import test from 'node:test'

import { useAppNoticeStore } from './useAppNoticeStore.ts'

const {
  notices,
  pushNotice: presentNotice,
  dismissNotice,
  releaseNoticeDedupe,
  clearNotices
} = useAppNoticeStore()
// Timer and dismissal regressions below exercise explicitly requested toasts.
const pushNotice = (input: Parameters<typeof presentNotice>[0]) =>
  presentNotice({ presentation: 'toast', ...input })

test('four visible notices retain a separate history and important failures persist', () => {
  clearNotices()
  for (let index = 0; index < 6; index++) pushNotice({ message: `通知 ${index}`, kind: 'error' })
  assert.equal(notices.value.length, 4)
  assert.equal(useAppNoticeStore().noticeHistory.value.length, 6)
  assert.equal(
    notices.value.every((notice) => notice.sticky),
    true
  )
  dismissNotice(notices.value[0].id)
  assert.equal(useAppNoticeStore().noticeHistory.value.length, 6)
  clearNotices()
})

test('hover and keyboard pauses survive repeated updates and resume only after both leave', (t) => {
  clearNotices()
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const store = useAppNoticeStore()
  const id = pushNotice({ message: '更新完成', dedupeKey: 'update' })
  t.mock.timers.tick(1000)
  store.pauseNotice(id, 'pointer')
  store.pauseNotice(id, 'focus')
  pushNotice({ message: '更新完成', dedupeKey: 'update' })
  t.mock.timers.tick(20_000)
  assert.equal(notices.value.length, 1)
  store.resumeNotice(id, 'pointer')
  t.mock.timers.tick(20_000)
  assert.equal(notices.value.length, 1)
  store.resumeNotice(id, 'focus')
  t.mock.timers.tick(7001)
  assert.equal(notices.value.length, 0)
  clearNotices()
})

const DEDUPE_KEY = 'audio-engine-recovery'
test('reading history clears unread state; only changed messages become unread again', () => {
  clearNotices()
  const store = useAppNoticeStore()
  pushNotice({ message: '正在连接', sticky: true, dedupeKey: 'connection' })
  assert.equal(store.unreadCount.value, 1)
  store.markHistoryRead()
  assert.equal(store.unreadCount.value, 0)
  pushNotice({ message: '正在连接', sticky: true, dedupeKey: 'connection' })
  assert.equal(store.unreadCount.value, 0)
  pushNotice({ message: '连接完成', dedupeKey: 'connection' })
  assert.equal(store.unreadCount.value, 1)
  clearNotices()
})

test('clearing history preserves active notices and records subsequent changed information', () => {
  clearNotices()
  const store = useAppNoticeStore()
  const id = pushNotice({ message: '等待连接', sticky: true, dedupeKey: 'connection' })
  store.clearHistory()
  assert.equal(notices.value[0].id, id)
  assert.equal(store.unreadCount.value, 0)
  pushNotice({ message: '等待连接', sticky: true, dedupeKey: 'connection' })
  assert.equal(store.noticeHistory.value.length, 0)
  pushNotice({ message: '已连接', dedupeKey: 'connection' })
  assert.equal(store.noticeHistory.value.length, 1)
  assert.equal(store.unreadCount.value, 1)
  clearNotices()
})

test('clearing task history leaves tombstones until a fresh result arrives', () => {
  clearNotices()
  const store = useAppNoticeStore()
  store.pushNotice({
    message: '曲库扫描：已完成',
    dedupeKey: 'task-result:scan',
    presentation: 'center'
  })
  store.pushNotice({
    message: '下载完成',
    downloadTaskId: 'download-1',
    presentation: 'center'
  })

  store.clearHistory()
  assert.equal(store.noticeHistory.value.length, 0)
  assert.equal(store.clearedTaskResultKeys.value.has('task-result:scan'), true)
  assert.equal(store.clearedTaskResultKeys.value.has('download-result:download-1'), true)

  store.pushNotice({
    message: '曲库扫描：已完成',
    dedupeKey: 'task-result:scan',
    presentation: 'center',
    fresh: true
  })
  assert.equal(store.clearedTaskResultKeys.value.has('task-result:scan'), false)
  assert.equal(store.clearedTaskResultKeys.value.has('download-result:download-1'), true)
  clearNotices()
})

test('history remains bounded while expired cards remain available to read', (t) => {
  clearNotices()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const store = useAppNoticeStore()
  for (let index = 0; index < 60; index++) pushNotice({ message: `完成 ${index}` })
  assert.equal(store.noticeHistory.value.length, 50)
  assert.equal(store.noticeHistory.value[0].message, '完成 10')
  t.mock.timers.tick(7001)
  assert.equal(notices.value.length, 0)
  assert.equal(store.noticeHistory.value.length, 50)
  clearNotices()
})

const CRASH_MESSAGE = '音频服务无法启动：未加载 twilight_audio_node.node。'

function messages(): string[] {
  return notices.value.map((notice) => notice.message)
}

test('a dismissed deduped notice stays dismissed when the same message repeats', () => {
  clearNotices()

  const first = pushNotice({ message: CRASH_MESSAGE, sticky: true, dedupeKey: DEDUPE_KEY })
  assert.notEqual(first, 0)
  dismissNotice(first)
  assert.deepEqual(messages(), [])

  // The audio service crash reason arrives again on the very next device poll.
  // Re-pushing it must not out-click the user.
  assert.equal(pushNotice({ message: CRASH_MESSAGE, sticky: true, dedupeKey: DEDUPE_KEY }), 0)
  assert.equal(pushNotice({ message: CRASH_MESSAGE, sticky: true, dedupeKey: DEDUPE_KEY }), 0)
  assert.deepEqual(messages(), [])

  clearNotices()
})

test('a changed message is new information and releases the dismissal', () => {
  clearNotices()

  dismissNotice(pushNotice({ message: CRASH_MESSAGE, sticky: true, dedupeKey: DEDUPE_KEY }))
  assert.deepEqual(messages(), [])

  const recovered = pushNotice({ message: '音频服务已恢复。', dedupeKey: DEDUPE_KEY })
  assert.notEqual(recovered, 0)
  assert.deepEqual(messages(), ['音频服务已恢复。'])

  clearNotices()
})

test('repeat pushes on one dedupe key update in place instead of stacking a new id', () => {
  clearNotices()

  const id = pushNotice({
    message: CRASH_MESSAGE,
    kind: 'error',
    sticky: true,
    dedupeKey: DEDUPE_KEY
  })
  const same = pushNotice({
    message: CRASH_MESSAGE,
    kind: 'error',
    sticky: true,
    dedupeKey: DEDUPE_KEY
  })
  assert.equal(same, id)
  assert.equal(notices.value.length, 1)

  const updated = pushNotice({
    message: '音频服务已恢复，播放已停止，可手动继续。',
    kind: 'success',
    dedupeKey: DEDUPE_KEY
  })
  assert.equal(updated, id, 'the toast keeps its identity so it is not visually replaced')
  assert.equal(notices.value.length, 1)
  assert.equal(notices.value[0].kind, 'success')
  assert.equal(notices.value[0].sticky, false)

  clearNotices()
})

test('releaseNoticeDedupe lets an unchanged message notify again', () => {
  clearNotices()

  dismissNotice(pushNotice({ message: CRASH_MESSAGE, sticky: true, dedupeKey: DEDUPE_KEY }))
  assert.equal(pushNotice({ message: CRASH_MESSAGE, sticky: true, dedupeKey: DEDUPE_KEY }), 0)

  // A user-driven retry must be able to report the identical failure again.
  releaseNoticeDedupe(DEDUPE_KEY)
  assert.notEqual(pushNotice({ message: CRASH_MESSAGE, sticky: true, dedupeKey: DEDUPE_KEY }), 0)
  assert.deepEqual(messages(), [CRASH_MESSAGE])

  clearNotices()
})

test('notices without a dedupe key still stack and dismiss independently', () => {
  clearNotices()

  const first = pushNotice({ message: '第一条', sticky: true })
  const second = pushNotice({ message: '第一条', sticky: true })
  assert.notEqual(first, second)
  assert.deepEqual(messages(), ['第一条', '第一条'])

  dismissNotice(first)
  assert.deepEqual(messages(), ['第一条'])
  assert.notEqual(pushNotice({ message: '第一条', sticky: true }), 0)
  assert.equal(notices.value.length, 2)

  clearNotices()
})

test('an in-place update reschedules auto dismissal against the new duration', (t) => {
  clearNotices()
  t.mock.timers.enable({ apis: ['setTimeout'] })

  const id = pushNotice({ message: CRASH_MESSAGE, sticky: true, dedupeKey: DEDUPE_KEY })
  t.mock.timers.tick(60_000)
  assert.deepEqual(messages(), [CRASH_MESSAGE], 'a sticky notice never times out')

  assert.equal(
    pushNotice({ message: '音频服务已恢复。', durationMs: 8000, dedupeKey: DEDUPE_KEY }),
    id
  )
  t.mock.timers.tick(7999)
  assert.deepEqual(messages(), ['音频服务已恢复。'])
  t.mock.timers.tick(2)
  assert.deepEqual(messages(), [])

  clearNotices()
})

test('routine results stay in the center while errors and actions remain immediately available', () => {
  clearNotices()
  const store = useAppNoticeStore()
  for (const kind of ['info', 'success', 'warning'] as const)
    store.pushNotice({ kind, message: kind, dedupeKey: kind })
  assert.equal(notices.value.length, 0)
  assert.equal(store.noticeHistory.value.length, 3)
  assert.equal(store.unreadCount.value, 3)
  const first = store.noticeHistory.value[0].id
  store.markHistoryRead()
  assert.equal(store.pushNotice({ message: 'info', dedupeKey: 'info' }), first)
  assert.equal(store.noticeHistory.value.length, 3)
  assert.equal(store.unreadCount.value, 0)
  store.pushNotice({ kind: 'error', message: '播放失败' })
  store.pushNotice({ message: '可以撤销', action: { label: '撤销', run: () => {} } })
  store.pushNotice({ kind: 'error', message: '下载失败', presentation: 'center' })
  assert.deepEqual(
    notices.value.map((item) => item.message),
    ['播放失败', '可以撤销']
  )
  assert.equal(store.noticeHistory.value.length, 6)
  clearNotices()
})

test('do not disturb clears active timers and keeps errors, updates and actions in history', async (t) => {
  clearNotices()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const store = useAppNoticeStore()
  t.after(() => {
    store.setDoNotDisturb(false)
    clearNotices()
  })
  const id = pushNotice({ message: '正在连接', dedupeKey: 'quiet-connection', sticky: false })
  store.pauseNotice(id, 'pointer')
  store.setDoNotDisturb(true)
  assert.equal(notices.value.length, 0)
  assert.equal(store.noticeHistory.value.length, 1)
  assert.equal(store.doNotDisturb.value, true)
  let actions = 0
  const action = store.pushNotice({
    kind: 'error',
    message: '静默播放失败',
    action: {
      label: '重试',
      run: () => {
        actions++
      }
    }
  })
  store.pushNotice({ message: '更新可以安装', presentation: 'toast', sticky: true })
  assert.equal(pushNotice({ message: '已连接', dedupeKey: 'quiet-connection' }), id)
  store.resumeNotice(id, 'pointer')
  t.mock.timers.tick(60_000)
  assert.equal(notices.value.length, 0)
  assert.equal(store.noticeHistory.value.length, 3)
  assert.equal(store.unreadCount.value, 3)
  assert.equal(await store.runNoticeAction(action), true)
  assert.equal(actions, 1)
  store.clearHistory()
  assert.equal(store.doNotDisturb.value, true, 'clearing records must preserve the preference')
  store.pushNotice({ kind: 'error', message: '清空后仍然静默' })
  store.setDoNotDisturb(false)
  assert.equal(notices.value.length, 0, 'turning off do not disturb must not replay old alerts')
  const fresh = pushNotice({ message: '新的提醒', dedupeKey: 'quiet-connection' })
  assert.equal(notices.value[0].id, fresh)
  t.mock.timers.tick(7001)
  assert.equal(notices.value.length, 0, 'new notices still dismiss normally')
})

test('do not disturb persists both choices and restores them in a fresh store', async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const preferences = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => preferences.get(key) ?? null,
      setItem: (key: string, value: string) => preferences.set(key, value)
    }
  })
  const store = useAppNoticeStore()
  t.after(() => {
    store.setDoNotDisturb(false)
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    else Reflect.deleteProperty(globalThis, 'localStorage')
    clearNotices()
  })
  store.setDoNotDisturb(true)
  const enabled = await import(new URL('./useAppNoticeStore.ts?dnd-enabled', import.meta.url).href)
  const restored = enabled.useAppNoticeStore()
  assert.equal(restored.doNotDisturb.value, true)
  restored.pushNotice({ kind: 'error', message: '重启后保持静默' })
  assert.equal(restored.notices.value.length, 0)
  assert.equal(restored.noticeHistory.value.length, 1)
  restored.clearNotices()
  assert.equal(restored.doNotDisturb.value, true)
  store.setDoNotDisturb(false)
  const disabled = await import(
    new URL('./useAppNoticeStore.ts?dnd-disabled', import.meta.url).href
  )
  assert.equal(disabled.useAppNoticeStore().doNotDisturb.value, false)
})

test('unavailable preference storage does not prevent do not disturb from working', async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => {
      throw new Error('Storage is unavailable')
    }
  })
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  })
  const module = await import(
    new URL('./useAppNoticeStore.ts?dnd-blocked-storage', import.meta.url).href
  )
  const store = module.useAppNoticeStore()
  assert.equal(store.doNotDisturb.value, false)
  assert.doesNotThrow(() => store.setDoNotDisturb(true))
  store.pushNotice({ kind: 'error', message: '存储不可用时仍然静默' })
  assert.equal(store.notices.value.length, 0)
  assert.equal(store.noticeHistory.value.length, 1)
  store.clearNotices()
  assert.doesNotThrow(() => store.setDoNotDisturb(false))
})

test('a failed notification action remains retryable and concurrent clicks execute once', async () => {
  clearNotices()
  const store = useAppNoticeStore()
  let calls = 0
  let finish!: () => void
  const id = store.pushNotice({
    message: '恢复播放',
    action: {
      label: '重试',
      run: async () => {
        calls++
        if (calls === 1) throw new Error('设备不可用')
        await new Promise<void>((resolve) => {
          finish = resolve
        })
      }
    }
  })
  assert.equal(await store.runNoticeAction(id), false)
  assert.ok(store.noticeHistory.value.find((item) => item.id === id)?.action)
  assert.match(store.noticeHistory.value.at(-1)!.message, /设备不可用/)
  const retry = store.runNoticeAction(id)
  assert.equal(await store.runNoticeAction(id), false)
  assert.equal(calls, 2)
  finish()
  assert.equal(await retry, true)
  assert.equal(store.noticeHistory.value.find((item) => item.id === id)?.action, undefined)
  clearNotices()
})

test('routine history eviction retains unfinished user actions', () => {
  clearNotices()
  const store = useAppNoticeStore()
  const id = store.pushNotice({ message: '可撤销操作', action: { label: '撤销', run: () => {} } })
  const failure = store.pushNotice({ kind: 'error', message: '待处理失败', presentation: 'center' })
  for (let index = 0; index < 70; index++) store.pushNotice({ message: '后台完成 ' + index })
  assert.equal(store.noticeHistory.value.length, 50)
  assert.ok(store.noticeHistory.value.find((item) => item.id === id)?.action)
  assert.ok(
    store.noticeHistory.value.find((item) => item.id === failure),
    'routine completions must not evict important failures first'
  )
  store.markHistoryRead([id])
  assert.equal(store.unreadCount.value, 49)
  clearNotices()
})

test('a new task with an identical result becomes unread while polling repeats stay read', () => {
  clearNotices()
  const store = useAppNoticeStore()
  const input = { message: '下载完成', dedupeKey: 'download-result:one', downloadTaskId: 'one' }
  const id = store.pushNotice(input)
  store.markHistoryRead()
  store.pushNotice(input)
  assert.equal(store.unreadCount.value, 0)
  assert.equal(store.pushNotice({ ...input, fresh: true }), id)
  assert.equal(store.unreadCount.value, 1)
  assert.equal(store.noticeHistory.value.length, 1)
  assert.equal(store.noticeHistory.value[0].downloadTaskId, 'one')
  store.dismissNotice(id)
  assert.equal(store.pushNotice(input), 0)
  assert.equal(store.pushNotice({ ...input, fresh: true }), id)
  clearNotices()
})
