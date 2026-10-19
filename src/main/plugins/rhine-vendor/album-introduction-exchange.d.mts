import type { MusicAlbum } from '../../../shared/rhineMusic.ts'
export interface IntroductionTask { format: string; version: number; albums: Array<{ id: string; expectedRevision: string }> }
export interface IntroductionPreview {
  canApply: boolean
  counts: { add: number; replace: number; skip: number; conflict: number }
  entries: Array<{ id: string; action: string; description: string; sources: NonNullable<MusicAlbum['descriptionSource']>[] }>
}
export function introductionEditionRevision(album: MusicAlbum): string
export function introductionRevision(album: MusicAlbum): string
export function createIntroductionTask(albums: MusicAlbum[], options?: { scope?: string; albumId?: string }): IntroductionTask
export function previewIntroductionImport(albums: MusicAlbum[], value: unknown, options?: { allowReplace?: boolean }): IntroductionPreview
export function reconcileIntroductionResult(albums: MusicAlbum[], value: unknown, proofs: Map<string, string>): { result: unknown; rebound: number; unresolved: Array<{ id: string; reason: string }> }
