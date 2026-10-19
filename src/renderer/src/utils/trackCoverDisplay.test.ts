import assert from 'node:assert/strict'
import test from 'node:test'

test('useTrackCoverSrc clears previous src and mints a fresh blob per track', async () => {
  const blobs: string[] = []
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  const originalFetch = globalThis.fetch

  URL.createObjectURL = ((blob: Blob) => {
    const url = `blob:track-cover-${blobs.length}-${blob.size}`
    blobs.push(url)
    return url
  }) as typeof URL.createObjectURL
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL

  const globalRecord = globalThis as unknown as {
    window?: unknown
  }
  const previousWindow = globalRecord.window
  globalRecord.window = {
    api: {
      data: {
        getCover: async (handle: string): Promise<string | null> => {
          if (handle.includes('a.jpg')) return 'data:image/jpeg;base64,YWFh'
          if (handle.includes('b.jpg')) return 'data:image/jpeg;base64,YmJi'
          return null
        }
      }
    }
  } as unknown

  let fetchCalls = 0
  globalThis.fetch = (async () => {
    fetchCalls++
    throw new Error('connect-src does not allow inline images')
  }) as typeof fetch

  try {
    const { useTrackCoverSrc } = (await import(
      new URL('./trackCoverDisplay.ts', import.meta.url).href
    )) as typeof import('./trackCoverDisplay')
    const { ref, nextTick, computed } = await import('vue')

    const track = ref<{ id: string; cover: string | null; coverSource?: string | null } | null>({
      id: 't1',
      cover: 'cover://a.jpg'
    })
    const trackComputed = computed(() => track.value)
    const { src, key } = useTrackCoverSrc(trackComputed)
    await nextTick()
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(src.value, 'blob:track-cover-0-3')
    assert.match(key.value, /^t1:/)

    track.value = { id: 't2', cover: 'cover://b.jpg' }
    await nextTick()
    // Must blank while loading the next track.
    assert.equal(src.value, null)
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(src.value, 'blob:track-cover-1-3')
    assert.match(key.value, /^t2:/)
    assert.equal(blobs.length, 2)
    assert.equal(fetchCalls, 0)
  } finally {
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
    globalThis.fetch = originalFetch
    globalRecord.window = previousWindow
  }
})
