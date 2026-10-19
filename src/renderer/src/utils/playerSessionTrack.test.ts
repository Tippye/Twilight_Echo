import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Track } from '../types/music'
import { cloneTrackForPlaybackQueue, cloneTrackForPlaybackSession } from './playerSessionTrack.ts'
import {
  createPlaybackQueueSnapshotCache,
  patchPlaybackQueueTrack,
  toPlaybackQueueSnapshots
} from './playbackQueueVirtualization.ts'

test('album navigation identity survives queue selection, JSON persistence and session restore', () => {
  const original = makeTrack({ albumId: 'album-123', albumArtist: 'Album Artist' })
  const queue = toPlaybackQueueSnapshots([original])
  assert.equal(queue[0].albumId, original.albumId)
  const persisted = JSON.parse(JSON.stringify(queue.map(cloneTrackForPlaybackQueue))) as Track[]
  const restored = toPlaybackQueueSnapshots(persisted.map(cloneTrackForPlaybackSession))
  const selected = cloneTrackForPlaybackSession(restored[0])
  assert.equal(selected.albumId, original.albumId)
  assert.equal(selected.albumArtist, original.albumArtist)
  assert.equal(selected.queueEntryId, original.queueEntryId)
})

test('queue patch and cache notice changed album identity even when the album name is unchanged', () => {
  const original = makeTrack({ albumId: 'album-123', albumArtist: 'Original Artist' })
  const cache = createPlaybackQueueSnapshotCache()
  const before = cache([original])
  const changed = { ...original, albumId: 'album-456', albumArtist: 'Another Artist' }
  const patched = patchPlaybackQueueTrack(before, changed)
  assert.notEqual(patched, before)
  assert.equal(patched[0].albumId, 'album-456')
  assert.equal(patched[0].albumArtist, 'Another Artist')
  const after = cache([changed])
  assert.notEqual(after, before)
  assert.equal(after[0].albumId, 'album-456')
})

function makeTrack(partial: Partial<Track> = {}): Track {
  return {
    id: 'ncm:1996755298',
    queueEntryId: 'entry-1',
    title: 'Track',
    artist: 'Artist',
    album: 'Album',
    filePath: 'C:\\music\\track.flac',
    fileName: 'track.flac',
    dir: 'C:\\music',
    subTrack: 'C:\\music\\track.flac',
    duration: 240,
    size: 4096,
    cover: 'cover-url',
    coverSource: 'https://example.test/cover.jpg',
    lyrics: 'lyrics',
    translatedLyrics: 'translation',
    romanizedLyrics: 'romanized',
    source: 'ncm',
    ncmSongId: 1996755298,
    format: 'flac',
    sampleRate: 44100,
    bitrate: 900,
    bitDepth: 16,
    bpm: 120,
    bpmAnalysis: {
      bpm: 120,
      confidence: 0.9,
      source: 'analyzed',
      analyzedAt: 'now',
      algorithmVersion: 1
    },
    replayGainTrackGainDb: -6,
    replayGainAlbumGainDb: -7,
    replayGainTrackPeak: 0.8,
    replayGainAlbumPeak: 0.7,
    r128TrackGainDb: -8,
    r128AlbumGainDb: -9,
    ...partial
  }
}

test('cloneTrackForPlaybackSession strips lyrics and transient fields but preserves core fields', () => {
  const cueRange = { startSeconds: 10, endSeconds: 20, pregapSeconds: 0 }
  const track = makeTrack({ cueRange, streamUrl: 'https://example.test/audio.flac' })
  const cloned = cloneTrackForPlaybackSession(track)

  assert.equal(cloned.id, track.id)
  assert.equal(cloned.queueEntryId, track.queueEntryId)
  assert.equal(cloned.title, track.title)
  assert.equal(cloned.artist, track.artist)
  assert.equal(cloned.album, track.album)
  assert.equal(cloned.filePath, track.filePath)
  assert.equal(cloned.fileName, track.fileName)
  assert.equal(cloned.dir, track.dir)
  assert.equal(cloned.subTrack, track.subTrack)
  assert.deepEqual(cloned.cueRange, cueRange)
  assert.notEqual(cloned.cueRange, track.cueRange)
  assert.equal(cloned.duration, track.duration)
  assert.equal(cloned.size, track.size)
  assert.equal(cloned.cover, track.cover)
  assert.equal(cloned.coverSource, track.coverSource)
  assert.equal(cloned.lyrics, null)
  assert.equal(cloned.translatedLyrics, undefined)
  assert.equal(cloned.romanizedLyrics, undefined)
  assert.equal(cloned.ncmSongId, track.ncmSongId)
  assert.equal(cloned.format, track.format)
  assert.equal(cloned.sampleRate, track.sampleRate)
  assert.equal(cloned.bitrate, track.bitrate)
  assert.equal(cloned.bitDepth, track.bitDepth)
  assert.equal(cloned.bpm, track.bpm)
  // bpmAnalysis carries the multi-hundred-segment tempoMap; session clones must
  // never persist it (re-resolved on demand when the track actually plays).
  assert.equal(cloned.bpmAnalysis, undefined)
  assert.equal('bpmAnalysis' in cloned, false)
  assert.equal(cloned.replayGainTrackGainDb, track.replayGainTrackGainDb)
  assert.equal(cloned.replayGainAlbumGainDb, track.replayGainAlbumGainDb)
  assert.equal(cloned.replayGainTrackPeak, track.replayGainTrackPeak)
  assert.equal(cloned.replayGainAlbumPeak, track.replayGainAlbumPeak)
  assert.equal(cloned.r128TrackGainDb, track.r128TrackGainDb)
  assert.equal(cloned.r128AlbumGainDb, track.r128AlbumGainDb)
})

test('cloneTrackForPlaybackSession keeps local stream urls and clears provider stream urls', () => {
  const local = makeTrack({
    id: 'C:\\music\\local.flac',
    source: undefined,
    streamUrl: 'C:\\music\\cache.flac'
  })
  assert.equal(cloneTrackForPlaybackSession(local).streamUrl, 'C:\\music\\cache.flac')

  const provider = makeTrack({ source: 'ncm', streamUrl: 'https://example.test/audio.flac' })
  assert.equal(cloneTrackForPlaybackSession(provider).streamUrl, null)
})

test('cloneTrackForPlaybackSession normalizes missing cover source to null', () => {
  const cloned = cloneTrackForPlaybackSession(makeTrack({ coverSource: undefined }))
  assert.equal(cloned.coverSource, null)
})

test('selected track keeps small inline art while queue omits it', () => {
  const inlineCover = 'data:image/jpeg;base64,AAAA'
  assert.equal(cloneTrackForPlaybackSession(makeTrack({ cover: inlineCover })).cover, inlineCover)
  assert.equal(cloneTrackForPlaybackQueue(makeTrack({ cover: inlineCover })).cover, null)
  assert.equal(
    cloneTrackForPlaybackSession(
      makeTrack({ cover: `data:image/jpeg;base64,${'A'.repeat(300_000)}` })
    ).cover,
    null
  )
})

test('session snapshots omit expiring covers while retaining durable origins', () => {
  for (const cover of ['blob:https://example.test/image', 'twilight-media://image/expired-token']) {
    const cloned = cloneTrackForPlaybackSession(makeTrack({ cover }))
    assert.equal(cloned.cover, null)
    assert.equal(cloned.coverSource, 'https://example.test/cover.jpg')
  }
  assert.equal(
    cloneTrackForPlaybackSession(makeTrack({ cover: 'cover://local.jpg' })).cover,
    'cover://local.jpg'
  )
})

test('a 20,000-track session snapshot with embedded art stays below the queue file limit', () => {
  const inlineCover = `data:image/jpeg;base64,${'A'.repeat(2_000)}`
  const base = makeTrack({
    cover: inlineCover,
    filePath: `D:/Music/${'album/'.repeat(12)}track.flac`
  })
  const queue = Array.from({ length: 20_000 }, (_, index) =>
    cloneTrackForPlaybackQueue({ ...base, id: `local:${index}`, queueEntryId: `entry:${index}` })
  )
  assert.ok(queue.length * inlineCover.length > 32 * 1024 * 1024)
  assert.ok(Buffer.byteLength(JSON.stringify(queue), 'utf8') < 32 * 1024 * 1024)
  assert.equal(queue[0].cover, null)
})
