import { WINDOWS_QUALITY_OPTIONS } from './quality.mjs'
export const WINDOWS_QUALITY_KEY = 'windows-playback-quality'
export const WINDOWS_QUALITY_COMMAND = 'qqmusic.windows.quality'
const OPTIONS = WINDOWS_QUALITY_OPTIONS
const owners = new WeakMap()

// SDK settings writes read-modify-write one shared file. All Windows source
// callers share this queue so independent quality/device/auth writes retain keys.
export function serializeWindowsSettings(settings) {
  if (owners.has(settings)) return owners.get(settings)
  let writes = Promise.resolve()
  const mutate = fn => {
    const result = writes.then(fn)
    writes = result.catch(() => {})
    return result
  }
  // A host read may migrate legacy sensitive values and write the same file.
  const owner = { get: (key, guard) => mutate(() => { guard?.(); return settings.get(key) }),
    getNormalized: (key, normalize, guard) => mutate(async () => {
      guard?.()
      const stored = await settings.get(key)
      guard?.()
      const value = normalize(stored)
      if (value !== stored) await settings.set(key, value)
      return value
    }),
    set: (key, value, guard) => mutate(() => { guard?.(); return settings.set(key, value) }),
    delete: key => mutate(() => settings.delete(key)) }
  owners.set(settings, owner)
  owners.set(owner, owner)
  return owner
}

// Only the retired composite labels migrate. Unknown/corrupt values still fail,
// and real network qualities (including master/galaxy) retain their identities.
export function normalizeRetiredWindowsQuality(value) {
  return value === 'excellent' || value === 'excellentSpatial' ? '128' : value
}

export async function windowsPlaybackQuality(settings, { guard } = {}) {
  guard?.()
  const stored = await serializeWindowsSettings(settings).getNormalized(WINDOWS_QUALITY_KEY,
    normalizeRetiredWindowsQuality, guard)
  guard?.()
  if (stored === undefined || stored === null) return '128'
  if (!OPTIONS.some(option => option.value === stored)) throw new Error('QQ 音乐音质设置无效')
  return stored
}

export async function windowsQualityState(settings, options) {
  const quality = await windowsPlaybackQuality(settings, options)
  options?.guard?.()
  return { quality, options: OPTIONS }
}

export async function setWindowsPlaybackQuality(settings, quality, { guard } = {}) {
  if (typeof quality !== 'string' || !OPTIONS.some(option => option.value === quality)) {
    throw new Error('请选择有效的 QQ 音乐音质')
  }
  guard?.()
  await serializeWindowsSettings(settings).set(WINDOWS_QUALITY_KEY, quality, guard)
  guard?.()
  // Return this committed selection without another queued read that could
  // observe a later concurrent selection. The player owns applying it to a stream.
  return { quality, options: OPTIONS }
}

function qualityForm(state) {
  return { kind: 'settings-form', submitCommand: WINDOWS_QUALITY_COMMAND,
    notice: '播放器可立即切换音质；在设置页保存后，下次播放应用。所选音质需要歌曲和账号支持。',
    fields: [{ key: 'quality', label: '播放音质', type: 'select', required: true,
      value: state.quality, options: state.options }] }
}

export async function windowsQualityForm(settings, options) {
  const state = await windowsQualityState(settings, options)
  options?.guard?.()
  return qualityForm(state)
}

export async function saveWindowsQuality(settings, values, options) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('请选择有效的 QQ 音乐音质')
  const state = await setWindowsPlaybackQuality(settings, values.quality, options)
  options?.guard?.()
  return { message: '音质已保存，下次播放应用。可在播放器切换当前歌曲音质。', form: qualityForm(state) }
}
