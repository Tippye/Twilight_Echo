import assert from 'node:assert/strict'
import test from 'node:test'

import { PLAYER_BAR_MODES } from './playerBar.ts'
import {
  DEFAULT_PLAYER_BAR_LAYOUT,
  PLAYER_BAR_CONTROL_IDS,
  PLAYER_BAR_REGION_NAMES,
  clonePlayerBarLayout,
  normalizePlayerBarLayout,
  resolvePlayerBarRegions,
  unplacedPlayerBarControls
} from './playerBarLayout.ts'

/**
 * Defaults and migration must keep playback reachable without replacing a
 * user's custom arrangement.
 */
test('ordinary desktop pages retain artwork, transport and utility regions', () => {
  assert.deepEqual(DEFAULT_PLAYER_BAR_LAYOUT, {
    standard: {
      left: ['cover', 'trackInfo'],
      center: ['transport'],
      right: ['favorite', 'playMode', 'volume', 'queue', 'miniPlayer', 'desktopLyrics', 'hifi']
    },
    mini: {
      left: ['playPause'],
      center: [],
      right: ['playMode', 'volume', 'queue', 'hifi', 'exitPlayingPage']
    },
    compact: {
      left: ['cover', 'trackInfo', 'favorite', 'miniPlayer'],
      center: ['playMode', 'transport', 'equalizer'],
      // `exitPlayingPage` renders only while the now-playing page is open, so it
      // costs the main window nothing — and without it the page could only be
      // dismissed by clicking the same entry that opened it.
      right: ['time', 'hifi', 'volume', 'desktopLyrics', 'queue', 'exitPlayingPage']
    }
  })
})

test('resolving desktop layouts preserves saved settings and custom arrangements', () => {
  const layout = normalizePlayerBarLayout(undefined)
  const saved = structuredClone(layout)
  assert.deepEqual(resolvePlayerBarRegions(layout, 'standard'), DEFAULT_PLAYER_BAR_LAYOUT.standard)
  assert.deepEqual(layout, saved, 'resolving controls cannot rewrite saved settings')
  const custom = {
    ...layout.standard,
    center: ['playMode', 'transport'],
    right: ['queue', 'volume']
  }
  assert.deepEqual(normalizePlayerBarLayout({ standard: custom }).standard, custom)
  assert.deepEqual(
    resolvePlayerBarRegions({ ...layout, standard: custom } as never, 'standard'),
    custom
  )
})

test('both PR 123 defaults recover the restored arrangement without changing custom layouts', () => {
  for (const previous of [
    {
      left: ['cover', 'trackInfo'],
      center: ['playMode', 'transport', 'volume'],
      right: ['favorite', 'queue', 'miniPlayer', 'desktopLyrics', 'hifi']
    },
    {
      left: ['trackInfo', 'favorite', 'miniPlayer'],
      center: ['playMode', 'transport', 'volume'],
      right: ['hifi', 'desktopLyrics', 'queue']
    }
  ]) {
    const saved = structuredClone(previous)
    assert.deepEqual(
      normalizePlayerBarLayout({ standard: previous }).standard,
      DEFAULT_PLAYER_BAR_LAYOUT.standard
    )
    assert.deepEqual(
      resolvePlayerBarRegions({ standard: previous } as never, 'standard'),
      DEFAULT_PLAYER_BAR_LAYOUT.standard
    )
    assert.deepEqual(previous, saved)
    const custom = { ...previous, right: [...previous.right].reverse() }
    assert.deepEqual(normalizePlayerBarLayout({ standard: custom }).standard, custom)
    assert.deepEqual(resolvePlayerBarRegions({ standard: custom } as never, 'standard'), custom)
  }
})

test('restored ordinary defaults preserve nearby custom layouts', () => {
  const legacy = {
    left: ['cover', 'trackInfo'],
    center: ['transport'],
    right: ['favorite', 'playMode', 'volume', 'queue', 'miniPlayer', 'desktopLyrics', 'hifi']
  }
  const saved = structuredClone(legacy)
  assert.deepEqual(
    normalizePlayerBarLayout({ standard: legacy }).standard,
    DEFAULT_PLAYER_BAR_LAYOUT.standard
  )
  assert.deepEqual(
    resolvePlayerBarRegions({ standard: legacy } as never, 'standard'),
    DEFAULT_PLAYER_BAR_LAYOUT.standard
  )
  assert.deepEqual(legacy, saved)
  const custom = { ...legacy, right: [...legacy.right].reverse() }
  assert.deepEqual(normalizePlayerBarLayout({ standard: custom }).standard, custom)
  assert.deepEqual(resolvePlayerBarRegions({ standard: custom } as never, 'standard'), custom)
})

test('every shape has a default arrangement and every control has a home', () => {
  // A shape without defaults would normalize to an empty bar.
  assert.deepEqual(Object.keys(DEFAULT_PLAYER_BAR_LAYOUT).sort(), [...PLAYER_BAR_MODES].sort())
  assert.deepEqual([...PLAYER_BAR_REGION_NAMES], ['left', 'center', 'right'])

  // A control no default places anywhere is only reachable through the editor,
  // which is a good way to ship one nobody ever sees.
  const placed = new Set(
    Object.values(DEFAULT_PLAYER_BAR_LAYOUT).flatMap((regions) => [
      ...regions.left,
      ...regions.center,
      ...regions.right
    ])
  )
  assert.deepEqual(
    PLAYER_BAR_CONTROL_IDS.filter((id) => !placed.has(id)),
    []
  )
})

test('unknown control ids are dropped rather than rendered', () => {
  const layout = normalizePlayerBarLayout({
    compact: { left: ['trackInfo', 'nonsense', 42, null, 'favorite'], center: [], right: [] }
  })
  assert.deepEqual(layout.compact.left, ['trackInfo', 'favorite'])
})

test('a control lands in exactly one region, first placement winning', () => {
  const layout = normalizePlayerBarLayout({
    compact: {
      left: ['trackInfo', 'volume'],
      center: ['transport', 'volume'],
      right: ['volume', 'queue', 'queue']
    }
  })
  assert.deepEqual(layout.compact.left, ['trackInfo', 'volume'])
  assert.deepEqual(layout.compact.center, ['transport'])
  assert.deepEqual(layout.compact.right, ['queue'])
})

test('an absent region falls back to its default while an emptied one stays empty', () => {
  const layout = normalizePlayerBarLayout({
    compact: { left: [], center: ['transport'] }
  })
  // Deliberately emptied.
  assert.deepEqual(layout.compact.left, [])
  // Never written, so the default arrangement for that region survives — minus
  // anything the earlier regions already claimed.
  assert.deepEqual(layout.compact.right, DEFAULT_PLAYER_BAR_LAYOUT.compact.right)
  // Other shapes are untouched by a partial write.
  assert.deepEqual(layout.standard, DEFAULT_PLAYER_BAR_LAYOUT.standard)
  assert.deepEqual(layout.mini, DEFAULT_PLAYER_BAR_LAYOUT.mini)
})

test('a layout that drops every play control gets one back where its shape wants it', () => {
  // Standard and compact default to the transport group in the centre.
  for (const mode of ['standard', 'compact'] as const) {
    const layout = normalizePlayerBarLayout({ [mode]: { left: [], center: [], right: ['volume'] } })
    assert.deepEqual(layout[mode].center, ['transport'], mode)
    assert.deepEqual(layout[mode].left, [], mode)
  }

  // Mini's play control is the standalone button, and it belongs on the left:
  // appending to the centre would drop it into the column its rail occupies.
  const mini = normalizePlayerBarLayout({ mini: { left: [], center: [], right: ['queue'] } })
  assert.deepEqual(mini.mini.left, ['playPause'])
  assert.deepEqual(mini.mini.center, [])

  // Either play control satisfies the invariant, so neither gets duplicated.
  const withPlayPause = normalizePlayerBarLayout({
    compact: { left: ['playPause'], center: [], right: [] }
  })
  assert.deepEqual(withPlayPause.compact.left, ['playPause'])
  assert.deepEqual(withPlayPause.compact.center, [])

  const withTransport = normalizePlayerBarLayout({
    compact: { left: [], center: [], right: ['transport'] }
  })
  assert.deepEqual(withTransport.compact.right, ['transport'])
  assert.deepEqual(withTransport.compact.center, [])
})

test('normalization survives garbage input', () => {
  for (const raw of [undefined, null, 42, 'compact', [], { compact: 'yes' }, { nonsense: {} }]) {
    assert.deepEqual(normalizePlayerBarLayout(raw), DEFAULT_PLAYER_BAR_LAYOUT)
  }
  // A region stored as something other than an array is "absent", not "empty".
  assert.deepEqual(
    normalizePlayerBarLayout({ mini: { left: 'playPause' } }).mini,
    DEFAULT_PLAYER_BAR_LAYOUT.mini
  )
})

test('normalization never returns the shared default objects', () => {
  const layout = normalizePlayerBarLayout(undefined)
  assert.notEqual(layout, DEFAULT_PLAYER_BAR_LAYOUT)
  for (const mode of PLAYER_BAR_MODES) {
    assert.notEqual(layout[mode], DEFAULT_PLAYER_BAR_LAYOUT[mode])
    for (const region of PLAYER_BAR_REGION_NAMES) {
      assert.notEqual(layout[mode][region], DEFAULT_PLAYER_BAR_LAYOUT[mode][region])
    }
  }
})

test('cloning copies every region array', () => {
  const source = normalizePlayerBarLayout(undefined)
  const copy = clonePlayerBarLayout(source)
  assert.deepEqual(copy, source)
  for (const mode of PLAYER_BAR_MODES) {
    for (const region of PLAYER_BAR_REGION_NAMES) {
      assert.notEqual(copy[mode][region], source[mode][region])
    }
  }
  copy.standard.right.push('equalizer')
  assert.deepEqual(source.standard.right, DEFAULT_PLAYER_BAR_LAYOUT.standard.right)
})

test('resolving a shape falls back to the default for settings written before layouts', () => {
  assert.deepEqual(resolvePlayerBarRegions(undefined, 'compact'), DEFAULT_PLAYER_BAR_LAYOUT.compact)
  const layout = normalizePlayerBarLayout({ mini: { left: ['cover'], center: [], right: [] } })
  // The play-control invariant applies here too, so mini keeps a way to play.
  assert.deepEqual(resolvePlayerBarRegions(layout, 'mini'), {
    left: ['cover', 'playPause'],
    center: [],
    right: []
  })
})

test('the editor is offered exactly the controls a shape has not placed', () => {
  // Compact places everything except mini's standalone play button, whose 40px
  // circle only makes sense as that shape's whole left region.
  assert.deepEqual(unplacedPlayerBarControls(DEFAULT_PLAYER_BAR_LAYOUT.compact), ['playPause'])
  assert.deepEqual(unplacedPlayerBarControls({ left: [], center: [], right: [] }), [
    ...PLAYER_BAR_CONTROL_IDS
  ])
  assert.deepEqual(
    unplacedPlayerBarControls({
      left: [...PLAYER_BAR_CONTROL_IDS],
      center: [],
      right: []
    }),
    []
  )
})
