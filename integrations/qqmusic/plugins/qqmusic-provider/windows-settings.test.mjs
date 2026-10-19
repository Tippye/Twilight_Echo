import assert from 'node:assert/strict'
import { test } from 'node:test'
import { serializeWindowsSettings, windowsPlaybackQuality, windowsQualityForm,
  saveWindowsQuality, windowsQualityState, setWindowsPlaybackQuality,
  WINDOWS_QUALITY_KEY, WINDOWS_QUALITY_COMMAND } from './lib/windows/settings.mjs'
import { WINDOWS_QUALITY_OPTIONS } from './lib/windows/quality.mjs'
import { activate, deactivate } from './windows-index.mjs'

test('quality and auth mutations share one read-modify-write owner without losing unrelated keys', async () => {
  let disk = { 'windows-device': { guid: 'public-device' } }
  const sdk = { get: async k => structuredClone(disk[k]), set: async (k, v) => {
    const copy = structuredClone(disk)
    await new Promise(r => setImmediate(r))
    copy[k] = structuredClone(v); disk = copy
  }, delete: async k => { const copy = structuredClone(disk); await new Promise(r => setImmediate(r)); delete copy[k]; disk = copy } }
  const a = serializeWindowsSettings(sdk), b = serializeWindowsSettings(sdk)
  assert.equal(a, b)
  await Promise.all([a.set('windows-auth', { publicSynthetic: true }),
    b.set(WINDOWS_QUALITY_KEY, 'flac'), a.set('test-marker', 1)])
  assert.deepEqual(disk, { 'windows-device': { guid: 'public-device' }, 'windows-auth': { publicSynthetic: true },
    [WINDOWS_QUALITY_KEY]: 'flac', 'test-marker': 1 })
  await Promise.all([a.delete('test-marker'), b.set(WINDOWS_QUALITY_KEY, '320')])
  assert.equal(disk['test-marker'], undefined)
  assert.deepEqual(disk['windows-auth'], { publicSynthetic: true })
  assert.equal(await windowsPlaybackQuality(a), '320')
})

test('a failed preference write rejects and does not poison subsequent auth storage', async () => {
  const disk = new Map()
  const sdk = { get: async k => disk.get(k), set: async (k, v) => {
    if (k === 'failing') throw new Error('synthetic storage failure')
    disk.set(k, v)
  }, delete: async k => { disk.delete(k) } }
  const s = serializeWindowsSettings(sdk)
  await assert.rejects(s.set('failing', 1), /synthetic/)
  await s.set('windows-auth', { publicSynthetic: true })
  assert.deepEqual(await s.get('windows-auth'), { publicSynthetic: true })
})

test('a legacy-secret migration during get cannot overwrite a concurrent quality save', async () => {
  let disk = { 'windows-auth': { publicSynthetic: true } }
  let releaseRead, startedRead
  const started = new Promise(r => { startedRead = r })
  const resume = new Promise(r => { releaseRead = r })
  const s = serializeWindowsSettings({ get: async key => {
    const copy = structuredClone(disk)
    startedRead()
    await resume
    disk = copy // Host migration writes its complete snapshot during this read.
    return copy[key]
  }, set: async (key, value) => { disk = { ...disk, [key]: value } }, delete: async key => { delete disk[key] } })
  const read = s.get('windows-auth')
  await started
  const save = s.set(WINDOWS_QUALITY_KEY, 'flac')
  await new Promise(r => setImmediate(r))
  assert.equal(disk[WINDOWS_QUALITY_KEY], undefined)
  releaseRead()
  await Promise.all([read, save])
  assert.equal(disk[WINDOWS_QUALITY_KEY], 'flac')
  assert.deepEqual(disk['windows-auth'], { publicSynthetic: true })
})

test('the settings form exposes only quality and valid saves do not return other storage values', async () => {
  const disk = new Map([['windows-auth', { publicSynthetic: true }]])
  const s = serializeWindowsSettings({ get: async k => disk.get(k), set: async (k, v) => { disk.set(k, v) },
    delete: async k => { disk.delete(k) } })
  const form = await windowsQualityForm(s)
  assert.equal(form.kind, 'settings-form')
  assert.equal(form.submitCommand, WINDOWS_QUALITY_COMMAND)
  assert.deepEqual(form.fields.map(f => f.key), ['quality'])
  assert.equal(form.fields[0].value, '128')
  const result = await saveWindowsQuality(s, { quality: 'flac', ignored: 'publicSynthetic' })
  assert.equal(result.form.fields[0].value, 'flac')
  assert.equal(JSON.stringify(result).includes('publicSynthetic'), false)
  assert.deepEqual(disk.get('windows-auth'), { publicSynthetic: true })
})

test('invalid quality values reject without overwriting an existing preference', async () => {
  const disk = new Map([[WINDOWS_QUALITY_KEY, '128']])
  const s = serializeWindowsSettings({ get: async k => disk.get(k), set: async (k, v) => { disk.set(k, v) },
    delete: async k => { disk.delete(k) } })
  for (const values of [null, [], {}, { quality: 'unverified-ai' }, { quality: 'flac\n' }, { quality: 320 }]) {
    await assert.rejects(saveWindowsQuality(s, values), /有效/)
  }
  assert.equal(await windowsPlaybackQuality(s), '128')
  disk.set(WINDOWS_QUALITY_KEY, 'unverified-quality')
  await assert.rejects(windowsPlaybackQuality(s), /无效/)
})

test('retired composite preferences migrate once to ordinary128 without losing unrelated settings', async () => {
  for (const quality of ['excellent', 'excellentSpatial']) {
    const disk = new Map([[WINDOWS_QUALITY_KEY, quality], ['windows-auth', { publicSynthetic: true }]])
    const writes = []
    const sdk = { get: async key => disk.get(key), set: async (key, value) => { writes.push([key, value]); disk.set(key, value) }, delete: async () => {} }
    const [a, b] = await Promise.all([windowsQualityState(sdk), windowsQualityState(sdk)])
    assert.equal(a.quality, '128')
    assert.equal(b.quality, '128')
    assert.equal(await windowsPlaybackQuality(sdk), '128')
    assert.deepEqual(writes, [[WINDOWS_QUALITY_KEY, '128']])
    assert.deepEqual(disk.get('windows-auth'), { publicSynthetic: true })
    assert.equal(a.options.some(option => ['excellent', 'excellentSpatial'].includes(option.value)), false)
    await assert.rejects(setWindowsPlaybackQuality(sdk, quality), /有效/)
  }
})

test('retired preference migration and a newer selection share one atomic storage transaction', async () => {
  let stored = 'excellent', release, announce
  const held = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { announce = resolve })
  const writes = []
  const sdk = { get: async () => { const value = stored; announce(); await held; return value },
    set: async (key, value) => { writes.push(value); stored = value }, delete: async () => {} }
  const first = windowsPlaybackQuality(sdk)
  await started
  const later = setWindowsPlaybackQuality(sdk, 'flac')
  release()
  assert.equal(await first, '128')
  assert.equal((await later).quality, 'flac')
  assert.deepEqual(writes, ['128', 'flac'])
  assert.equal(stored, 'flac')
})

test('cancelled retired-preference migration cannot start a write after its read returns', async () => {
  let release, announce, writes = 0
  const held = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { announce = resolve })
  const sdk = { get: async () => { announce(); await held; return 'excellentSpatial' },
    set: async () => { writes++ }, delete: async () => {} }
  const controller = new AbortController()
  const read = windowsPlaybackQuality(sdk, { guard: () => controller.signal.throwIfAborted() })
  const rejected = assert.rejects(read, { name: 'AbortError' })
  await started
  controller.abort(); release()
  await rejected
  assert.equal(writes, 0)
})

test('a failed retired-preference migration is surfaced without poisoning the settings owner', async () => {
  let stored = 'excellent', failing = true, writes = 0
  const sdk = { get: async () => stored, set: async (_key, value) => {
    writes++
    if (failing) throw new Error('synthetic migration write failure')
    stored = value
  }, delete: async () => {} }
  await assert.rejects(windowsPlaybackQuality(sdk), /synthetic migration write failure/)
  assert.equal(stored, 'excellent')
  failing = false
  assert.equal(await windowsPlaybackQuality(sdk), '128')
  assert.equal(await windowsPlaybackQuality(sdk), '128')
  assert.equal(writes, 2)
})

test('playback quality DTO uses every shared option and only reads the preference key', async () => {
  const reads = [], writes = []
  const disk = new Map()
  const sdk = { get: async key => { reads.push(key); return disk.get(key) },
    set: async (key, value) => { writes.push([key, value]); disk.set(key, value) }, delete: async () => {} }
  const owner = serializeWindowsSettings(sdk)
  assert.equal(serializeWindowsSettings(owner), owner)
  const initial = await windowsQualityState(sdk)
  assert.deepEqual(initial, { quality: '128', options: WINDOWS_QUALITY_OPTIONS })
  assert.equal(initial.options, WINDOWS_QUALITY_OPTIONS)
  for (const { value } of WINDOWS_QUALITY_OPTIONS) {
    const saved = await setWindowsPlaybackQuality(owner, value)
    assert.deepEqual(saved, { quality: value, options: WINDOWS_QUALITY_OPTIONS })
    assert.equal(saved.options, WINDOWS_QUALITY_OPTIONS)
  }
  assert.deepEqual(reads, [WINDOWS_QUALITY_KEY])
  assert.deepEqual(writes.map(([key]) => key), Array(WINDOWS_QUALITY_OPTIONS.length).fill(WINDOWS_QUALITY_KEY))
  assert.equal(await windowsPlaybackQuality(owner), WINDOWS_QUALITY_OPTIONS.at(-1).value)
})

test('direct setters reject aliases, unsafe types and alternate spellings without a queued write', async () => {
  let writes = 0
  const sdk = { get: async () => '320', set: async () => { writes++ }, delete: async () => {} }
  for (const quality of [undefined, null, 320, {}, [], 'default', 'high', 'lossless',
    'FLAC', ' flac', 'flac\n', 'flac\0', 'constructor', 'unknown']) {
    await assert.rejects(setWindowsPlaybackQuality(sdk, quality), /有效/)
  }
  assert.equal(writes, 0)
  assert.equal((await windowsQualityState(sdk)).quality, '320')
})

test('concurrent player and form saves share the SDK queue and return each committed selection', async () => {
  let disk = { publicUnrelated: true }
  const events = []
  let release, announce
  const held = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { announce = resolve })
  const sdk = { get: async key => disk[key], set: async (key, value) => {
    const copy = structuredClone(disk)
    events.push(['start', key, value])
    if (value === 'flac') { announce(); await held }
    copy[key] = value; disk = copy
    events.push(['end', key, value])
  }, delete: async () => {} }
  const first = setWindowsPlaybackQuality(sdk, 'flac')
  await started
  const second = saveWindowsQuality(serializeWindowsSettings(sdk), { quality: '320' })
  const unrelated = serializeWindowsSettings(sdk).set('publicMarker', 7)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(events, [['start', WINDOWS_QUALITY_KEY, 'flac']])
  release()
  const [a, b] = await Promise.all([first, second, unrelated])
  assert.equal(a.quality, 'flac')
  assert.equal(b.form.fields[0].value, '320')
  assert.deepEqual(events, [['start', WINDOWS_QUALITY_KEY, 'flac'], ['end', WINDOWS_QUALITY_KEY, 'flac'],
    ['start', WINDOWS_QUALITY_KEY, '320'], ['end', WINDOWS_QUALITY_KEY, '320'],
    ['start', 'publicMarker', 7], ['end', 'publicMarker', 7]])
  assert.deepEqual(disk, { publicUnrelated: true, [WINDOWS_QUALITY_KEY]: '320', publicMarker: 7 })
  assert.match(b.message, /下次播放/)
  assert.match(b.form.notice, /播放器可立即切换/)
})

test('a queued preference write checks lifecycle before touching SDK storage', async () => {
  let release, announce, writes = 0, closed = false
  const held = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { announce = resolve })
  const sdk = { get: async () => { announce(); await held; return undefined },
    set: async () => { writes++ }, delete: async () => {} }
  const owner = serializeWindowsSettings(sdk)
  const previous = owner.get('publicBlocker')
  await started
  const pending = setWindowsPlaybackQuality(sdk, 'hires', {
    guard: () => { if (closed) throw new Error('音源已停用') }
  })
  const rejected = assert.rejects(pending, /停用/)
  closed = true
  release()
  await Promise.all([previous, rejected])
  assert.equal(writes, 0)
  assert.deepEqual(await setWindowsPlaybackQuality(sdk, 'dolby'), { quality: 'dolby', options: WINDOWS_QUALITY_OPTIONS })
  assert.equal(writes, 1)
})

function qualityHarness({ get, set } = {}) {
  let provider, command
  const disk = new Map()
  const context = { settings: { get: get ?? (async key => disk.get(key)),
    set: set ?? (async (key, value) => { disk.set(key, value) }), delete: async key => { disk.delete(key) } },
    twilight: { qqAuth: { clear: async () => {} },
      providers: { register: async value => { provider = value } },
      ui: { register: async () => {}, onCommand: (key, fn) => {
        assert.equal(key, WINDOWS_QUALITY_COMMAND); command = fn
      } } } }
  return { context, disk, get provider() { return provider }, get command() { return command } }
}

test('registered quality methods and settings command use one preference and reject closed or aborted invocations',
  { skip: process.platform !== 'win32' }, async () => {
    const h = qualityHarness()
    try {
      await activate(h.context)
      assert.deepEqual(await h.provider.getPlaybackQuality({}), { quality: '128', options: WINDOWS_QUALITY_OPTIONS })
      assert.deepEqual(await h.provider.setPlaybackQuality('flac', {}), { quality: 'flac', options: WINDOWS_QUALITY_OPTIONS })
      assert.equal((await h.command({ source: 'settingsPanel' })).fields[0].value, 'flac')
      assert.equal((await h.command({ quality: '320' })).form.fields[0].value, '320')
      assert.equal((await h.provider.getPlaybackQuality({})).quality, '320')
      await assert.rejects(h.provider.setPlaybackQuality('high', {}), /有效/)
      assert.equal(h.disk.get(WINDOWS_QUALITY_KEY), '320')
      const controller = new AbortController(); controller.abort()
      await assert.rejects(h.provider.setPlaybackQuality('hires', { signal: controller.signal }), { name: 'AbortError' })
      await assert.rejects(h.provider.getPlaybackQuality({ signal: controller.signal }), { name: 'AbortError' })
      await assert.rejects(h.command({ quality: 'hires' }, { signal: controller.signal }), { name: 'AbortError' })
      await assert.rejects(h.command({ source: 'settingsPanel' }, { signal: controller.signal }), { name: 'AbortError' })
      assert.equal(h.disk.get(WINDOWS_QUALITY_KEY), '320')
      await deactivate()
      await assert.rejects(h.provider.getPlaybackQuality({}), /停用/)
      await assert.rejects(h.provider.setPlaybackQuality('hires', {}), /停用/)
      await assert.rejects(h.command({ quality: 'hires' }), /停用/)
      assert.equal(h.disk.get(WINDOWS_QUALITY_KEY), '320')
    } finally { await deactivate() }
  })

test('a cancelled settings command queued behind a read does not start a host write',
  { skip: process.platform !== 'win32' }, async () => {
    let release, announce, writes = 0
    const held = new Promise(resolve => { release = resolve })
    const started = new Promise(resolve => { announce = resolve })
    const h = qualityHarness({ get: async () => { announce(); await held; return '128' },
      set: async () => { writes++ } })
    try {
      await activate(h.context)
      const reading = h.provider.getPlaybackQuality({})
      await started
      const controller = new AbortController()
      const saving = h.command({ quality: 'flac' }, { signal: controller.signal })
      const rejected = assert.rejects(saving, { name: 'AbortError' })
      controller.abort()
      release()
      await Promise.all([reading, rejected])
      assert.equal(writes, 0)
    } finally { release(); await deactivate() }
  })

test('registered late reads reject after deactivation instead of publishing a quality DTO',
  { skip: process.platform !== 'win32' }, async () => {
    let release, announce
    const held = new Promise(resolve => { release = resolve })
    const started = new Promise(resolve => { announce = resolve })
    const h = qualityHarness({ get: async key => {
      assert.equal(key, WINDOWS_QUALITY_KEY)
      announce(); await held; return 'flac'
    } })
    try {
      await activate(h.context)
      const reading = h.provider.getPlaybackQuality({})
      const rejected = assert.rejects(reading, /停用/)
      await started
      await deactivate()
      release()
      await rejected
    } finally { release(); await deactivate() }
  })

test('a quality write already started in the host does not publish success after deactivation',
  { skip: process.platform !== 'win32' }, async () => {
    let release, announce, persisted
    const held = new Promise(resolve => { release = resolve })
    const started = new Promise(resolve => { announce = resolve })
    const h = qualityHarness({ set: async (key, value) => {
      assert.equal(key, WINDOWS_QUALITY_KEY)
      announce(); await held; persisted = value
    } })
    try {
      await activate(h.context)
      const saving = h.provider.setPlaybackQuality('hires', {})
      const rejected = assert.rejects(saving, /停用/)
      await started
      await deactivate()
      release()
      await rejected
      assert.equal(persisted, 'hires') // The host write has no rollback/cancel API.
    } finally { release(); await deactivate() }
  })
