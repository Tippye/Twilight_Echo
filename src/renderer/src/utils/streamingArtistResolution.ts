export interface StreamingArtistCandidate {
  id: number | string
  name: string
  picUrl: string | null
}

export interface StreamingLinkedUser {
  name: string
}

/** 曲目携带的单个歌手身份（结构上兼容 Track['artists'] 的元素）。 */
export interface StreamingArtistRef {
  id?: string | number
  name: string
}

export interface StreamingArtistNavigationRequest {
  key: number
  providerId: string
  artistName: string
  /**
   * provider 侧稳定歌手身份。同名歌手无法用名字区分，有这个值时一律按它打开；
   * 缺失（旧持久化快照、未提供结构化歌手的 provider）才回退到名字搜索。
   */
  artistId?: string | number
}

export interface StreamingAlbumNavigationRequest {
  key: number
  providerId: string
  albumId: string
  albumName: string
  artist?: string
  cover: string | null
  coverSource?: string | null
}

export type StreamingMetadataNavigationRequest =
  | ({ kind: 'artist' } & StreamingArtistNavigationRequest)
  | ({ kind: 'album' } & StreamingAlbumNavigationRequest)

export function getPrimaryStreamingArtistName(value: string): string {
  const normalized = value.trim()
  if (!normalized) return ''
  return normalized.split(/\s+\/\s+/, 1)[0]?.trim() ?? normalized
}

export function normalizeStreamingArtistName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

/**
 * 取展示串首位歌手对应的 provider 歌手 id。首位名字与 refs[0] 对不上时返回
 * undefined：曲目可能被重新匹配过、或展示串另有来源，此时宁可退回名字搜索，
 * 也不能把一个 id 安到另一位歌手身上。
 */
export function getPrimaryStreamingArtistId(
  artistDisplayName: string,
  artists: readonly StreamingArtistRef[] | undefined
): string | number | undefined {
  const primary = artists?.[0]
  if (primary?.id == null) return undefined
  const displayPrimary = getPrimaryStreamingArtistName(artistDisplayName)
  if (!displayPrimary) return undefined
  if (normalizeStreamingArtistName(primary.name) !== normalizeStreamingArtistName(displayPrimary)) {
    return undefined
  }
  return primary.id
}

/**
 * 名字完全相同的全部候选。同名歌手是常态，调用方必须自己决定怎么消歧，不能
 * 假设结果唯一。
 */
export function matchStreamingArtistsByName<T extends StreamingArtistCandidate>(
  keyword: string,
  artists: readonly T[]
): T[] {
  const normalizedKeyword = normalizeStreamingArtistName(keyword)
  if (!normalizedKeyword) return []
  return artists.filter((artist) => normalizeStreamingArtistName(artist.name) === normalizedKeyword)
}

/** 按 provider 歌手 id 定位候选；只比 id，绝不退化成名字比较。 */
export function findStreamingArtistById<T extends StreamingArtistCandidate>(
  id: string | number,
  artists: readonly T[]
): T | null {
  const target = String(id)
  return artists.find((artist) => String(artist.id) === target) ?? null
}

export function findBestStreamingArtistMatch<T extends StreamingArtistCandidate>(
  keyword: string,
  artists: T[]
): T | null {
  return matchStreamingArtistsByName(keyword, artists)[0] ?? null
}

export async function resolveLinkedStreamingArtist<
  T extends StreamingArtistCandidate,
  U extends StreamingLinkedUser
>(
  initialArtist: T,
  linkedUser: U | undefined,
  findArtistByUserName: (user: U) => Promise<T | null>
): Promise<T> {
  if (!linkedUser) return initialArtist
  const matchedArtist = await findArtistByUserName(linkedUser).catch(() => null)
  if (!matchedArtist) return initialArtist
  return {
    ...matchedArtist,
    picUrl: matchedArtist.picUrl ?? initialArtist.picUrl
  }
}
