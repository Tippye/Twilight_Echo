const DEFAULT_DOMINANT_COLOR = '#1a73e8'
const MAX_DOMINANT_COLOR_CACHE_SIZE = 64
const dominantColorCache = new Map<string, Promise<string>>()
let cacheGeneration = 0

export async function extractDominantColor(imageSrc: string): Promise<string> {
  const source = imageSrc.trim()
  if (!source) return DEFAULT_DOMINANT_COLOR
  const generation = cacheGeneration
  // Never retain materialized image data as a cache key. Secure renderer contexts
  // provide Web Crypto; in other contexts decoding without caching is safe.
  if (!globalThis.crypto?.subtle) return readDominantColor(source)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
  const cacheKey = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
  if (generation !== cacheGeneration) return readDominantColor(source)

  const cached = dominantColorCache.get(cacheKey)
  if (cached) {
    dominantColorCache.delete(cacheKey)
    dominantColorCache.set(cacheKey, cached)
    return cached
  }

  const request = readDominantColor(source)
  dominantColorCache.set(cacheKey, request)
  trimDominantColorCache()
  return request
}

export function clearDominantColorCache(): void {
  cacheGeneration += 1
  dominantColorCache.clear()
}

export function extractAverageColor(imageSrc: string): Promise<string | null> {
  const source = imageSrc.trim()
  if (!source) return Promise.resolve(null)

  return new Promise((resolve) => {
    const img = new Image()
    if (shouldUseAnonymousCors(source)) img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 32
        canvas.height = 32
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(null)
        ctx.drawImage(img, 0, 0, 32, 32)
        const pixels = ctx.getImageData(0, 0, 32, 32).data
        let red = 0
        let green = 0
        let blue = 0
        let totalAlpha = 0
        for (let i = 0; i < pixels.length; i += 4) {
          const alpha = pixels[i + 3]! / 255
          totalAlpha += alpha
          red += pixels[i]! * alpha
          green += pixels[i + 1]! * alpha
          blue += pixels[i + 2]! * alpha
        }
        if (totalAlpha === 0) return resolve(null)
        resolve(
          `#${[red, green, blue]
            .map((channel) =>
              Math.round(channel / totalAlpha)
                .toString(16)
                .padStart(2, '0')
            )
            .join('')}`
        )
      } catch {
        resolve(null)
      } finally {
        img.onload = null
        img.onerror = null
        img.src = ''
      }
    }
    img.onerror = () => {
      img.onload = null
      img.onerror = null
      img.src = ''
      resolve(null)
    }
    img.src = source
  })
}

function trimDominantColorCache(): void {
  while (dominantColorCache.size > MAX_DOMINANT_COLOR_CACHE_SIZE) {
    const oldest = dominantColorCache.keys().next().value
    if (!oldest) return
    dominantColorCache.delete(oldest)
  }
}

function readDominantColor(imageSrc: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    // canvas getImageData requires a CORS-clean bitmap. Prefer anonymous for
    // remote-ish schemes that we control (twilight-media / cover / http(s)).
    // Never use credentials — grant tokens must not ride cookies.
    if (shouldUseAnonymousCors(imageSrc)) {
      img.crossOrigin = 'anonymous'
    }
    img.onload = () => {
      try {
        const size = 50
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(DEFAULT_DOMINANT_COLOR)
          return
        }
        ctx.drawImage(img, 0, 0, size, size)
        const data = ctx.getImageData(0, 0, size, size).data

        const buckets = 12
        const hist = new Map<number, number>()

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          const a = data[i + 3]
          if (a < 128) continue

          const max = Math.max(r, g, b)
          const min = Math.min(r, g, b)
          if (max - min < 15) continue
          if (max < 40 || min > 220) continue

          const ri = Math.floor((r / 255) * (buckets - 1))
          const gi = Math.floor((g / 255) * (buckets - 1))
          const bi = Math.floor((b / 255) * (buckets - 1))
          const key = (ri << 16) | (gi << 8) | bi
          hist.set(key, (hist.get(key) || 0) + 1)
        }

        if (hist.size === 0) {
          resolve(DEFAULT_DOMINANT_COLOR)
          return
        }

        let bestKey = 0
        let bestCount = 0
        for (const [key, count] of hist) {
          if (count > bestCount) {
            bestCount = count
            bestKey = key
          }
        }

        const r = Math.round((((bestKey >> 16) & 0xff) / (buckets - 1)) * 255)
        const g = Math.round((((bestKey >> 8) & 0xff) / (buckets - 1)) * 255)
        const b = Math.round(((bestKey & 0xff) / (buckets - 1)) * 255)

        const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
        resolve(hex)
      } catch {
        // Tainted canvas / decode failure: keep the default accent color.
        resolve(DEFAULT_DOMINANT_COLOR)
      } finally {
        img.onload = null
        img.onerror = null
        img.src = ''
      }
    }
    img.onerror = () => {
      img.onload = null
      img.onerror = null
      img.src = ''
      resolve(DEFAULT_DOMINANT_COLOR)
    }
    img.src = imageSrc
  })
}

function shouldUseAnonymousCors(imageSrc: string): boolean {
  return /^(https?:|twilight-media:|cover:|background:)/i.test(imageSrc.trim())
}

type RgbColor = { r: number; g: number; b: number }
type HslColor = { h: number; s: number; l: number }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function hexToRgb(hex: string): RgbColor | null {
  const value = hex.trim().replace(/^#/, '')
  if (!/^[\da-fA-F]{6}$/.test(value)) return null

  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16)
  }
}

function rgbToHsl({ r, g, b }: RgbColor): HslColor {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min

  let h = 0
  const l = (max + min) / 2
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))

  if (delta !== 0) {
    switch (max) {
      case rn:
        h = ((gn - bn) / delta) % 6
        break
      case gn:
        h = (bn - rn) / delta + 2
        break
      default:
        h = (rn - gn) / delta + 4
        break
    }
    h *= 60
    if (h < 0) h += 360
  }

  return { h, s, l }
}

function hslToRgb({ h, s, l }: HslColor): RgbColor {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))

  let rn = 0
  let gn = 0
  let bn = 0

  if (hp >= 0 && hp < 1) {
    rn = c
    gn = x
  } else if (hp < 2) {
    rn = x
    gn = c
  } else if (hp < 3) {
    gn = c
    bn = x
  } else if (hp < 4) {
    gn = x
    bn = c
  } else if (hp < 5) {
    rn = x
    bn = c
  } else {
    rn = c
    bn = x
  }

  const m = l - c / 2
  return {
    r: Math.round((rn + m) * 255),
    g: Math.round((gn + m) * 255),
    b: Math.round((bn + m) * 255)
  }
}

function rgbToHex({ r, g, b }: RgbColor): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

export function normalizeAccentColor(color: string): string {
  const rgb = hexToRgb(color)
  if (!rgb) return '#3567b5'

  const hsl = rgbToHsl(rgb)
  const normalized = {
    h: hsl.h,
    s: clamp(hsl.s * 0.56 + 0.18, 0.32, 0.64),
    l: clamp(hsl.l * 0.42 + 0.25, 0.34, 0.52)
  }

  return rgbToHex(hslToRgb(normalized))
}
