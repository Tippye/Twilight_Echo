export const WINDOWS_TRACK_INFO_REQUEST_KEY = 'Protocol_UpdateSongInfo'
export const WINDOWS_TRACK_INFO_PROVENANCE = Object.freeze({
  artifact: 'QQMusic_Protocol.dll',
  artifactSha256: 'ba66aa248b885227179f1676fbc54576a036f46b9d096fea33131c4f30fa6476',
  producer: '0x10044c6a',
  evidenceId: 'ev_15dc69b6ee9f0449839fd5679d1e66cd03b7a1d113f3ef423c8729d987a2255b'
})

function integer(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} is outside its native integer range`)
  }
  return value
}

/**
 * Native TrackInfo producer: numeric IDs and caller-supplied types/context.
 * Native param6 zero emits scene1; nonzero emits scene0. No caller defaults are inferred.
 * Songmid-only resolution is not established by this native producer.
 */
export function buildWindowsTrackInfoCall({ ids, types, ctx, scene } = {}) {
  if (!Array.isArray(ids) || !Array.isArray(types) || ids.length === 0 || ids.length !== types.length) {
    throw new TypeError('ids and types must be nonempty arrays of equal length')
  }
  const normalizedIds = Array.from(ids, id => integer(id, 0, 0xffffffff, 'id'))
  const normalizedTypes = Array.from(types, type => integer(type, -0x80000000, 0x7fffffff, 'type'))
  return {
    module: 'music.trackInfo.UniformRuleCtrl', method: 'CgiGetTrackInfo',
    param: {
      ids: normalizedIds, types: normalizedTypes,
      ctx: integer(ctx, -0x80000000, 0x7fffffff, 'ctx'),
      scene: integer(scene, 0, 1, 'scene')
    }
  }
}
