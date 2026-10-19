import assert from 'node:assert/strict'
import test from 'node:test'
import { recommendTransparentAppearance } from './transparentAppearanceRecipe.ts'
import { themeContrastRatio } from '../../../shared/theme.ts'
import {
  BACKGROUND_EFFECT_RANGES,
  BACKGROUND_TEXT_PALETTES
} from '../../../shared/appAppearance.ts'

const pixels = (colors: number[][]): number[] => colors.flatMap((color) => [...color, 255])
test('transparent recipes choose readable text without unnecessarily dimming bright or dark artwork', () => {
  assert.deepEqual(recommendTransparentAppearance(pixels([[245, 245, 245]])), {
    textTone: 'dark',
    dim: 0
  })
  assert.deepEqual(recommendTransparentAppearance(pixels([[20, 30, 45]])), {
    textTone: 'light',
    dim: 0
  })
  const colors = [
    [10, 10, 10],
    [255, 255, 255],
    [120, 150, 180],
    [40, 50, 60]
  ]
  const recipe = recommendTransparentAppearance(pixels(colors))
  assert.equal(recipe.textTone, 'light')
  for (const color of colors) {
    const masked = color.map((channel) => channel * (1 - recipe.dim / 100))
    for (const foreground of Object.values(BACKGROUND_TEXT_PALETTES[recipe.textTone])) {
      assert.ok((themeContrastRatio(foreground, `rgb(${masked.join(',')})`) ?? 0) >= 4.5)
    }
  }
  assert.deepEqual(recommendTransparentAppearance([]), { textTone: 'light', dim: 70 })
  assert.deepEqual(recommendTransparentAppearance([255, 255, 255, 0]), {
    textTone: 'light',
    dim: 70
  })
})

test('recipes protect secondary text near the heading contrast threshold', () => {
  for (const gray of [90, 100, 120, 160, 190, 210, 230]) {
    const recipe = recommendTransparentAppearance(pixels([[gray, gray, gray]]))
    const masked = gray * (1 - recipe.dim / 100)
    for (const foreground of Object.values(BACKGROUND_TEXT_PALETTES[recipe.textTone])) {
      assert.ok((themeContrastRatio(foreground, `rgb(${masked},${masked},${masked})`) ?? 0) >= 4.5)
    }
    assert.ok(recipe.dim <= BACKGROUND_EFFECT_RANGES.dim.max)
  }
})

test('small bright regions cannot be hidden by the image-wide dark majority', () => {
  const colors = Array.from({ length: 16 * 16 }, (_, index) =>
    index % 16 < 4 && Math.floor(index / 16) < 4 ? [255, 255, 255] : [20, 30, 45]
  )
  assert.equal(recommendTransparentAppearance(pixels(colors)).dim, 0)
  const recipe = recommendTransparentAppearance(pixels(colors), 16)
  assert.equal(recipe.textTone, 'light')
  assert.ok(recipe.dim > 0)
  const masked = 255 * (1 - recipe.dim / 100)
  for (const foreground of Object.values(BACKGROUND_TEXT_PALETTES.light)) {
    assert.ok((themeContrastRatio(foreground, `rgb(${masked},${masked},${masked})`) ?? 0) >= 4.5)
  }
})

test('analysis fallback protects descriptions even over a white image', () => {
  const recipe = recommendTransparentAppearance([])
  const masked = 255 * (1 - recipe.dim / 100)
  for (const foreground of Object.values(BACKGROUND_TEXT_PALETTES[recipe.textTone])) {
    assert.ok((themeContrastRatio(foreground, `rgb(${masked},${masked},${masked})`) ?? 0) >= 4.5)
  }
})
