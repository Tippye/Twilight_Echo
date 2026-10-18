// Temporary task-owned evidence package. Never include this entry in the final provider.
import { activate as activateSource, deactivate as deactivateSource } from './windows-index.mjs'
import { WindowsMusicClient } from './lib/windows/client.mjs'
import { buildWindowsUserPlaylistsCall, WINDOWS_USER_PLAYLISTS_REQUEST_KEY,
  buildWindowsPlaylistDetailCall, WINDOWS_PLAYLIST_DETAIL_REQUEST_KEY } from './lib/windows/playlist-call.mjs'
import { buildWindowsFavoritePlaylistsCall, WINDOWS_FAVORITE_PLAYLISTS_REQUEST_KEY } from './lib/windows/playlist-call.mjs'
import { hostname, release } from 'node:os'
import { randomBytes } from 'node:crypto'
import { buildWindowsDesktopSearchCall, WINDOWS_DESKTOP_SEARCH_REQUEST_KEY } from './lib/windows/search-call.mjs'
import { serializeWindowsSettings, WINDOWS_QUALITY_COMMAND } from './lib/windows/settings.mjs'
import { createWindowsPlaylistReference, decodeWindowsPlaylistDetail, mapCreatedWindowsPlaylist,
  mapFavoriteWindowsPlaylist, decodeWindowsCreatedPlaylists, decodeWindowsFavoritePlaylists } from './lib/windows/playlist-data.mjs'
import { mapWindowsTrack, windowsSongMedia } from './lib/windows/tracks.mjs'
import { buildWindowsTrackInfoCall, WINDOWS_TRACK_INFO_REQUEST_KEY } from './lib/windows/song-detail-call.mjs'
import { createWindowsQualityCandidateProbe } from './windows-quality-probe-helper.mjs'
import { buildWindowsAlbumSongListCall, mapWindowsAlbumSongList, WINDOWS_ALBUM_SONG_LIST_REQUEST_KEY } from './lib/windows/album-call.mjs'
import { buildWindowsArtistSongListCall, buildWindowsArtistDetailCall, buildWindowsArtistAlbumListCall,
  WINDOWS_ARTIST_SONG_LIST_REQUEST_KEY, WINDOWS_ARTIST_DETAIL_REQUEST_KEY, WINDOWS_ARTIST_ALBUM_LIST_REQUEST_KEY,
  decodeWindowsArtistSongList, decodeWindowsArtistDetail } from './lib/windows/artist-call.mjs'
import { buildWindowsDiscoveryFeedCall, buildWindowsDiscoveryTabsCall, buildWindowsCategoryContentCall,
  buildWindowsCategoryBasicCall, WINDOWS_DISCOVERY_FEED_REQUEST_KEY, WINDOWS_DISCOVERY_TABS_REQUEST_KEY,
  WINDOWS_CATEGORY_CONTENT_REQUEST_KEY, WINDOWS_CATEGORY_BASIC_REQUEST_KEY } from './lib/windows/discovery-call.mjs'
let probeClient
let probeLibrary, probePlaylist, probeDetail
function shape(value, depth = 0) {
  if (value === null) return 'null'
  if (depth > 8) return 'bounded'
  if (Array.isArray(value)) return { kind: 'array', length: value.length,
    samples: value.slice(0, 1).map(v => shape(v, depth + 1)) }
  if (typeof value !== 'object') return typeof value === 'string' && /^-?\d+$/.test(value)
    ? 'decimal-string' : typeof value
  return Object.fromEntries(Object.keys(value).filter(k => /^[a-zA-Z_][a-zA-Z0-9_]{0,79}$/.test(k))
    .slice(0, 100).map(k => [k, shape(value[k], depth + 1)]))
}
export async function activate(context) {
  const settings = serializeWindowsSettings(context.settings)
  probeClient = new WindowsMusicClient({ settings, getDevice: async () => {
    const stored = await settings.get('windows-device')
    if (!/^[a-fA-F0-9]{32}$/.test(stored?.guid ?? '')) throw new Error('Task device unavailable')
    return { guid: stored.guid, deviceName: hostname(), channelId: 0,
      encodedOsVersion: encodeURIComponent(`Windows ${release()}`) }
  } })
  const probes = {
      inspectPublicPlaylistBindings: async (kind = 'feed', begin = 0) => {
        if (!['feed', 'category', 'search'].includes(kind) || !Number.isSafeInteger(begin) || begin < 0 || begin > 30) throw new Error('Task public binding input invalid')
        if (!await probeClient.checkLogin()) throw new Error('Login required')
        const session = await probeClient.getSession()
        let rows
        if (kind === 'feed') {
          const data = await probeClient.request(WINDOWS_DISCOVERY_FEED_REQUEST_KEY, buildWindowsDiscoveryFeedCall())
          rows = data.FeedRsp?.List?.map(row => row.Playlist?.basic)
        } else if (kind === 'category') {
          const tabs = await probeClient.request(WINDOWS_DISCOVERY_TABS_REQUEST_KEY, buildWindowsDiscoveryTabsCall())
          const tab = tabs.List.find(row => row.TagID > 0 && row.TagType !== 5)
          const data = await probeClient.request(WINDOWS_CATEGORY_CONTENT_REQUEST_KEY,
            buildWindowsCategoryContentCall({ categoryId: tab.TagID, caller: session.musicid }))
          rows = data.content?.v_item?.map(row => row.basic)
        } else {
          const call = buildWindowsDesktopSearchCall({ query: '日语', pageNum: 1, numPerPage: 2,
            searchType: 3, remoteplace: 'pc.button.search.song', searchId: randomBytes(16).toString('hex').toUpperCase() + '00000' })
          const data = await probeClient.request(WINDOWS_DESKTOP_SEARCH_REQUEST_KEY, call)
          rows = data.body?.songlist?.list.map(row => ({ tid: row.dissid, creator: { uin: row.creator?.creator_uin } }))
        }
        const results = []
        for (const [relative, row] of rows.slice(begin, begin + 2).entries()) {
          const detail = await probeClient.request(WINDOWS_PLAYLIST_DETAIL_REQUEST_KEY,
            buildWindowsPlaylistDetailCall({ loginUin: session.musicid, hostUin: session.musicid, disstid: String(row.tid) }))
          let actual
          try { const ref = createWindowsPlaylistReference({ hostUin: String(detail.dirinfo?.host_uin), disstid: String(row.tid) });
            const decoded = decodeWindowsPlaylistDetail(detail, { playlistId: ref, sessionUin: session.musicid });
            actual = { accepted: true, count: decoded.tracks.length, complete: decoded.complete } }
          catch { actual = { accepted: false } }
          results.push({ index: begin + relative, nativeCode: detail.code, nativeSubcode: detail.subcode,
            sourceCreatorUinType: typeof row.creator?.uin, sourceCreatorUinEmpty: row.creator?.uin === '',
            responseIdMatches: String(detail.dirinfo?.id) === String(row.tid),
            responseHostMatchesCreatorMusicid: String(detail.dirinfo?.host_uin) === String(detail.dirinfo?.creator?.musicid),
            responseHostIsZero: String(detail.dirinfo?.host_uin) === '0', rawCount: detail.songlist?.length,
            total: detail.total_song_num, actual,
            formatCounts: Object.fromEntries(['size_hires', 'size_dolby', 'size_dts'].map(field =>
              [field, detail.songlist?.filter(song => Number.isSafeInteger(song.file?.[field]) && song.file[field] > 0).length])),
            publicSurroundCandidates: detail.songlist?.filter(song => Number.isSafeInteger(song.file?.size_dts) &&
              song.file.size_dts > 0 && mapWindowsTrack(song)?.playbackStatus !== 'unsupported')
              .slice(0, 5).map(song => ({ id: mapWindowsTrack(song)?.id, title: mapWindowsTrack(song)?.title })) })
        }
        return { investigationOnly: true, kind, requestHostPolicy: 'explicit-owned-session-musicid-public-lookup-trial', results }
      },
      inspectFullCategories: async () => {
        if (!await probeClient.checkLogin()) throw new Error('Login required')
        const call = { module: 'music.playlist.PlaylistSquare', method: 'GetAllTag', param: { qq: '' } }
        const data = await probeClient.request(`${call.module}.${call.method}`, call)
        return { investigationOnly: true, schema: shape(data),
          groups: data.v_group?.map(group => ({ name: group.group_name, idType: typeof group.group_id,
            rows: group.v_item?.map(row => ({ id: row.id, name: row.name, source: row.source,
              tag: typeof row.tag === 'string' && ['HOT', 'hot', 'NEW', 'new', ''].includes(row.tag) ? row.tag : null,
              tagType: typeof row.tag, tagTruthy: !!row.tag })) })) }
      },
      inspectDiscoveryPagination: async (phase = 'feed', groupBegin = 0) => {
        if (!['feed', 'category', 'groups'].includes(phase) || !Number.isSafeInteger(groupBegin) || groupBegin < 0 || groupBegin > 20) throw new Error('Task pagination phase invalid')
        if (!await probeClient.checkLogin()) throw new Error('Login required')
        const session = await probeClient.getSession()
        const summary = {}, feedRows = [], categoryRows = []
        for (const from of phase === 'feed' ? [0, 30, 60] : []) {
          const call = buildWindowsDiscoveryFeedCall()
          call.param.FeedReq = { From: from, Size: 30 }
          const data = await probeClient.request(WINDOWS_DISCOVERY_FEED_REQUEST_KEY, call)
          const rows = data.FeedRsp?.List
          feedRows.push(rows?.map(row => String(row.Playlist?.basic?.tid)) ?? [])
          summary[`feed${from}`] = { count: rows?.length, hasMore: data.FeedRsp?.HasMore,
            fromLimit: data.FeedRsp?.FromLimit, missingIdentities: rows?.filter(row => !row.Playlist?.basic?.tid).length }
        }
        const tabs = await probeClient.request(WINDOWS_DISCOVERY_TABS_REQUEST_KEY, buildWindowsDiscoveryTabsCall())
        const ordinary = tabs.List?.filter(row => Number.isSafeInteger(row.TagID) && row.TagID > 0 && row.TagType !== 5)
        summary.tabs = tabs.List?.map(row => ({ id: row.TagID, type: row.TagType, name: row.TagName }))
        if (ordinary?.length && phase !== 'feed') {
          const tab = ordinary[0]
          for (const page of phase === 'category' ? [0, 1, 2] : []) {
            const call = buildWindowsCategoryContentCall({ categoryId: tab.TagID, caller: session.musicid })
            call.param.page = page; call.param.size = 30
            const data = await probeClient.request(WINDOWS_CATEGORY_CONTENT_REQUEST_KEY, call)
            const rows = data.content?.v_item
            categoryRows.push(rows?.map(row => String(row.basic?.tid)) ?? [])
            summary[`categoryPage${page}`] = { retcode: data.retcode, count: rows?.length,
              total: data.content?.total_cnt, missingIdentities: rows?.filter(row => !row.basic?.tid).length }
          }
          summary.categoryGroups = []
          for (const row of phase === 'groups' ? ordinary.slice(groupBegin, groupBegin + 3) : []) {
            const data = await probeClient.request(WINDOWS_CATEGORY_BASIC_REQUEST_KEY,
              buildWindowsCategoryBasicCall({ categoryId: row.TagID, caller: session.musicid }))
            summary.categoryGroups.push({ id: row.TagID, responseIdMatches: data.category?.id === row.TagID,
              responseNameMatches: data.category?.name === row.TagName,
              groupId: data.category?.group_id, groupName: data.category?.group_name,
              name: data.category?.name, retcode: data.retcode })
          }
        }
        const overlap = rows => rows.slice(1).map((next, i) => ({ adjacentOverlap: next.filter(id => rows[i].includes(id)).length,
          exactSameOrder: JSON.stringify(next) === JSON.stringify(rows[i]) }))
        summary.feedRelations = overlap(feedRows)
        summary.categoryRelations = overlap(categoryRows)
        return { investigationOnly: true, paginationTrialsAreAdapterInputs: true, summary }
      },
      inspectRecommendedDetails: async (begin = 0) => {
        if (!Number.isSafeInteger(begin) || begin < 0 || begin > 11) throw new Error('Task playlist batch invalid')
        if (!await probeClient.checkLogin()) throw new Error('Login required')
        const session = await probeClient.getSession()
        const call = { module: 'playlist.HotRecommendServer', method: 'get_new_hot_recommend',
          param: { cmd: 0, page: 0, daily_page: 0, size: 12 } }
        const data = await probeClient.request(`${call.module}.${call.method}`, call)
        const results = []
        for (const [relative, row] of data.grids.slice(begin, begin + 3).entries()) {
          const index = begin + relative
          try {
            const requested = createWindowsPlaylistReference({ hostUin: row.creator?.uin, disstid: String(row.id) })
            const detail = await probeClient.request(WINDOWS_PLAYLIST_DETAIL_REQUEST_KEY,
              buildWindowsPlaylistDetailCall({ loginUin: session.musicid, hostUin: row.creator.uin, disstid: String(row.id) }))
            let original, actual
            try { const decoded = decodeWindowsPlaylistDetail(detail, { playlistId: requested, sessionUin: session.musicid });
              original = { accepted: true, count: decoded.tracks.length, complete: decoded.complete } }
            catch { original = { accepted: false } }
            try { const ref = createWindowsPlaylistReference({ hostUin: String(detail.dirinfo?.host_uin), disstid: String(row.id) });
              const decoded = decodeWindowsPlaylistDetail(detail, { playlistId: ref, sessionUin: session.musicid });
              actual = { accepted: true, count: decoded.tracks.length, complete: decoded.complete } }
            catch { actual = { accepted: false } }
            results.push({ index, sourceType: row.source_type, nativeCode: detail.code, nativeSubcode: detail.subcode,
              responseIdMatches: String(detail.dirinfo?.id) === String(row.id),
              responseHostMatchesGridCreator: String(detail.dirinfo?.host_uin) === row.creator.uin,
              responseHostMatchesCreatorMusicid: String(detail.dirinfo?.host_uin) === String(detail.dirinfo?.creator?.musicid),
              gridCreatorIsZero: row.creator?.uin === '0', responseHostIsZero: String(detail.dirinfo?.host_uin) === '0',
              rawCount: detail.songlist?.length, total: detail.total_song_num, original, actual })
          } catch (error) { results.push({ index, accepted: false, code: Number.isInteger(error.code) ? error.code : null }) }
        }
        return { investigationOnly: true, results }
      },
      inspectDiscovery: async () => {
        if (!await probeClient.checkLogin()) throw new Error('Login required')
        const session = await probeClient.getSession()
        const results = {}
        let tabData
        for (const [kind, key, call] of [
          ['feed', WINDOWS_DISCOVERY_FEED_REQUEST_KEY, buildWindowsDiscoveryFeedCall()],
          ['tabs', WINDOWS_DISCOVERY_TABS_REQUEST_KEY, buildWindowsDiscoveryTabsCall()]
        ]) {
          try { const data = await probeClient.request(key, call); results[kind] = { accepted: true, schema: shape(data) };
            if (kind === 'tabs') tabData = data }
          catch (error) { results[kind] = { accepted: false, code: Number.isInteger(error.code) ? error.code : null } }
        }
        const tab = tabData?.List?.find(row => Number.isSafeInteger(row.TagID) && row.TagID > 0 && row.TagType !== 5)
        results.ordinaryTabFound = !!tab
        if (tab) {
          for (const [kind, key, call] of [
            ['category', WINDOWS_CATEGORY_CONTENT_REQUEST_KEY, buildWindowsCategoryContentCall({ categoryId: tab.TagID, caller: session.musicid })],
            ['categoryBasic', WINDOWS_CATEGORY_BASIC_REQUEST_KEY, buildWindowsCategoryBasicCall({ categoryId: tab.TagID, caller: session.musicid })]
          ]) {
            try { const data = await probeClient.request(key, call); results[kind] = { accepted: true, schema: shape(data) } }
            catch (error) { results[kind] = { accepted: false, code: Number.isInteger(error.code) ? error.code : null } }
          }
        }
        return { investigationOnly: true, transport: 'WindowsMusicClient ct19/cv2271 compatibility', results }
      },
      inspectDailyFeed: async (variant = 'embedded') => {
        if (!['embedded', 'native-observed'].includes(variant)) throw new Error('Task selector invalid')
        if (!await probeClient.checkLogin()) throw new Error('Login required')
        const device = await settings.get('windows-device')
        if (!/^[a-fA-F0-9]{32}$/.test(device?.guid ?? '')) throw new Error('Task device unavailable')
        const feedCall = { module: 'music.recommend.RecommendFeed', method: 'get_recommend_feed',
          param: { direction: 0, page: 1, v_cache: [], v_uniq: [], s_num: 0 } }
        const feed = await probeClient.request(`${feedCall.module}.${feedCall.method}`, feedCall)
        const selectedShelfKind = variant === 'native-observed' ? 201 : 301
        const shelf = feed.v_shelf?.find(row => row.id === selectedShelfKind)
        const card = shelf?.v_niche?.[0]?.v_card?.find(row => row.title === '每日30首')
        const result = { investigationOnly: true, selectorVariant: variant, selectorShelfKind: selectedShelfKind,
          feedAccepted: true, feedSchema: shape(feed), dailyCardFound: !!card,
          feedRetcode: feed.retcode, shelfSummary: feed.v_shelf?.map(row => ({
            shelfKind: Number.isSafeInteger(row.id) && row.id >= 0 && row.id <= 10000 ? row.id : null,
            firstNicheCards: row.v_niche?.[0]?.v_card?.length,
            firstNicheExactDailyTitle: row.v_niche?.[0]?.v_card?.some(v => v.title === '每日30首'),
            anyNicheExactDailyTitle: row.v_niche?.some(n => n.v_card?.some(v => v.title === '每日30首')) })) }
        if (!card) return result
        const value = typeof card.id === 'number' && Number.isSafeInteger(card.id) ? String(card.id) : card.id
        if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value) || BigInt(value) > 0x7fffffffffffffffn) throw new Error('Task daily identity invalid')
        const call = { module: 'music.srfDissInfo.aiDissInfo', method: 'uniform_get_Dissinfo',
          param: { disstid: JSON.rawJSON(value), userinfo: 1, tag: 1, guid: device.guid } }
        try {
          const data = await probeClient.request(`${call.module}.${call.method}`, call)
          result.detail = { accepted: true, schema: shape(data), rawSongs: data.songlist?.length,
            total: data.total_song_num, strictMappingCount: data.songlist?.filter(song => mapWindowsTrack(song)).length,
            responseIdMatches: String(data.dirinfo?.id) === value,
            nativeCode: data.code, nativeSubcode: data.subcode,
            hasmoreIsZero: data.hasmore === 0, dirSongnumMatchesTotal: data.dirinfo?.songnum === data.total_song_num,
            formatCounts: Object.fromEntries(['size_hires', 'size_dolby', 'size_dts'].map(k =>
              [k, data.songlist?.filter(song => Number.isSafeInteger(song.file?.[k]) && song.file[k] > 0).length])) }
        } catch (error) { result.detail = { accepted: false, errorName: error.name, code: Number.isInteger(error.code) ? error.code : null } }
        return result
      },
      inspectOfficialPlaylistDetail: async () => {
        if (!await probeClient.checkLogin()) throw new Error('Login required')
        const session = await probeClient.getSession()
        const call = { module: 'playlist.HotRecommendServer', method: 'get_new_hot_recommend',
          param: { cmd: 0, page: 0, daily_page: 0, size: 12 } }
        const data = await probeClient.request(`${call.module}.${call.method}`, call)
        const row = data.grids?.[0]
        if (!row) throw new Error('Task official playlist unavailable')
        const reference = createWindowsPlaylistReference({ hostUin: row.creator?.uin, disstid: String(row.id) })
        const detailCall = buildWindowsPlaylistDetailCall({ loginUin: session.musicid,
          hostUin: row.creator.uin, disstid: String(row.id) })
        const detail = await probeClient.request(WINDOWS_PLAYLIST_DETAIL_REQUEST_KEY, detailCall)
        let mapped
        try { const result = decodeWindowsPlaylistDetail(detail, { playlistId: reference, sessionUin: session.musicid });
          mapped = { accepted: true, tracks: result.tracks.length, unsupported: result.unsupportedCount, complete: result.complete } }
        catch { mapped = { accepted: false } }
        return { investigationOnly: true, nativeRequestAccepted: true, schema: shape(detail), mapped,
          headerKnownLabels: Object.fromEntries(['name', 'title'].map(k => [k,
            ['官方歌单', '推荐歌单', '为你推荐', '每日推荐', '猜你喜欢'].find(label => data[k] === label) ?? null])),
          firstGridIsExactDailyTitle: row.title === '每日30首',
          allGridKnownDailyFlags: data.grids.map(v => v.title === '每日30首'),
          relations: { responseIdMatches: String(detail.dirinfo?.id) === String(row.id),
            responseHostMatchesGridCreator: String(detail.dirinfo?.host_uin) === row.creator.uin,
            creatorMusicidMatchesGridCreator: String(detail.dirinfo?.creator?.musicid) === row.creator.uin,
            responseHostIsZero: String(detail.dirinfo?.host_uin) === '0',
            nativeCode: detail.code, nativeSubcode: detail.subcode,
            rawRows: detail.songlist?.length, total: detail.total_song_num } }
      },
      inspectHomeLists: async () => {
        if (!await probeClient.checkLogin()) throw new Error('Login required')
        const results = {}
        for (const [kind, call] of [
          ['officialPlaylists', { module: 'playlist.HotRecommendServer', method: 'get_new_hot_recommend', param: { cmd: 0, page: 0, daily_page: 0, size: 12 } }],
          ['newSongs', { module: 'newsong.NewSongServer', method: 'get_new_song_info', param: { type: 5 } }]
        ]) {
          try {
            const data = await probeClient.request(`${call.module}.${call.method}`, call)
            results[kind] = { accepted: true, schema: shape(data) }
            if (kind === 'officialPlaylists') {
              results[kind].kindFlags = data.grids?.map(row => {
                let navigation = null
                try { const url = new URL(row.jmpurl); navigation = { protocol: url.protocol,
                  origin: url.origin, path: url.pathname.replace(/[0-9]{3,}/g, '[id]'),
                  queryKeys: [...url.searchParams.keys()],
                  idQueryMatches: ['id', 'disstid', 'songlistid'].some(k => url.searchParams.get(k) === String(row.id)) } } catch {}
                return { type: row.type, sourceType: row.source_type, recommendType: row.recomm_type,
                  source: row.source, viewType: row.view_type, navigation,
                  creatorUinPresent: typeof row.creator?.uin === 'string', idIsSafe: Number.isSafeInteger(row.id) }
              })
            }
            if (kind === 'newSongs') {
              results[kind].publicSamples = data.songlist?.slice(0, 2).map(song => ({
                id: song.id, mid: song.mid, title: song.title,
                album: { id: song.album?.id, mid: song.album?.mid, name: song.album?.name } }))
              results[kind].rawSongs = data.songlist?.length
              results[kind].strictMappingCount = data.songlist?.filter(song => mapWindowsTrack(song)).length
            }
          } catch (error) { results[kind] = { accepted: false, errorName: error.name, code: Number.isInteger(error.code) ? error.code : null } }
        }
        return { investigationOnly: true, transport: 'WindowsMusicClient ct19/cv2271 compatibility', results }
      },
      inspectArtistPages: async () => {
        if (!await probeClient.checkLogin()) throw new Error('Login required')
        const artist = 'qq:artist:0025NhlN2yWrP4:4558'
        const singerMid = '0025NhlN2yWrP4'
        const results = {}
        for (const [kind, key, call] of [
          ['songs', WINDOWS_ARTIST_SONG_LIST_REQUEST_KEY, buildWindowsArtistSongListCall({ singerMid, begin: 0, num: 10, order: 1 })],
          ['detail', WINDOWS_ARTIST_DETAIL_REQUEST_KEY, buildWindowsArtistDetailCall({ singerMid })],
          ['albums', WINDOWS_ARTIST_ALBUM_LIST_REQUEST_KEY, buildWindowsArtistAlbumListCall({ singerMid, begin: 0, num: 20, order: 1 })]
        ]) {
          try {
            const data = await probeClient.request(key, call)
            results[kind] = { accepted: true, schema: shape(data) }
            if (kind === 'songs') {
              const tracks = decodeWindowsArtistSongList(data, { singerMid, num: 10 })
              results[kind].mapped = tracks.length
              results[kind].publicSamples = tracks.slice(0, 2).map(t => ({ id: t.id, title: t.title }))
            } else if (kind === 'detail') {
              try { const mapped = decodeWindowsArtistDetail(data, { artist }); results[kind].mappingAccepted = true; results[kind].descriptionLength = mapped.description.length }
              catch { results[kind].mappingAccepted = false }
            } else {
              const row = data.albumList?.[0]
              results[kind].publicSample = row ? Object.fromEntries(['albumId', 'albumID', 'albumMid', 'albumName', 'publishDate', 'pmid', 'songNum', 'singerID', 'singerMid'].filter(k => Object.hasOwn(row, k)).map(k => [k, row[k]])) : null
            }
          } catch (error) { results[kind] = { accepted: false, errorName: error.name, code: Number.isInteger(error.code) ? error.code : null } }
        }
        return { investigationOnly: true, transport: 'WindowsMusicClient ct19/cv2271 compatibility', publicArtist: artist, results }
      },
      inspectArtistAlbumPages: async () => {
        if (!await probeClient.checkLogin()) throw new Error('Login required')
        const singerMid = '0025NhlN2yWrP4'
        const pages = []
        for (const begin of [0, 2]) {
          const data = await probeClient.request(WINDOWS_ARTIST_ALBUM_LIST_REQUEST_KEY,
            buildWindowsArtistAlbumListCall({ singerMid, begin, num: 2, order: 0 }))
          pages.push({ requestedBegin: begin, requestedNum: 2, rows: data.albumList?.length,
            singerMidMatches: data.singerMid === singerMid, total: data.total,
            ids: data.albumList?.map(row => row.albumID), mids: data.albumList?.map(row => row.albumMid) })
        }
        return { investigationOnly: true, publicArtist: 'qq:artist:0025NhlN2yWrP4:4558', pages,
          stableTotal: pages[0].total === pages[1].total,
          noOverlap: !pages[0].ids.some(id => pages[1].ids.includes(id)) && !pages[0].mids.some(mid => pages[1].mids.includes(mid)) }
      },
      inspectLibraryMapping: async () => {
        if (!await probeClient.checkLogin()) throw new Error('Login required')
        const session = await probeClient.getSession()
        const created = await probeClient.request(WINDOWS_USER_PLAYLISTS_REQUEST_KEY,
          buildWindowsUserPlaylistsCall({ uin: session.musicid }))
        const favorites = await probeClient.request(WINDOWS_FAVORITE_PLAYLISTS_REQUEST_KEY,
          buildWindowsFavoritePlaylistsCall({ uin: session.musicid }))
        probeLibrary = { uin: session.musicid, data: created }
        const fields = ['uin', 'tid', 'dirId', 'dirName', 'name', 'songNum', 'songnum', 'bigpicUrl', 'picUrl', 'logo', 'nick', 'nickname']
        const inspect = (records, mapper) => records.map((row, index) => {
          try { mapper(row, { sessionUin: session.musicid }); return { index, success: true } }
          catch { return { index, success: false,
            recordFlags: { status: row.status, opType: row.opType, dirShow: row.dirShow, dirType: row.dirType,
              intersectsDeleted: favorites.v_delTids.some(id => String(id) === String(row.tid)) },
            fields: Object.fromEntries(fields.map(field => {
            const value = row[field]
            let absoluteHttp = null
            if (['bigpicUrl', 'picUrl', 'logo'].includes(field) && typeof value === 'string' && value.trim()) {
              try { const url = new URL(value); absoluteHttp = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password } catch { absoluteHttp = false }
            }
            return [field, { type: value === null ? 'null' : typeof value,
              blank: typeof value === 'string' ? !value.trim() : null,
              tooLong: typeof value === 'string' ? value.length > 4096 : null,
              hasNul: typeof value === 'string' ? value.includes('\0') : null,
              nonnegativeInteger: typeof value === 'number' ? Number.isSafeInteger(value) && value >= 0 : null,
              absoluteHttp }]
          })) } }
        })
        let createdSuccess = false, favoriteSuccess = false
        try { decodeWindowsCreatedPlaylists(created, { sessionUin: session.musicid }); createdSuccess = true } catch {}
        try { decodeWindowsFavoritePlaylists(favorites, { sessionUin: session.musicid }); favoriteSuccess = true } catch {}
        return { investigationOnly: true, createdSuccess, favoriteSuccess,
          created: inspect(created.v_playlist, mapCreatedWindowsPlaylist), favorites: inspect(favorites.v_list, mapFavoriteWindowsPlaylist) }
      },
      fetchAlbumTracks: async () => {
        if (!await probeClient.checkLogin()) throw new Error('Login required')
        const data = await probeClient.request(WINDOWS_ALBUM_SONG_LIST_REQUEST_KEY,
          buildWindowsAlbumSongListCall({ albumMid: '000MkMni19ClKG', albumId: 8220, begin: 0, num: 20, order: 0 }))
        const tracks = mapWindowsAlbumSongList(data)
        return { investigationOnly: true, schema: shape(data), requestedPageSize: 20,
          rawRows: data.songList?.length, mappedTracks: tracks.length,
          total: data.totalNum, cursor: data.curBegin, albumMatches: data.albumMid === '000MkMni19ClKG',
          publicSamples: tracks.slice(0, 2).map(track => ({ id: track.id, title: track.title })) }
      },
      inspectAlbumPages: async () => {
        if (!await probeClient.checkLogin()) throw new Error('Login required')
        const pages = []
        for (const begin of [0, 2]) {
          const data = await probeClient.request(WINDOWS_ALBUM_SONG_LIST_REQUEST_KEY,
            buildWindowsAlbumSongListCall({ albumMid: '000MkMni19ClKG', albumId: 8220, begin, num: 2, order: 0 }))
          pages.push({ requestedBegin: begin, rawRows: data.songList.length, total: data.totalNum,
            cursor: data.curBegin, albumMatches: data.albumMid === '000MkMni19ClKG',
            ids: mapWindowsAlbumSongList(data).map(track => track.id) })
        }
        return { investigationOnly: true, pages, noOverlap: !pages[0].ids.some(id => pages[1].ids.includes(id)) }
      },
      selectPlaylistFormat: async (format) => {
        const fields = { hires: 'size_hires', surround: 'size_dts', dolby: 'size_dolby' }
        if (!Object.hasOwn(fields, format) || !await probeClient.checkLogin()) throw new Error('Task format selector invalid')
        const session = await probeClient.getSession()
        if (probeDetail?.uin !== session.musicid) throw new Error('Task detail unavailable')
        const rows = probeDetail.data.songlist
        const counts = Object.fromEntries(Object.entries(fields).map(([key, field]) =>
          [key, rows.filter(song => Number.isInteger(song.file?.[field]) && song.file[field] > 0).length]))
        const song = rows.find(song => Number.isInteger(song.file?.[fields[format]]) && song.file[fields[format]] > 0 && mapWindowsTrack(song))
        return { investigationOnly: true, counts, track: song ? mapWindowsTrack(song) : null }
      },
      inspectSpecialTrackInfo: async () => {
        if (!await probeClient.checkLogin()) throw new Error('Login required')
        const session = await probeClient.getSession()
        if (probeDetail?.uin !== session.musicid) throw new Error('Task detail unavailable')
        const songs = probeDetail.data.songlist.filter(song => song.type === 21 && song.mid === '' && song.file?.media_mid === '')
        if (!songs.length || songs.length > 10) throw new Error('Task special identity bound failed')
        const data = await probeClient.request(WINDOWS_TRACK_INFO_REQUEST_KEY,
          buildWindowsTrackInfoCall({ ids: songs.map(song => song.id), types: songs.map(song => song.type), ctx: 0, scene: 0 }))
        return { investigationOnly: true, inputCount: songs.length, schema: shape(data),
          returned: data.tracks?.map(song => ({ idMatchesInput: songs.some(input => input.id === song.id),
            nativeType: song.type, midType: typeof song.mid, midLength: typeof song.mid === 'string' ? song.mid.length : null,
            mediaMidType: typeof song.file?.media_mid, mediaMidLength: typeof song.file?.media_mid === 'string' ? song.file.media_mid.length : null,
            mapsToTrack: !!mapWindowsTrack(song) })) }
      },
      searchFormatCandidates: async (query) => {
        if (!['周深', '陈奕迅', '张杰', '蔡琴', 'Taylor Swift', '杜比', '5.1', 'DTS', 'Hotel California'].includes(query)) throw new Error('Public query mismatch')
        return createWindowsQualityCandidateProbe({ client: probeClient,
          buildSearchCall: buildWindowsDesktopSearchCall, searchRequestKey: WINDOWS_DESKTOP_SEARCH_REQUEST_KEY,
          buildTrackInfoCall: buildWindowsTrackInfoCall, trackInfoRequestKey: WINDOWS_TRACK_INFO_REQUEST_KEY
        }).search({ query, numPerPage: 20, includeDetails: true,
          searchId: randomBytes(16).toString('hex').toUpperCase() + '00001' })
      },
      searchArtists: (...args) => catalog(1, args),
      searchAlbums: (...args) => catalog(2, args),
      searchPlaylists: (...args) => catalog(3, args),
      fetchPlaylistTracks: async (...args) => {
        const invocation = args.at(-1)
        if (!await probeClient.checkLogin({ signal: invocation?.signal })) throw new Error('Login required')
        const session = await probeClient.getSession()
        let call
        if (args[0] === 'task-first-directory' && probeLibrary?.uin === session.musicid) {
          const row = probeLibrary.data.v_playlist?.[0]
          if (!row) throw new Error('No task directory')
          call = buildWindowsPlaylistDetailCall({ loginUin: session.musicid, hostUin: session.musicid,
            disstid: String(row.tid), dirid: String(row.dirId) })
        } else if (args[0] === 'task-first-public' && probePlaylist?.uin === session.musicid) {
          const row = probePlaylist.data.body.songlist.list[0]
          if (!row) throw new Error('No public task playlist')
          call = buildWindowsPlaylistDetailCall({ loginUin: session.musicid,
            hostUin: row.creator.creator_uin, disstid: row.dissid })
        } else throw new Error('Task selector mismatch')
        const data = await probeClient.request(WINDOWS_PLAYLIST_DETAIL_REQUEST_KEY, call, { signal: invocation?.signal })
        probeDetail = { uin: session.musicid, data }
        const reference = { hostUin: call.param.host_uin.rawJSON, disstid: call.param.disstid.rawJSON }
        if (call.param.dirid) reference.dirid = call.param.dirid.rawJSON
        let mapping
        try {
          const mapped = decodeWindowsPlaylistDetail(data, {
            playlistId: createWindowsPlaylistReference(reference), sessionUin: session.musicid })
          mapping = { success: true, tracks: mapped.tracks.length, media: mapped.media.length,
            total: mapped.total, complete: mapped.complete }
        } catch {
          const songs = data.songlist ?? []
          let singleFailures = 0, invalidTracks = 0, invalidMedia = 0
          const invalidIdentityShapes = []
          const missingSizes = Object.fromEntries(['size_128mp3', 'size_320mp3', 'size_192ogg', 'size_flac'].map(k => [k, 0]))
          for (const song of songs) {
            let validTrack = false
            try { validTrack = !!mapWindowsTrack(song) } catch {}
            if (!validTrack) {
              invalidTracks++
              invalidIdentityShapes.push({ idType: typeof song.id, idIsZero: String(song.id) === '0',
                idIsPositiveSafeU32: typeof song.id === 'number' && Number.isSafeInteger(song.id) && song.id > 0 && song.id <= 0xffffffff,
                midType: typeof song.mid, midLength: typeof song.mid === 'string' ? song.mid.length : null,
                midAlphanumeric: typeof song.mid === 'string' && !/[^A-Za-z0-9]/.test(song.mid),
                mediaMidType: typeof song.file?.media_mid,
                mediaMidLength: typeof song.file?.media_mid === 'string' ? song.file.media_mid.length : null,
                titleType: typeof song.title, titleEmpty: typeof song.title === 'string' && !song.title.trim(),
                nativeType: song.type, dataType: song.data_type })
            }
            try { windowsSongMedia(song) } catch { invalidMedia++ }
            for (const k of Object.keys(missingSizes)) if (!Number.isSafeInteger(song.file?.[k]) || song.file[k] < 0) missingSizes[k]++
            try { decodeWindowsPlaylistDetail({ ...data, songlist: [song], total_song_num: 1 }, {
              playlistId: createWindowsPlaylistReference(reference), sessionUin: session.musicid }) }
            catch { singleFailures++ }
          }
          mapping = { success: false, category: 'PLAYLIST_DTO_VALIDATION', singleFailures, invalidTracks, invalidMedia, missingSizes, invalidIdentityShapes }
        }
        return { investigationOnly: true, schema: shape(data), mapping, relations: {
          code: data.code, subcode: data.subcode,
          idMatches: String(data.dirinfo?.id) === call.param.disstid.rawJSON,
          hostMatches: String(data.dirinfo?.host_uin) === call.param.host_uin.rawJSON,
          dirMatches: call.param.dirid === undefined ? null : String(data.dirinfo?.dirid) === call.param.dirid.rawJSON,
          responseHostMatchesCreatedRow: args[0] === 'task-first-directory'
            ? String(data.dirinfo?.host_uin) === String(probeLibrary.data.v_playlist[0]?.uin) : null,
          creatorMusicidMatchesSession: String(data.dirinfo?.creator?.musicid) === session.musicid,
          responseHostIsZero: String(data.dirinfo?.host_uin) === '0',
          firstDirectoryIs201: args[0] === 'task-first-directory'
            ? String(probeLibrary.data.v_playlist[0]?.dirId) === '201' : null,
          totalMatchesList: data.total_song_num === data.songlist?.length,
          dirTotalMatches: data.dirinfo?.songnum === data.total_song_num,
          returnedSongs: data.songlist?.length, reportedTotal: data.total_song_num
        } }
      },
      fetchUserLibrary: async (...args) => {
        const invocation = args.at(-1)
        if (!await probeClient.checkLogin({ signal: invocation?.signal })) throw new Error('Login required')
        const session = await probeClient.getSession()
        const data = await probeClient.request(WINDOWS_USER_PLAYLISTS_REQUEST_KEY,
          buildWindowsUserPlaylistsCall({ uin: session.musicid }), { signal: invocation?.signal })
        const favorites = await probeClient.request(WINDOWS_FAVORITE_PLAYLISTS_REQUEST_KEY,
          buildWindowsFavoritePlaylistsCall({ uin: session.musicid }), { signal: invocation?.signal })
        probeLibrary = { uin: session.musicid, data }
        return { likedPlaylist: null, playlists: [], investigationOnly: true, schema: shape(data),
          finished: data.bFinish === true, reportedTotal: data.total, favoriteSchema: shape(favorites),
          favoriteMetadata: { hasmore: favorites.hasmore, reportedCount: favorites.number,
            total: favorites.total, hidden: favorites.hide,
            returnedListContainsDeletedIds: favorites.v_list?.some(row => favorites.v_delTids?.some(id => String(id) === String(row.tid))),
            deletedRecordFlags: favorites.v_list?.filter(row => favorites.v_delTids?.some(id => String(id) === String(row.tid)))
              .map(row => ({ status: row.status, opType: row.opType, dirShow: row.dirShow, dirType: row.dirType })),
            otherRecordFlags: favorites.v_list?.filter(row => !favorites.v_delTids?.some(id => String(id) === String(row.tid)))
              .slice(0, 2).map(row => ({ status: row.status, opType: row.opType, dirShow: row.dirShow, dirType: row.dirType })) }
          , ownerRelations: { allCreatedOwnersMatchSession: data.v_playlist?.every(row => String(row.uin) === session.musicid),
            distinctCreatedOwners: new Set(data.v_playlist?.map(row => String(row.uin))).size }
        }
      }
  }
  let qualityHandler
  await activateSource({ ...context, twilight: { ...context.twilight, ui: { ...context.twilight.ui,
    onCommand: (command, handler) => {
      if (command === WINDOWS_QUALITY_COMMAND) qualityHandler = handler
      return context.twilight.ui.onCommand(command, handler)
    }
  } } })
  // The host routes commands only through declared UI contributions. Use the
  // existing quality panel's command for this explicit test-only discriminator;
  // every normal form/open/save call delegates unchanged to the source handler.
  context.twilight.ui.onCommand(WINDOWS_QUALITY_COMMAND, async payload => {
    if (payload?.taskInvestigation !== true) return qualityHandler(payload)
    if (!Object.hasOwn(probes, payload.method) || !Array.isArray(payload.args) || payload.args.length > 3) {
      throw new Error('Invalid task diagnostic request')
    }
    return probes[payload.method](...payload.args, {})
  })
}
async function catalog(searchType, args) {
  const invocation = args.at(-1)
  if (!await probeClient.checkLogin({ signal: invocation?.signal })) throw new Error('Login required')
  const query = args[0]
  if (query !== '周杰伦') throw new Error('Public diagnostic query mismatch')
  const call = buildWindowsDesktopSearchCall({ query, pageNum: 1, numPerPage: 1, searchType,
    remoteplace: 'pc.button.search.song', searchId: randomBytes(16).toString('hex').toUpperCase() + '00001' })
  const data = await probeClient.request(WINDOWS_DESKTOP_SEARCH_REQUEST_KEY, call, { signal: invocation?.signal })
  if (searchType === 3) probePlaylist = { uin: (await probeClient.getSession()).musicid, data }
  return { items: [], total: 0, investigationOnly: true, schema: shape(data) }
}
export async function deactivate() { probeClient?.close(); probeClient = null; probeLibrary = null; probePlaylist = null; probeDetail = null; await deactivateSource() }
