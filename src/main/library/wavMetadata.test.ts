import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import iconv from 'iconv-lite'
import {
  chooseWaveText,
  decodeWaveText,
  readWaveMetadata,
  repairMojibakeText
} from './wavMetadata.ts'

const uint32Le = (value: number): Buffer => {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value, 0)
  return buffer
}

const uint64Le = (value: number): Buffer => {
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64LE(BigInt(value), 0)
  return buffer
}

const riffChunk = (id: string, data: Buffer, declaredSize = data.length): Buffer =>
  Buffer.concat([
    Buffer.from(id, 'ascii'),
    uint32Le(declaredSize),
    data,
    data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)
  ])

const waveInfo = (tags: Record<string, Buffer>): Buffer =>
  riffChunk(
    'LIST',
    Buffer.concat([
      Buffer.from('INFO', 'ascii'),
      ...Object.entries(tags).map(([id, value]) => riffChunk(id, value))
    ])
  )

const writeWave = (
  filePath: string,
  container: 'RIFF' | 'RF64' | 'BW64',
  chunks: Buffer[]
): void => {
  const body = Buffer.concat(chunks)
  const size = container === 'RIFF' ? 4 + body.length : 0xffffffff
  writeFileSync(
    filePath,
    Buffer.concat([
      Buffer.from(container, 'ascii'),
      uint32Le(size),
      Buffer.from('WAVE', 'ascii'),
      body
    ])
  )
}

test('decodes UTF-8, UTF-16, and legacy WAV text without replacing valid scripts', () => {
  assert.equal(decodeWaveText(Buffer.from('山海\0', 'utf8')), '山海')
  assert.equal(
    decodeWaveText(
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Wave Title\0', 'utf16le')])
    ),
    'Wave Title'
  )
  assert.equal(decodeWaveText(iconv.encode('夜に駆ける\0', 'euc-jp')), '夜に駆ける')
  assert.equal(decodeWaveText(Buffer.from('1b24424c6b244b366e2431246b1b2842', 'hex')), '夜に駆ける')
  assert.equal(decodeWaveText(iconv.encode('海鲜面\0', 'gbk')), '海鲜面')
})

test('repairs parser mojibake and prefers decoded WAV text', () => {
  const mojibake = iconv.decode(iconv.encode('独独な巡礼', 'gbk'), 'latin1')
  assert.equal(repairMojibakeText(mojibake), '独独な巡礼')
  assert.equal(chooseWaveText('TBO&R}', '月夕引'), '月夕引')
  assert.equal(chooseWaveText('山海', 'e11f57'), '山海')
})

test('reads RIFF INFO aliases and BEXT metadata', async () => {
  const root = mkdtempSync(join(tmpdir(), 'twilight-wav-metadata-'))
  try {
    const filePath = join(root, 'aliases.wav')
    const bext = Buffer.alloc(602)
    Buffer.from('Broadcast Title\0', 'utf8').copy(bext, 0)
    Buffer.from('Broadcast Artist\0', 'utf8').copy(bext, 256)
    Buffer.from('2021-04-03', 'utf8').copy(bext, 320)
    writeWave(filePath, 'BW64', [
      riffChunk('ds64', Buffer.concat([uint64Le(0), uint64Le(0), uint64Le(0), uint32Le(0)])),
      riffChunk('bext', bext),
      waveInfo({
        TITL: Buffer.from('INFO Title\0', 'utf8'),
        IART: iconv.encode('海鲜面\0', 'gbk'),
        IRPD: Buffer.from('INFO Album\0', 'utf8'),
        GNRE: Buffer.from('Ambient\0', 'utf8'),
        ITRK: Buffer.from('07\0', 'utf8'),
        YEAR: Buffer.from('2024\0', 'utf8')
      })
    ])

    await assert.doesNotReject(async () => {
      const metadata = await readWaveMetadata(filePath)
      assert.deepEqual(metadata, {
        title: 'INFO Title',
        artist: '海鲜面',
        album: 'INFO Album',
        genre: 'Ambient',
        year: '2024',
        trackNumber: 7
      })
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('reads RF64 fmt/data sizes for technical fallback', async () => {
  const root = mkdtempSync(join(tmpdir(), 'twilight-rf64-metadata-'))
  try {
    const filePath = join(root, 'technical.wav')
    const fmt = Buffer.alloc(16)
    fmt.writeUInt16LE(1, 0)
    fmt.writeUInt16LE(2, 2)
    fmt.writeUInt32LE(48000, 4)
    fmt.writeUInt32LE(192000, 8)
    fmt.writeUInt16LE(4, 12)
    fmt.writeUInt16LE(16, 14)
    writeWave(filePath, 'RF64', [
      riffChunk('ds64', Buffer.concat([uint64Le(0), uint64Le(192000), uint64Le(0), uint32Le(0)])),
      riffChunk('fmt ', fmt),
      riffChunk('data', Buffer.alloc(0), 0xffffffff)
    ])
    assert.deepEqual(await readWaveMetadata(filePath), {
      sampleRate: 48000,
      bitDepth: 16,
      bitrate: 1536000,
      codec: 'PCM',
      duration: 1
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
