import {
  BACKGROUND_EFFECT_RANGES,
  BACKGROUND_TEXT_PALETTES
} from '../../../shared/appAppearance.ts'

export interface TransparentAppearanceRecipe {
  textTone: 'light' | 'dark'
  dim: number
}

function luminance(red: number, green: number, blue: number): number {
  const linear = (channel: number): number => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return linear(red) * 0.2126 + linear(green) * 0.7152 + linear(blue) * 0.0722
}

/** Check descriptions as well as headings, including small bright regions of the image. */
export function recommendTransparentAppearance(
  pixels: ArrayLike<number>,
  sampleWidth?: number
): TransparentAppearanceRecipe {
  const regions: Array<Array<[number, number, number]>> = Array.from({ length: 16 }, () => [])
  const width = sampleWidth && Number.isInteger(sampleWidth) && sampleWidth > 0 ? sampleWidth : 0
  const height = width ? Math.ceil(pixels.length / 4 / width) : 0
  const samples: Array<[number, number, number]> = []
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index + 3] < 128) continue
    const sample: [number, number, number] = [pixels[index], pixels[index + 1], pixels[index + 2]]
    samples.push(sample)
    if (width) {
      const pixel = index / 4
      const column = Math.min(3, Math.floor(((pixel % width) * 4) / width))
      const row = Math.min(3, Math.floor((Math.floor(pixel / width) * 4) / height))
      regions[row * 4 + column].push(sample)
    }
  }
  if (!samples.length) return { textTone: 'light', dim: 70 }

  const foregrounds = (tone: 'light' | 'dark'): number[] =>
    Object.values(BACKGROUND_TEXT_PALETTES[tone]).map((color) =>
      luminance(
        Number.parseInt(color.slice(1, 3), 16),
        Number.parseInt(color.slice(3, 5), 16),
        Number.parseInt(color.slice(5, 7), 16)
      )
    )
  const groups = [samples, ...regions.filter((region) => region.length > 0)]
  const readable = (tone: 'light' | 'dark', dim: number): boolean => {
    const text = foregrounds(tone)
    const multiplier = 1 - dim / 100
    return groups.every((group) => {
      let count = 0
      for (const [r, g, b] of group) {
        const background = luminance(
          Math.round(r * multiplier),
          Math.round(g * multiplier),
          Math.round(b * multiplier)
        )
        if (
          text.every(
            (foreground) =>
              (Math.max(foreground, background) + 0.05) /
                (Math.min(foreground, background) + 0.05) >=
              4.5
          )
        )
          count++
      }
      return count >= Math.ceil(group.length * 0.9)
    })
  }
  if (readable('dark', 0)) return { textTone: 'dark', dim: 0 }

  for (let dim = 0; dim <= BACKGROUND_EFFECT_RANGES.dim.max; dim += 5) {
    if (readable('light', dim)) return { textTone: 'light', dim }
  }
  return { textTone: 'light', dim: BACKGROUND_EFFECT_RANGES.dim.max }
}
