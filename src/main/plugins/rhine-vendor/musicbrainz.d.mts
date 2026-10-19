import type { MusicAlbum } from '../../../shared/rhineMusic.ts'
export class MusicBrainzProvider {
  constructor(options: { contact: string; fetcher?: typeof fetch })
  lookup(album: MusicAlbum): Promise<Partial<MusicAlbum>>
}
