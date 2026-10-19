import type {
  PlaybackSessionSaveOptions,
  RendererClosePersistenceOutcome
} from '../shared/closePersistence.ts'

export type ClosePersistenceCallback = (
  options?: PlaybackSessionSaveOptions
) => Promise<void> | void

export async function collectClosePersistenceOutcome(
  callbacks: Iterable<ClosePersistenceCallback>,
  options: PlaybackSessionSaveOptions = {}
): Promise<RendererClosePersistenceOutcome> {
  try {
    await Promise.all(
      [...callbacks].map((callback) => Promise.resolve().then(() => callback(options)))
    )
    return { status: 'saved' }
  } catch (error) {
    return {
      status: 'failed',
      error:
        error instanceof Error && error.message ? error.message : String(error || 'Unknown error')
    }
  }
}
