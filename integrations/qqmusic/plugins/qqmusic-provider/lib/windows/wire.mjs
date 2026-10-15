import { createWindowsSignature } from './signature.mjs'

export const WINDOWS_SIGNED_ENDPOINT = 'https://u6.y.qq.com/cgi-bin/musics.fcg'

/** Sign the owned bytes that will be sent. HTTP defaults are a separate contract. */
export function buildWindowsSignedRequest(body, metadata, options) {
  if (!(body instanceof Uint8Array) || body.byteLength === 0) {
    throw new TypeError('body must contain serialized request bytes')
  }
  const ownedBody = Buffer.from(body)
  const { sign, mask } = createWindowsSignature(ownedBody, metadata, options)
  return {
    method: 'POST',
    url: WINDOWS_SIGNED_ENDPOINT,
    headers: { Sign: sign, Mask: mask },
    body: ownedBody
  }
}
