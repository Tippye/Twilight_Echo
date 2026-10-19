import { computed, readonly, ref } from 'vue'

export type AppNoticeKind = 'info' | 'success' | 'warning' | 'error'

export type AppNoticeAction = {
  label: string
  run: () => void | Promise<unknown>
}

export type AppNotice = {
  id: number
  kind: AppNoticeKind
  message: string
  createdAt: number
  read: boolean
  action?: AppNoticeAction
  sticky?: boolean
  dedupeKey?: string
  presentation: 'toast' | 'center'
  downloadTaskId?: string
}

const notices = ref<AppNotice[]>([])
const noticeHistory = ref<AppNotice[]>([])
// Task state lives outside the notice store. Keep tombstones when history is
// cleared so completed tasks do not immediately reappear in TaskCenter.
const clearedTaskResultKeys = ref(new Set<string>())
const centerOpen = ref(false)
const activeTaskCount = ref(0)
const pendingActions = ref(new Set<number>())
const DO_NOT_DISTURB_STORAGE_KEY = 'twilight-echo:notice-do-not-disturb'
const doNotDisturb = ref(readDoNotDisturb())
let nextNoticeId = 1
const dismissTimers = new Map<number, ReturnType<typeof setTimeout>>()
const timerState = new Map<number, { remaining: number; started: number; pauses: Set<string> }>()
// A dedupe key the user explicitly closed, mapped to the exact message they
// closed. A repeat of that same message stays suppressed — an event source that
// re-fires on a poll interval must not be able to out-click the user. A changed
// message is new information, so it releases the suppression.
const suppressedDedupeMessages = new Map<string, string>()

function readDoNotDisturb(): boolean {
  try {
    return globalThis.localStorage?.getItem(DO_NOT_DISTURB_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function setDoNotDisturb(enabled: boolean): void {
  doNotDisturb.value = enabled
  if (enabled) {
    for (const id of dismissTimers.keys()) clearDismissTimer(id)
    timerState.clear()
    notices.value = []
  }
  try {
    globalThis.localStorage?.setItem(DO_NOT_DISTURB_STORAGE_KEY, String(enabled))
  } catch {
    // Keep the current session quiet even when preference storage is unavailable.
  }
}

function clearDismissTimer(id: number): void {
  const timer = dismissTimers.get(id)
  if (timer == null) return
  clearTimeout(timer)
  dismissTimers.delete(id)
}

function scheduleAutoDismiss(notice: AppNotice, durationMs?: number): void {
  const pauses = timerState.get(notice.id)?.pauses ?? new Set<string>()
  clearDismissTimer(notice.id)
  timerState.delete(notice.id)
  if (notice.sticky || notice.presentation === 'center') return
  const delayMs = Math.max(2500, durationMs ?? 7000)
  timerState.set(notice.id, { remaining: delayMs, started: Date.now(), pauses })
  if (pauses.size) return
  dismissTimers.set(
    notice.id,
    setTimeout(() => {
      clearDismissTimer(notice.id)
      timerState.delete(notice.id)
      notices.value = notices.value.filter((item) => item.id !== notice.id)
    }, delayMs)
  )
}

function appendHistory(notice: AppNotice): void {
  const history = [...noticeHistory.value, notice]
  while (history.length > 50) {
    const ordinary = history.findIndex(
      (item) => !item.action && ['info', 'success'].includes(item.kind)
    )
    const index = ordinary >= 0 ? ordinary : history.findIndex((item) => !item.action)
    if (index < 0) break
    history.splice(index, 1)
  }
  noticeHistory.value = history
}

function present(notice: AppNotice, durationMs?: number): void {
  if (doNotDisturb.value || notice.presentation === 'center') {
    clearDismissTimer(notice.id)
    timerState.delete(notice.id)
    notices.value = notices.value.filter((item) => item.id !== notice.id)
    return
  }
  const existing = notices.value.some((item) => item.id === notice.id)
  if (existing) notices.value = notices.value.map((item) => (item.id === notice.id ? notice : item))
  else {
    if (notices.value.length >= 4) {
      clearDismissTimer(notices.value[0].id)
      timerState.delete(notices.value[0].id)
    }
    notices.value = [...notices.value.slice(-3), notice]
  }
  scheduleAutoDismiss(notice, durationMs)
}

export function useAppNoticeStore() {
  /** Closing a deduped notice suppresses that exact message until it changes. */
  function dismissNotice(id: number): void {
    const notice =
      notices.value.find((item) => item.id === id) ??
      noticeHistory.value.find((item) => item.id === id)
    if (notice?.dedupeKey) suppressedDedupeMessages.set(notice.dedupeKey, notice.message)
    clearDismissTimer(id)
    timerState.delete(id)
    notices.value = notices.value.filter((item) => item.id !== id)
  }

  /** Let a dedupe key notify again even if the message is unchanged. */
  function releaseNoticeDedupe(dedupeKey: string): void {
    suppressedDedupeMessages.delete(dedupeKey)
  }

  function clearNotices(): void {
    for (const id of dismissTimers.keys()) clearDismissTimer(id)
    suppressedDedupeMessages.clear()
    timerState.clear()
    notices.value = []
    noticeHistory.value = []
    clearedTaskResultKeys.value.clear()
  }

  function pushNotice(input: {
    kind?: AppNoticeKind
    message: string
    action?: AppNoticeAction
    sticky?: boolean
    durationMs?: number
    dedupeKey?: string
    downloadTaskId?: string
    /** A new task outcome may repeat the text of a previously read result. */
    fresh?: boolean
    presentation?: 'toast' | 'center'
  }): number {
    const message = input.message.trim()
    if (!message) return 0
    const dedupeKey = input.dedupeKey?.trim() || undefined
    const kind = input.kind ?? 'info'
    if (dedupeKey) clearedTaskResultKeys.value.delete(dedupeKey)
    if (input.downloadTaskId) {
      clearedTaskResultKeys.value.delete('download-result:' + input.downloadTaskId)
    }
    const sticky = input.sticky ?? (kind === 'error' || kind === 'warning' || !!input.action)
    const presentation =
      input.presentation ?? (kind === 'error' || input.action ? 'toast' : 'center')

    if (dedupeKey) {
      if (!input.fresh && suppressedDedupeMessages.get(dedupeKey) === message) return 0
      suppressedDedupeMessages.delete(dedupeKey)
      // Update in place so a repeating source keeps one stable toast instead of
      // replacing it with a fresh id the user has to chase.
      const existing =
        notices.value.find((item) => item.dedupeKey === dedupeKey) ??
        noticeHistory.value.find((item) => item.dedupeKey === dedupeKey)
      if (existing) {
        const updated: AppNotice = {
          ...existing,
          kind,
          message,
          action: input.action,
          sticky,
          presentation,
          downloadTaskId: input.downloadTaskId
        }
        if (
          input.fresh ||
          existing.message !== message ||
          existing.kind !== kind ||
          existing.action?.label !== input.action?.label
        ) {
          updated.read = false
          updated.createdAt = Date.now()
          if (!noticeHistory.value.some((item) => item.id === existing.id)) {
            appendHistory(updated)
          }
        }
        noticeHistory.value = noticeHistory.value.map((item) =>
          item.id === existing.id ? updated : item
        )
        present(updated, input.durationMs)
        return updated.id
      }
    }

    const notice: AppNotice = {
      id: nextNoticeId++,
      kind,
      message,
      createdAt: Date.now(),
      read: false,
      action: input.action,
      sticky,
      dedupeKey,
      presentation,
      downloadTaskId: input.downloadTaskId
    }
    appendHistory(notice)
    present(notice, input.durationMs)
    return notice.id
  }

  async function runNoticeAction(id: number): Promise<boolean> {
    const notice =
      noticeHistory.value.find((item) => item.id === id) ??
      notices.value.find((item) => item.id === id)
    const action = notice?.action
    if (!action || pendingActions.value.has(id)) return false
    pendingActions.value.add(id)
    try {
      await action.run()
      const current =
        noticeHistory.value.find((item) => item.id === id) ??
        notices.value.find((item) => item.id === id)
      if (current?.action === action) {
        current.action = undefined
        dismissNotice(id)
      }
      return true
    } catch (error) {
      pushNotice({
        kind: 'error',
        message: `${action.label}失败：${error instanceof Error ? error.message : '请重试'}`,
        dedupeKey: `notice-action-${id}`,
        presentation: 'center'
      })
      return false
    } finally {
      pendingActions.value.delete(id)
    }
  }

  return {
    notices,
    noticeHistory,
    clearedTaskResultKeys,
    centerOpen,
    activeTaskCount,
    pendingActions,
    doNotDisturb: readonly(doNotDisturb),
    setDoNotDisturb,
    unreadCount: computed(() => noticeHistory.value.filter((notice) => !notice.read).length),
    markHistoryRead: (ids?: number[]) => {
      const selected = ids && new Set(ids)
      for (const notice of noticeHistory.value)
        if (!selected || selected.has(notice.id)) notice.read = true
    },
    clearHistory: () => {
      for (const notice of noticeHistory.value) {
        if (notice.dedupeKey?.startsWith('task-result:')) {
          clearedTaskResultKeys.value.add(notice.dedupeKey)
        }
        if (notice.downloadTaskId) {
          clearedTaskResultKeys.value.add('download-result:' + notice.downloadTaskId)
        }
      }
      noticeHistory.value = []
    },
    setCenterOpen: (value: boolean) => {
      centerOpen.value = value
    },
    runNoticeAction,
    pauseNotice,
    resumeNotice,
    pushNotice,
    dismissNotice,
    releaseNoticeDedupe,
    clearNotices
  }
}

function pauseNotice(id: number, reason: string): void {
  const state = timerState.get(id)
  if (!state || state.pauses.has(reason)) return
  if (state.pauses.size === 0) {
    state.remaining = Math.max(0, state.remaining - (Date.now() - state.started))
    clearDismissTimer(id)
  }
  state.pauses.add(reason)
}
function resumeNotice(id: number, reason: string): void {
  const state = timerState.get(id)
  if (!state || !state.pauses.delete(reason) || state.pauses.size > 0) return
  state.started = Date.now()
  dismissTimers.set(
    id,
    setTimeout(() => {
      clearDismissTimer(id)
      timerState.delete(id)
      notices.value = notices.value.filter((item) => item.id !== id)
    }, state.remaining)
  )
}
