import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { normalizeOutputConfig } from './audioOutputConfig.ts'
import type { OutputConfig } from './audioEngineTypes.ts'

// Execute the production settings adapter without starting Electron or opening
// a user's settings file. Only its existing defaults and shared schema are needed.
const settingsSource = readFileSync(new URL('../main/core/settings.ts', import.meta.url), 'utf8')
const settingsAst = ts.createSourceFile('settings.ts', settingsSource, ts.ScriptTarget.Latest, true)
const adapter = settingsAst.statements.find(
  (node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'normalizeOutputConfig'
)!
const adapterJs = ts.transpile(adapter.getText(settingsAst).replace(/^export /, ''))
const defaults: OutputConfig = {
  preferredBufferSize: 0,
  routingMode: 'auto',
  wasapiExclusivePushMode: false,
  pcmToDsdMode: 'off',
  dsdMutePreRollFrames: 256,
  dsdMutePostRollFrames: 256,
  dsdMuteTimeoutFrames: 4096,
  playbackPolicy: 'bit-perfect-first',
  continuitySampleRate: 48000
}
const normalizeStored = new Function(
  'normalizeSharedOutputConfig',
  'DEFAULT_SETTINGS',
  `${adapterJs}; return normalizeOutputConfig`
)(normalizeOutputConfig, { audioOutputConfig: defaults }) as (config: unknown) => OutputConfig

test('large ASIO buffer preferences survive storage and activation', () => {
  const input = { preferredBufferSize: 32768, upmixLfeLowpassHz: 900, pcmToDsdMode: 'dsd128' }
  const stored = normalizeStored(input)
  const active = normalizeOutputConfig(stored)
  assert.equal(stored.preferredBufferSize, 32768)
  assert.equal(active.preferredBufferSize, 32768)
  assert.equal(stored.upmixLfeLowpassHz, 500)
  assert.equal(active.pcmToDsdMode, 'dsd128')
  assert.deepEqual(stored, active)
  assert.equal(input.preferredBufferSize, 32768)
})

test('ASIO output channel preferences are finite zero-based indices', () => {
  for (const [input, expected] of [[-1, 0], [2.9, 2], [255, 255], [999, 255], [NaN, 0], [Infinity, 0]]) {
    const stored = normalizeStored({ asioOutputChannelStart: input })
    assert.equal(stored.asioOutputChannelStart, expected)
    assert.deepEqual(normalizeOutputConfig(stored), stored)
  }
})

test('stored and active output use the same finite-number, routing and continuity rules', () => {
  for (const value of [NaN, Infinity, -Infinity, -1, 0, 128.9, 2048, '512', null, true]) {
    const input = {
      preferredBufferSize: value,
      upmixCenterGain: value,
      dsdMuteTimeoutFrames: value,
      routingMode: 'invalid',
      playbackPolicy: 'continuity-first',
      continuitySampleRate: 96000
    }
    const stored = normalizeStored(input)
    const active = normalizeOutputConfig(input as Partial<OutputConfig>)
    assert.deepEqual(stored, active)
    assert.ok(Number.isFinite(stored.preferredBufferSize))
    assert.equal(stored.routingMode, 'auto')
    assert.equal(stored.continuitySampleRate, 96000)
  }
})

test('missing stored output returns a fresh legacy default without filling optional fields', () => {
  for (const value of [undefined, null, false, 42, 'auto']) {
    const output = normalizeStored(value)
    assert.deepEqual(output, defaults)
    assert.notEqual(output, defaults)
    assert.equal(output.upmixCenterGain, undefined)
  }
})
