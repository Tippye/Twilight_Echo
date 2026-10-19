import { computed, ref, shallowRef } from 'vue'
import type {
  NetworkEntry,
  NetworkSourceProfileSummary
} from '../../../../shared/networkSources.ts'

type DirectoryReader = (profileId: string, path: string) => Promise<NetworkEntry[]>
export interface NetworkLibraryItem {
  profileId: string
  profileName: string
  entry: NetworkEntry
}
type LibraryReader = (query?: string) => Promise<NetworkLibraryItem[]>
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * 端口输入归一化。`<input type="number">` 上的 `v-model` 会把已填写的值转成
 * number，而空值仍是字符串 `''`；两种形态都会传到这里，因此不能假设字符串
 * 方法可用。非法端口抛出可读错误，交由调用方展示。
 */
export function parseOptionalPort(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  if (text === '') return null
  const port = Number(text)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('端口需为 1-65535 之间的整数')
  }
  return port
}

/** Owns directory state. I/O is a narrow port, with no player or window dependency. */
export function createNetworkBrowser(readDirectory?: DirectoryReader) {
  const profile = shallowRef<NetworkSourceProfileSummary | null>(null)
  const path = ref('/')
  const entries = shallowRef<NetworkEntry[]>([])
  const loading = ref(false)
  const error = ref('')
  let revision = 0
  let disposed = false

  function capture(): () => boolean {
    const capturedRevision = revision
    return () => !disposed && capturedRevision === revision
  }

  async function navigateTo(nextPath: string): Promise<void> {
    if (!readDirectory || !profile.value || disposed) return
    const profileId = profile.value.id
    revision++
    const current = capture()
    path.value = nextPath
    entries.value = []
    loading.value = true
    error.value = ''
    try {
      const result = await readDirectory(profileId, nextPath)
      if (current()) entries.value = result
    } catch (failure) {
      if (current()) error.value = `读取目录失败：${messageOf(failure)}`
    } finally {
      if (current()) loading.value = false
    }
  }

  function leave(): void {
    revision++
    profile.value = null
    path.value = '/'
    entries.value = []
    error.value = ''
    loading.value = false
  }

  return {
    profile: computed(() => profile.value),
    path: computed(() => path.value),
    entries: computed(() => entries.value),
    loading: computed(() => loading.value),
    error: computed(() => error.value),
    capture,
    navigateTo,
    async enter(nextProfile: NetworkSourceProfileSummary) {
      if (disposed) return
      leave()
      profile.value = nextProfile
      path.value = nextProfile.rootPath
      await navigateTo(nextProfile.rootPath)
    },
    replaceProfile(nextProfile: NetworkSourceProfileSummary) {
      if (!disposed && profile.value?.id === nextProfile.id) profile.value = nextProfile
    },
    leave,
    dispose() {
      disposed = true
      leave()
    }
  }
}

/** Query results are immutable snapshots; shallow refs avoid per-row reactive proxies. */
export function createNetworkLibraryView(search?: LibraryReader, debounceMs = 150) {
  const query = ref('')
  const items = shallowRef<NetworkLibraryItem[]>([])
  const loading = ref(false)
  const error = ref('')
  let revision = 0
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  function cancel(): void {
    revision++
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    loading.value = false
  }

  async function load(): Promise<void> {
    cancel()
    if (!search || disposed) return
    const request = revision
    const requestedQuery = query.value
    const current = (): boolean =>
      !disposed && revision === request && query.value === requestedQuery
    loading.value = true
    error.value = ''
    try {
      const result = await search(requestedQuery)
      if (current()) items.value = result
    } catch (failure) {
      if (current()) error.value = `读取媒体库失败：${messageOf(failure)}`
    } finally {
      if (current()) loading.value = false
    }
  }

  return {
    query,
    items: computed(() => items.value),
    loading: computed(() => loading.value),
    error: computed(() => error.value),
    load,
    schedule() {
      cancel()
      items.value = []
      error.value = ''
      if (disposed || !search) return
      loading.value = true
      timer = setTimeout(() => {
        timer = undefined
        void load()
      }, debounceMs)
    },
    leave() {
      cancel()
      items.value = []
      error.value = ''
    },
    dispose() {
      disposed = true
      cancel()
      items.value = []
    }
  }
}
