import { isTrustedLiquidGlassImageUrl } from './liquidGlassEnvironment.ts'

/** Only local image sources are sampled; obsolete loads release handlers and timers. */
export function loadLiquidGlassContextImage(
  source: string,
  signal: AbortSignal,
  createImage: () => HTMLImageElement = () => new Image(),
  timeoutMs = 8000
): Promise<HTMLImageElement> {
  if (!isTrustedLiquidGlassImageUrl(source))
    return Promise.reject(new Error('Untrusted material image'))
  if (signal.aborted)
    return Promise.reject(new DOMException('Material image cancelled', 'AbortError'))
  return new Promise((resolve, reject) => {
    const image = createImage()
    const cleanup = (): void => {
      clearTimeout(timer)
      image.onload = null
      image.onerror = null
      signal.removeEventListener('abort', abort)
    }
    const fail = (error: Error): void => {
      cleanup()
      image.src = ''
      reject(error)
    }
    const abort = (): void => fail(new DOMException('Material image cancelled', 'AbortError'))
    const timer = setTimeout(() => fail(new Error('Material image timed out')), timeoutMs)
    image.decoding = 'async'
    // Local custom schemes are separate origins. Request their existing CORS
    // permission so reading the sampled pixels does not taint the canvas.
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      cleanup()
      resolve(image)
    }
    image.onerror = () => fail(new Error('Material image could not load'))
    signal.addEventListener('abort', abort, { once: true })
    image.src = source
  })
}
