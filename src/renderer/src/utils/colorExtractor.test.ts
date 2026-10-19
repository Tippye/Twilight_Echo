import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'

const { clearDominantColorCache, extractDominantColor, extractAverageColor } = (await import(
  new URL('./colorExtractor.ts', import.meta.url).href
)) as typeof import('./colorExtractor')

const globalRecord = {
  get Image(): unknown {
    return (globalThis as { Image?: unknown }).Image
  },
  set Image(value: unknown) {
    ;(globalThis as { Image?: unknown }).Image = value
  },
  get document(): unknown {
    return (globalThis as { document?: unknown }).document
  },
  set document(value: unknown) {
    ;(globalThis as { document?: unknown }).document = value
  }
}

const originalImage = globalRecord.Image
const originalDocument = globalRecord.document

test('materialized covers retain only fixed-size digest keys and clearing invalidates pending hashes', async () => {
  const dom = installImageDom(makeImageData(200, 50, 30))
  try {
    const source = stripTypeScriptTypes(
      readFileSync(new URL('./colorExtractor.ts', import.meta.url), 'utf8')
    ).replace(/\bexport /g, '')
    let finish!: (digest: ArrayBuffer) => void
    const api = runInNewContext(
      `${source}\n({extractDominantColor,clearDominantColorCache,dominantColorCache})`,
      {
        Image: globalRecord.Image,
        document: globalRecord.document,
        TextEncoder,
        Uint8Array,
        crypto: {
          subtle: {
            digest: () =>
              new Promise((resolve) => {
                finish = resolve
              })
          }
        }
      }
    )
    const cover = 'data:image/png;base64,' + 'a'.repeat(1024 * 1024)
    const pending = api.extractDominantColor(cover)
    finish(new Uint8Array(32).buffer)
    await pending
    assert.equal(api.dominantColorCache.size, 1)
    assert.equal([...api.dominantColorCache.keys()][0].length, 64)
    const late = api.extractDominantColor(cover + 'b')
    api.clearDominantColorCache()
    finish(new Uint8Array(32).buffer)
    await late
    assert.equal(api.dominantColorCache.size, 0)
  } finally {
    dom.restore()
  }
})

function makeImageData(r: number, g: number, b: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(50 * 50 * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = 255
  }
  return data
}

function installImageDom(data: Uint8ClampedArray): {
  getLoadCount: () => number
  restore: () => void
} {
  let loadCount = 0

  class FakeImage {
    crossOrigin = ''
    onload: (() => void) | null = null
    onerror: (() => void) | null = null

    set src(value: string) {
      if (!value) return
      loadCount++
      queueMicrotask(() => this.onload?.())
    }
  }

  globalRecord.Image = FakeImage
  ;(globalRecord.document as { createElement: unknown } | null) = {
    createElement(tagName: string) {
      assert.equal(tagName, 'canvas')
      return {
        width: 0,
        height: 0,
        getContext(type: string) {
          assert.equal(type, '2d')
          return {
            drawImage(): void {},
            getImageData(): { data: Uint8ClampedArray } {
              return { data }
            }
          }
        }
      }
    }
  }

  return {
    getLoadCount: () => loadCount,
    restore: () => {
      globalRecord.Image = originalImage
      globalRecord.document = originalDocument
      clearDominantColorCache()
    }
  }
}

test('extractDominantColor reuses in-flight and completed cover color requests', async () => {
  const dom = installImageDom(makeImageData(200, 50, 30))
  try {
    clearDominantColorCache()
    const [first, second] = await Promise.all([
      extractDominantColor('cover://same.jpg'),
      extractDominantColor('cover://same.jpg')
    ])
    const third = await extractDominantColor('cover://same.jpg')

    assert.equal(first, second)
    assert.equal(second, third)
    assert.equal(dom.getLoadCount(), 1)
  } finally {
    dom.restore()
  }
})

test('extractDominantColor returns the fallback color for blank covers without decoding', async () => {
  const dom = installImageDom(makeImageData(200, 50, 30))
  try {
    clearDominantColorCache()
    assert.equal(await extractDominantColor('   '), '#1a73e8')
    assert.equal(dom.getLoadCount(), 0)
  } finally {
    dom.restore()
  }
})

test('extractAverageColor preserves a mostly white cover instead of darkening it', async () => {
  const pixels = makeImageData(255, 255, 255)
  for (let i = 0; i < 100 * 4; i += 4) {
    pixels[i] = 40
    pixels[i + 1] = 140
    pixels[i + 2] = 220
  }
  const dom = installImageDom(pixels)
  try {
    assert.equal(await extractAverageColor('cover://mostly-white.jpg'), '#f6fafe')
    assert.equal(await extractAverageColor('  '), null)
    assert.equal(dom.getLoadCount(), 1)
  } finally {
    dom.restore()
  }
})

test('extractDominantColor uses anonymous CORS only for remote-ish cover schemes', async () => {
  let lastCrossOrigin = ''
  class TrackingImage {
    crossOrigin = ''
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) {
      lastCrossOrigin = this.crossOrigin
      queueMicrotask(() => this.onload?.())
    }
  }
  const previousImage = globalRecord.Image
  const previousDocument = globalRecord.document
  globalRecord.Image = TrackingImage
  ;(globalRecord.document as { createElement: unknown } | null) = {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage(): void {},
            getImageData(): { data: Uint8ClampedArray } {
              return { data: makeImageData(10, 120, 200) }
            }
          }
        }
      }
    }
  }
  try {
    clearDominantColorCache()
    await extractDominantColor('twilight-media://image/token-1')
    assert.equal(lastCrossOrigin, 'anonymous')
    clearDominantColorCache()
    await extractDominantColor('data:image/png;base64,abc')
    assert.equal(lastCrossOrigin, '')
  } finally {
    globalRecord.Image = previousImage
    globalRecord.document = previousDocument
    clearDominantColorCache()
  }
})
