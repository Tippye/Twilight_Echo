/** Decode inline image bytes locally. fetch(data:) is subject to connect-src
 * and is unnecessary for an image which is already in memory. */
export function imageDataUrlToBlob(value: string): Blob {
  const match = /^data:(image\/[a-z0-9.+-]+)((?:;[^,]*)?),(.*)$/is.exec(value)
  if (!match) throw new Error('Expected an inline image')
  const binary = /;base64(?:;|$)/i.test(match[2])
    ? atob(match[3])
    : decodeURIComponent(match[3])
  const bytes = /;base64(?:;|$)/i.test(match[2])
    ? Uint8Array.from(binary, (character) => character.charCodeAt(0))
    : new TextEncoder().encode(binary)
  return new Blob([bytes], { type: match[1] })
}
