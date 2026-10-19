import test from 'node:test'
import assert from 'node:assert/strict'
import { introductionPatch, creditsPatch, selectMetadataAlbums } from './rhineMetadata.ts'
import { experienceRequestLimit } from './pluginExperience.ts'
import type { MusicAlbum } from './rhineMusic.ts'

const album: MusicAlbum = {
  id: 'a',
  title: 'Album',
  artist: 'Artist',
  genreId: 'pop',
  rawGenres: [],
  folder: '',
  offline: false,
  description: 'Verified text',
  descriptionSource: { name: 'Source', url: 'https://example.org' },
  producers: [{ name: 'Original', role: 'producer', source: 'QQ Music', trackId: 't2' }],
  tracks: ['t1', 't2'].map((id) => ({
    id,
    albumId: 'a',
    title: id,
    artist: 'Artist',
    duration: 60,
    format: 'wav',
    audioUrl: '',
    relativePath: '',
    browserPlayable: true
  }))
}

test('introduction failures preserve text and AI imports cannot be overwritten by lookups', () => {
  const patch = introductionPatch(album, { status: 'error', error: 'offline' })
  assert.equal({ ...album, ...patch }.description, 'Verified text')
  assert.equal(patch.introduction?.status, 'error')
  assert.deepEqual(
    introductionPatch(
      { ...album, descriptionSource: { ...album.descriptionSource!, method: 'external-ai' } },
      { status: 'matched', description: 'replacement', descriptionSource: album.descriptionSource }
    ),
    {}
  )
  assert.equal(introductionPatch(album, { status: 'matched' }).introduction?.status, 'error')
})
test('partial personnel refresh preserves other tracks and rejects foreign track ids', () => {
  const patch = creditsPatch(album, {
    status: 'partial',
    credits: [
      { name: 'New', role: 'producer', source: 'QQ Music', trackId: 't1' },
      { name: 'Foreign', role: 'producer', source: 'QQ Music', trackId: 'other' }
    ]
  })
  assert.deepEqual(
    patch.producers?.map((p) => p.name),
    ['Original', 'New']
  )
  assert.equal(patch.creditsLookup?.source, 'QQ Music')
  assert.equal(creditsPatch(album, { status: 'error', credits: [] }).producers, undefined)
})
test('jobs honor selected albums, force and lookup cooldown', () => {
  const other = { ...album, id: 'b', description: undefined }
  assert.deepEqual(
    selectMetadataAlbums([album, other], 'introductions', { albumIds: ['b'], force: true }).map(
      (a) => a.id
    ),
    ['b']
  )
  assert.deepEqual(
    selectMetadataAlbums(
      [
        {
          ...other,
          creditsLookup: {
            source: 'QQ Music',
            status: 'error',
            checkedAt: new Date().toISOString()
          }
        }
      ],
      'credits',
      {}
    ),
    []
  )
  assert.throws(() => selectMetadataAlbums([album], 'credits', { albumIds: 'a' }))
  assert.throws(() => selectMetadataAlbums([album], 'credits', { force: 'true' }))
})
test('large imports have method-specific bounds; arbitrary commands stay bounded', () => {
  assert.equal(experienceRequestLimit('player.play'), 256 * 1024)
  assert.equal(experienceRequestLimit('music.metadata.operate'), 5 * 1024 * 1024)
  assert.equal(experienceRequestLimit('music.metadata.write'), 17 * 1024 * 1024)
  assert.equal(experienceRequestLimit('ipc.invoke'), 256 * 1024)
})
