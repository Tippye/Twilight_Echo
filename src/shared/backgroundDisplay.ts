/** Version the display URL so previously cached full-resolution wallpapers are bypassed. */
export function backgroundDisplayUrl(source: string): string {
  if (!source.startsWith('background://')) return source
  const url = new URL(source)
  url.searchParams.set('display', 'v1')
  return url.toString()
}
