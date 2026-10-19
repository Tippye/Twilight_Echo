import type { MusicAlbum } from './rhineMusic.ts'

export type IntroductionResult = NonNullable<MusicAlbum['introduction']> &
  Pick<MusicAlbum, 'description' | 'descriptionSource'>
export type CreditsResult = Omit<NonNullable<MusicAlbum['creditsLookup']>, 'source'> & {
  credits: MusicAlbum['producers']
}

/** Failed/partial lookups never erase previously verified text or personnel. */
export function introductionPatch(
  album: MusicAlbum,
  result: IntroductionResult
): Partial<MusicAlbum> {
  if (album.descriptionSource?.method === 'external-ai') return {}
  const { description, descriptionSource, ...introduction } = result
  if (result.status === 'matched' && description && descriptionSource?.url)
    return { introduction, description, descriptionSource }
  if (result.status === 'matched')
    return {
      introduction: { ...introduction, status: 'error', error: '来源未提供可引用的专辑介绍' }
    }
  return { introduction }
}

export function creditsPatch(album: MusicAlbum, result: CreditsResult): Partial<MusicAlbum> {
  const tracks = new Map(album.tracks.map((t) => [t.id, t]))
  const credits = result.credits
    .filter((p) => p.trackId && tracks.has(p.trackId) && p.name?.trim() && p.role?.trim())
    .map((p) => ({ ...p, source: 'QQ Music' as const, trackTitle: tracks.get(p.trackId!)!.title }))
  const refreshed = new Set(credits.map((p) => p.trackId))
  const { credits: _credits, ...lookup } = result
  return {
    creditsLookup: { ...lookup, source: 'QQ Music' },
    ...(credits.length
      ? {
          producers: [
            ...album.producers.filter(
              (p) =>
                p.source !== 'QQ Music' ||
                (result.status !== 'matched' && !refreshed.has(p.trackId))
            ),
            ...credits
          ]
        }
      : {})
  }
}

export function selectMetadataAlbums(
  albums: MusicAlbum[],
  operation: string,
  args: Record<string, unknown>
): MusicAlbum[] {
  if (
    args.albumIds !== undefined &&
    (!Array.isArray(args.albumIds) ||
      args.albumIds.length > 10000 ||
      args.albumIds.some((id) => typeof id !== 'string'))
  )
    throw new Error('albumIds 必须是专辑 ID 数组')
  if (args.force !== undefined && typeof args.force !== 'boolean')
    throw new Error('force 必须为布尔值')
  const ids = Array.isArray(args.albumIds) ? new Set(args.albumIds) : undefined
  return albums.filter((album) => {
    if (album.offline || (ids && !ids.has(album.id)) || (args.albumId && args.albumId !== album.id))
      return false
    if (operation === 'introductions' && album.descriptionSource?.method === 'external-ai')
      return false
    if (args.force) return true
    if (operation === 'enrich') return !album.online?.checkedAt
    if (operation === 'introductions')
      return (
        !album.description &&
        (!album.introduction?.checkedAt ||
          album.introduction.status === 'error' ||
          Date.now() - Date.parse(album.introduction.checkedAt) > 7 * 86400000)
      )
    const cached = album.creditsLookup
    if (!cached?.checkedAt) return true
    if (cached.status === 'matched') return false
    const ttl = cached.error || cached.status === 'error' ? 600000 : 7 * 86400000
    return (
      Date.now() >=
      Math.max(Date.parse(cached.checkedAt) + ttl || 0, Date.parse(cached.retryAt ?? '') || 0)
    )
  })
}
