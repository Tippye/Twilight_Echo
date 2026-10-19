import type { MusicAlbum } from '../../../shared/rhineMusic.ts'
export class QQCreditsProvider {
  constructor(options: { dataDir: string })
  lookup(album: MusicAlbum, options?: { force?: boolean }): Promise<Omit<NonNullable<MusicAlbum['creditsLookup']>, 'source'> & { credits: MusicAlbum['producers'] }>
}
