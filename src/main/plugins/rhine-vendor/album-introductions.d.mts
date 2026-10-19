import type { MusicAlbum } from '../../../shared/rhineMusic.ts'
export class AlbumIntroductionProvider {
  constructor(options?: { contact?: () => string })
  lookup(album: MusicAlbum): Promise<NonNullable<MusicAlbum['introduction']> & Pick<MusicAlbum, 'description' | 'descriptionSource'>>
}
