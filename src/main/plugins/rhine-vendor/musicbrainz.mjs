// Extracted from Rhine-Music-Demo a889801f scripts/music-library.mjs (MIT).
// Matching, pacing and source attribution remain upstream; persistence is host-owned.
const MBID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const text = value => typeof value === 'string' ? value.trim() : ''
const normalized = value => text(value).normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
const timestamp = () => new Date().toISOString()
const unique = items => [...new Set(items.filter(Boolean))]
const hasExternalIntroduction = album => album.descriptionSource?.method === 'external-ai'
export class MusicBrainzProvider {
  constructor({contact, fetcher = fetch}) { this.musicBrainzContact = contact; this.fetcher = fetcher; this.lastMusicBrainzRequest = 0; this.enrichStatus = {}; }
  async lookup(album) {
    this.index = { albums: [structuredClone(album)] };
    await this.enrichAlbum(this.index.albums[0]);
    const current = this.index.albums[0];
    return { online: current.online, producers: current.producers, rawGenres: unique([...(current.rawGenres ?? []), ...(current._onlineGenres ?? [])]), description: current.description, descriptionSource: current.descriptionSource };
  }
  async musicBrainz(endpoint, params = {}) {
    const url = new URL(`https://musicbrainz.org/ws/2/${endpoint}`)
    for (const [key, value] of Object.entries({ ...params, fmt: 'json' })) url.searchParams.set(key, value)
    return this.onlineJson(url)
  }

  async onlineJson(url) {
    if (!this.musicBrainzContact) throw new Error('请先配置自己的联系邮箱或项目网址，以满足 MusicBrainz User-Agent 要求')
    const wait = Math.max(0, this.lastMusicBrainzRequest + 1100 - Date.now())
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
    this.lastMusicBrainzRequest = Date.now()
    const response = await this.fetcher(url, {
      headers: { 'User-Agent': `RhineLocalMusic/0.1 (${this.musicBrainzContact})`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000), redirect: 'error',
    })
    if (!response.ok) throw new Error(`${url.hostname} HTTP ${response.status}，保留本地资料，可稍后重试`)
    return response.json()
  }

  async albumIntroduction(group) {
    // Only follow links already attached to the confidently matched album group;
    // title-only encyclopedia searches can silently pick an unrelated work.
    const relations = group?.relations ?? []
    let language
    let title
    const wikidata = relations.find((relation) => relation.type === 'wikidata')?.url?.resource
    const qid = wikidata?.match(/^https?:\/\/(?:www\.)?wikidata\.org\/wiki\/(Q\d+)\/?$/)?.[1]
    if (qid) {
      const entity = await this.onlineJson(new URL(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`))
      const links = entity.entities?.[qid]?.sitelinks
      if (links?.zhwiki?.title) { language = 'zh'; title = links.zhwiki.title }
      else if (links?.enwiki?.title) { language = 'en'; title = links.enwiki.title }
    }
    if (!title) {
      const candidates = relations.map((relation) => relation.url?.resource).filter(Boolean).map((resource) => {
        try {
          const url = new URL(resource)
          const match = /^(zh|en)\.wikipedia\.org$/.exec(url.hostname)
          return match && url.pathname.startsWith('/wiki/') ? { language: match[1], title: decodeURIComponent(url.pathname.slice(6)).replaceAll('_', ' ') } : null
        } catch { return null }
      }).filter(Boolean).sort((a, b) => (a.language === 'zh' ? -1 : 1) - (b.language === 'zh' ? -1 : 1))
      if (candidates[0]) ({ language, title } = candidates[0])
    }
    if (!title) return null
    const api = new URL(`https://${language}.wikipedia.org/w/api.php`)
    const params = { action: 'query', format: 'json', formatversion: '2', prop: 'extracts|info|pageprops', inprop: 'url', ppprop: 'disambiguation', exintro: '1', explaintext: '1', exchars: '800', redirects: '1', titles: title }
    for (const [key, value] of Object.entries(params)) api.searchParams.set(key, value)
    const data = await this.onlineJson(api)
    const page = data.query?.pages?.find((entry) => !entry.missing && !Object.hasOwn(entry.pageprops ?? {}, 'disambiguation') && text(entry.extract))
    if (!page) return null
    return {
      description: text(page.extract),
      descriptionSource: { name: language === 'zh' ? '维基百科' : 'Wikipedia', url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(page.title.replaceAll(' ', '_'))}`, checkedAt: timestamp(), license: 'CC BY-SA（以来源页为准）' },
    }
  }

  async enrichAlbum(album) {
    const checkedAt = timestamp()
    try {
      let releaseId = album.online?.releaseId
      if (!releaseId) {
        const escape = (value) => value.replace(/[+\-&|!(){}\[\]^"~*?:\\/]/g, '\\$&')
        const found = await this.musicBrainz('release', { query: `release:"${escape(album.title)}" AND artist:"${escape(album.artist)}"`, limit: '5' })
        const candidates = (found.releases ?? []).filter((candidate) =>
          normalized(candidate.title) === normalized(album.title) &&
          normalized((candidate['artist-credit'] ?? []).map((credit) => credit.name ?? credit.artist?.name ?? '').join('')) === normalized(album.artist) &&
          Number(candidate['track-count']) === album.tracks.length &&
          (!album.year || !candidate.date || candidate.date.startsWith(String(album.year))) && Number(candidate.score ?? 0) >= 95)
        // Multiple pressings are not interchangeable for production credits.
        if (candidates.length !== 1) {
          album.online = { ...album.online, status: found.releases?.length ? 'uncertain' : 'not-found', checkedAt }
          return
        }
        releaseId = candidates[0].id
      }
      if (!MBID.test(releaseId)) throw new Error('无效的 MusicBrainz Release ID')
      const release = await this.musicBrainz(`release/${releaseId}`, { inc: 'artist-credits+recordings+recording-level-rels+artist-rels+release-groups+genres' })
      const releaseGroupId = release['release-group']?.id ?? album.online?.releaseGroupId
      const group = releaseGroupId && MBID.test(releaseGroupId) ? await this.musicBrainz(`release-group/${releaseGroupId}`, { inc: 'genres+artist-rels+url-rels' }) : null
      const genres = [...(release.genres ?? []), ...(group?.genres ?? [])].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).map((genre) => text(genre.name))
      const producers = []
      const collect = (relations = [], trackTitle) => {
        for (const relation of relations) if (/producer/i.test(relation.type ?? '') && relation.artist?.name) {
          producers.push({ name: relation.artist.name, role: relation.type, source: 'MusicBrainz', trackTitle, url: `https://musicbrainz.org/artist/${relation.artist.id}` })
        }
      }
      collect(release.relations)
      collect(group?.relations)
      for (const medium of release.media ?? []) for (const track of medium.tracks ?? []) collect(track.recording?.relations, track.title ?? track.recording?.title)
      const online = { status: 'matched', releaseId, releaseGroupId, checkedAt, sourceUrl: `https://musicbrainz.org/release/${releaseId}` }
      let introduction
      try {
        if (!hasExternalIntroduction(album)) introduction = await this.albumIntroduction(group)
        online.descriptionStatus = introduction || hasExternalIntroduction(album) ? 'available' : 'not-found'
      } catch (error) {
        online.descriptionStatus = 'error'
        online.descriptionError = error.message
      }
      // Commit after all awaited requests, to the current record after any scan.
      const current = this.index.albums.find((entry) => entry.id === album.id)
      if (!current || current.title !== album.title || current.artist !== album.artist || current.year !== album.year) return
      current._onlineGenres = unique(genres)
      current.producers = uniqueProducers([...(current.producers ?? []).filter((person) => person.source !== 'MusicBrainz'), ...producers])
      current.online = online
      if (introduction && !hasExternalIntroduction(current)) Object.assign(current, introduction)
      Object.assign(album, { _onlineGenres: current._onlineGenres, producers: current.producers, online: current.online, description: current.description, descriptionSource: current.descriptionSource })
    } catch (error) {
      album.online = { ...album.online, status: 'error', checkedAt, error: error.message }
      this.enrichStatus.error = error.message
    }
  }
}

function uniqueProducers(producers) {
  const seen = new Set()
  return producers.filter((producer) => {
    const key = JSON.stringify([producer.name, producer.role, producer.trackId ?? producer.trackTitle ?? '', producer.source])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
