export interface NcmAlbumClassification {
  releaseType?: string
}

export const UNKNOWN_NCM_ALBUM_CLASSIFICATION = '__unclassified__'

function classificationValue(album: NcmAlbumClassification): string {
  const value = album.releaseType
  return typeof value === 'string' ? value.trim() : ''
}

export function ncmAlbumClassificationLabel(value: string): string {
  if (value === UNKNOWN_NCM_ALBUM_CLASSIFICATION) return '未标注'
  if (value === 'Single') return '单曲'
  if (value === 'EP/Single') return 'EP / 单曲'
  return value
}

export function getNcmAlbumFilterOptions(
  albums: readonly NcmAlbumClassification[]
): Array<{ value: string; label: string; count: number }> {
  const counts = new Map<string, number>()
  for (const album of albums) {
    const value = classificationValue(album) || UNKNOWN_NCM_ALBUM_CLASSIFICATION
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  const preferred = ['专辑', 'EP', 'Single', 'EP/Single']
  const rank = (value: string): number => {
    if (value === UNKNOWN_NCM_ALBUM_CLASSIFICATION) return preferred.length + 1
    const index = preferred.indexOf(value)
    return index >= 0 ? index : preferred.length
  }
  return [...counts]
    .sort(([left], [right]) => rank(left) - rank(right) || left.localeCompare(right, 'zh-CN'))
    .map(([value, count]) => ({ value, label: ncmAlbumClassificationLabel(value), count }))
}

export function filterNcmAlbums<T extends NcmAlbumClassification>(
  albums: T[],
  releaseType: string
): T[] {
  if (!releaseType) return albums
  return albums.filter(
    (album) => (classificationValue(album) || UNKNOWN_NCM_ALBUM_CLASSIFICATION) === releaseType
  )
}

export function formatNcmAlbumClassification(album: NcmAlbumClassification): string {
  return ncmAlbumClassificationLabel(classificationValue(album))
}
