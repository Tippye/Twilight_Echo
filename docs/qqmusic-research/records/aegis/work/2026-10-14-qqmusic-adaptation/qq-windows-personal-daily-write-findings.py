import datetime
import hashlib
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
NOW = datetime.datetime.now(datetime.timezone.utc).isoformat()


def read_json(name):
    return json.loads((BASE / name).read_text(encoding='utf-8-sig'))


def pin(name):
    data = (BASE / name).read_bytes()
    return {'path': str(BASE / name), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def write(name, value):
    data = (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    (BASE / name).write_bytes(data)
    return hashlib.sha256(data).hexdigest()


assets = [
    'qq-windows-personal-recommend.chunk.498dd3a28.js',
    'qq-windows-personal-shared-chunk13.26bd9e519.js',
]
replay = read_json('qq-windows-personal-daily-replay.json')
real_shape = read_json('qq-daily-real-response-shapes.json')
native_checks = read_json('qq-daily-real-known-selector-checks.json')
native_detail = read_json('qq-daily-native-variant-real-detail.json')
assert native_checks['feedAccepted'] is True and native_checks['feedRetcode'] == 0
assert native_checks['privateValuesPersisted'] is False
assert len(native_checks['shelfSummary']) == 8
assert all(s['shelfKind'] != 301 for s in native_checks['shelfSummary'])
native_daily = [s for s in native_checks['shelfSummary'] if s['shelfKind'] == 201 and s['firstNicheExactDailyTitle'] is True]
assert len(native_daily) == 1 and native_daily[0]['firstNicheCards'] == 4
assert native_detail['privateValuesPersisted'] is False
assert native_detail['dailyCardFound'] is True and native_detail['selectorShelfKind'] == 201
assert native_detail['detail']['accepted'] is True
assert all(native_detail['detail'][name] == 30 for name in ['rawSongs', 'total', 'strictMappingCount'])
assert native_detail['detail']['responseIdMatches'] is True
assert native_detail['detail']['nativeCode'] == native_detail['detail']['nativeSubcode'] == 0
home = read_json('qq-windows-home-configured-public-findings.json')
findings = {
    'schema': 'qq-windows-personal-daily-findings-v1',
    'generatedAtUtc': NOW,
    'owner': '/root/qq_qr_resources',
    'status': 'configured embedded-web source301 preserved; directly observed native-ct19 adapter201 plus exact known Daily title and configured aiDiss30 strict records verified by Root own-session sanitized evidence',
    'authority': {
        **home['authority'],
        'pipeline': 'Windows22.71 shipped recommend_v20_url -> cached current index/runtime locators -> current public module609 + directly shared module544. Embedded-web static source, not a native C++ producer or original process runtime request.',
    },
    'configuredUrl': 'https://i2.y.qq.com/n3/wk_v20/entry/index/recommend',
    'routeConsumerChain': [
        'Resource JSON/2009/2052 recommend_v20_url -> /n3/wk_v20/entry/index/recommend',
        'Cached index route suffix recommend -> chunk31/module609; loader also declares shared chunk13',
        'Cached runtime publicPath //y.qq.com/n3/wk_v20/entry// -> recommend.chunk.498dd3a28.js',
        'module609 Ht/getInitialProps -> m(1,0) -> RecommendFeed -> {firstTabData:{data,reqUin}}',
        'module609 onPlayDaily30 -> exact number301 shelf / first niche / known daily title -> playPlayList -> v(card.id,card)',
    ],
    'assetBudget': {
        'rootAuthorization': 'This separate scope permits exactly1 configured recommend business asset +1 necessary directly pointed shared consumer; no further dependencies.',
        'newJsLimit': 2,
        'newJsUsed': 2,
        'urls': [
            'https://y.qq.com/n3/wk_v20/entry//recommend.chunk.498dd3a28.js?max_age=6048000',
            'https://y.qq.com/n3/wk_v20/entry//common~musicroom~recommend~voice~748942c6.chunk.26bd9e519.js?max_age=6048000',
        ],
        'sharedSelectionProof': 'Both index loaders for620 and609 declare chunk13; both consumers import missing module544; runtime maps13 to joint common~musicroom~recommend~voice name/hash. Actual fetched chunk13 contains544.',
        'fetchBoundary': 'Stateless public GET, no CookieJar/Cookie/Authorization/account/profile; TLS default, redirects restricted to HTTPS official exact origin; no business RPC. No further asset fetches.',
    },
    'feedRequest': {
        'module': 'music.recommend.RecommendFeed',
        'method': 'get_recommend_feed',
        'initialExactParam': {'direction': 0, 'page': 1, 'v_cache': [], 'v_uniq': [], 's_num': 0},
        'types': {'direction': 'number', 'page': 'number', 'v_cache': 'array', 'v_uniq': 'array', 's_num': 'number'},
        'defaultProof': 'm forwards its second argument directly as s_num with no initializer/default. Ht calls m(1,0); direction is 1===page ?0:1.',
        'pagination': 'Constructor page2; getTabData passes current page and existing v_shelf.length||0 as s_num, appends shelves, advances/reloads while load_mark===0. Initial RPC probe does not need this auto-loop.',
        'responseConsumer': 'response[0].data.v_shelf[]; returns {data:mutatedFeed,reqUin:SDK.q.getUin()}',
        'reqUinBoundary': 'Account-bound diagnostic/context output, not an ID or generic library field; never persisted/logged by this scope.',
    },
    'shelfEnum': {'SongMenu': 205, 'Banner': 206, 'RecommendSongs': 207, 'DoubleRowSongMenu': 271, 'RecommendRadio': 272, 'PersonalRadio': 301},
    'dailySelector': {
        'sourceModule': 609,
        'exactPredicate': "shelf.id===301 (number); shelf.v_niche[0].v_card.find(card=>card.title==='每日30首')",
        'knownSourceLabel': '每日30首',
        'action': 'Only found card calls playPlayList(card), which calls v(card.id,card).',
        'noFallback': 'No string301 coercion, other shelf, later niche, card position, renamed title or guessed enum fallback is established.',
        'readOnlyBoundary': 'playPlayList then invokes native playSong; provider read-only list adapter must stop after data.songlist and must not execute source playback/reporting.',
    },
    'dailyListRequest': {
        'module': 'music.srfDissInfo.aiDissInfo',
        'method': 'uniform_get_Dissinfo',
        'paramExpression': {'disstid': 'parseInt(card.id,10)', 'userinfo': 1, 'tag': 1, 'guid': 'SDK.r.getGuid()'},
        'types': {'disstid': 'number (JS parseInt result)', 'userinfo': 'number', 'tag': 'number', 'guid': 'source SDK device value, implementation not expanded'},
        'responseConsumer': 'response[0].data.songlist -> SDK.h.formatMusic(songlist,{ext:JSON.stringify(card.extra_info)})',
        'identityBoundary': 'No native hostUin field is supplied in module609 v. JS parseInt does not establish lossless uint64 support; valid ID namespace/server DTO requires actual resolver verification. Do not manufacture host0.',
    },
    'songShelfHydration': {
        'source': 'module609 p -> module512 exportc, both present in existing fetched recommend asset',
        'selection': 'Only shelf207 first3 niches; gather card.id via parseInt(card.id,10) and card.type; replace card with hydrated track by ID, add ext from extra_info, remove missing tracks.',
        'module': 'music.trackInfo.UniformRuleCtrl',
        'method': 'CgiGetTrackInfo',
        'paramExpression': {'ids': 'numeric parsed IDs[]', 'types': 'card.type[]', 'source': 'AiNoFree'},
        'responseConsumer': 'response[0].data.tracks ||[] -> SDK.h.formatMusic; source local catch returns[].',
        'boundary': 'Type meaning, DTO/native canonical identity and actual business availability remain separate from this embedded-web static builder.',
    },
    'officialGridSharedConsumer': {
        'sourceModule': 544,
        'module620Use': 'he.render passes officialPlaylist (s[1].data.modules[0].grids) to module544 exportb; no aiPlayList or enUin props established by this call.',
        'module609Use': 'SongMenu205/DoubleRowSongMenu271 cards -> module544 exportb, configuration name:true,user:false,listen:true,webview12.',
        'playBranchesInOrder': [
            {'predicate': 'props.aiPlayList truthy', 'module': 'IntelligentTagServer', 'method': 'IntelligentTagSongInfo', 'paramExpression': {'onlyAi': 1, 'tagids': '[record.tagid]'}, 'recordPath': 'response[0].data.songInfo[0].info'},
            {'predicate': 'record.song truthy', 'module': 'music.pf_song_detail_svr', 'method': 'get_song_detail', 'paramExpression': {'song_id': '+record.subid'}, 'recordPath': 'response[0].data.track_info'},
            {'predicate': 'otherwise', 'module': 'music.srfDissInfo.aiDissInfo', 'method': 'uniform_get_Dissinfo', 'paramExpression': {'disstid': 'parseInt(record.id)', 'userinfo': 1, 'tag': 1, 'enc_host_uin': 'props.enUin||empty string', 'guid': 'module240.a.getGuid()'}, 'recordPath': 'response[0].data.songlist'},
        ],
        'navigation': 'record.song -> SDK.i(song,{songid:record.subid,songtypes:this.songtypes},...); otherwise explicit props.jumpFun or SDK.i(playlist,record.id||record.tagid,record.title,props.aiPlayList,record.extra_info,props.from,{hostuin:props.enUin||empty string}).',
        'creatorUin': 'Used only by creator-profile click. It is not passed as ordinary Dissinfo enc_host_uin or playlist navigation hostuin by544. Native GetDetail host compatibility needs separate actual response/probe authority.',
        'numericEnumBoundary': 'No branch interprets record.type/source_type/recomm_type/jmpurl/strjumpurl. isVip triggers reporting, not a playlist kind selector. Widget default branch behavior alone does not prove all raw grids are safe canonical playlists or that creator.uin equals native detail host.',
        'actualRootProvidedHomeVariant': {
            'authority': 'Root own-session sanitized shape/enum report; this agent did not invoke RPC or read account values.',
            'accepted': True,
            'gridsLength': 12,
            'modulesLength': 0,
            'fieldTypes': {'creator.uin': 'decimal string', 'creator.nick': 'string', 'id': 'number (Root reports safe)', 'title': 'string', 'picurl': 'string', 'type': 'number', 'recomm_type': 'number', 'source_type': 'number', 'jmpurl': 'string'},
            'safeProtocolEnumObservations': {'type': [10014], 'source_type': [2, 3, 5], 'recomm_type': [0], 'view': [0]},
            'jmpurlRootObservation': 'invalid or blank, no navigable raw-card identity recovered',
            'variantBoundary': 'Root native-comm request result uses bare data.grids with modules empty; source620 assumes data.modules[0].grids. This does not establish complete equivalence to web default transport/comm contract.',
        },
    },
    'actualDailyResponseBoundary': {
        'authority': 'Root own-session sanitized qq-daily-real-response-shapes.json; no private values persisted or inspected by this agent.',
        'observedUtc': real_shape['observedUtc'],
        'feedAccepted': real_shape['feedAccepted'],
        'vShelfLength': real_shape['feedSchema']['v_shelf']['length'],
        'sampleShelfIdType': real_shape['feedSchema']['v_shelf']['samples'][0]['id'],
        'sampleCardIdType': real_shape['feedSchema']['v_shelf']['samples'][0]['v_niche']['samples'][0]['v_card']['samples'][0]['id'],
        'dailyCardFound': real_shape['dailyCardFound'],
        'conclusion': 'This original observation does not satisfy the embedded source selector301. It is preserved unchanged as historical false301 evidence; the later native-ct19 adapter variant is recorded separately below, without rewriting source constants.',
    },
    'nativeCt19AdapterResponseVariant': {
        'authority': 'Root own-session bounded direct observation; source is qq-daily-real-known-selector-checks.json, shapes/safe protocol enums/known-title comparison booleans only.',
        'observedUtc': native_checks['observedUtc'],
        'feedAccepted': native_checks['feedAccepted'],
        'feedRetcode': native_checks['feedRetcode'],
        'shelfCount': len(native_checks['shelfSummary']),
        'shelf301Present': False,
        'safeShelfSummary': native_checks['shelfSummary'],
        'explicitAdapterPredicate': "Under verified native ct19 feed only: shelf.id===201 (number); first niche card.title==='每日30首'. Do not use a general301-to-any-shelf fallback.",
        'candidateEvidence': 'Exactly one observed201 shelf has4 first-niche cards and an exact known-title match; observed204/203 shelf cards do not match this title. Source original301 selector still returnsfalse.',
        'domainBoundary': '201 here is a recommendation-feed shelf kind, not liked-playlist directory201. This is an actual response variant plus explicit adapter choice, not a recovered native C++ enum or a mutation of embedded-web enum301.',
        'leafQualification': {
            'authority': 'Root direct own-session configured aiDiss request with selected card disstid and current verified GUID; qq-daily-native-variant-real-detail.json stores shapes/counts/codes/identity booleans only.',
            'observedUtc': native_detail['observedUtc'],
            'accepted': native_detail['detail']['accepted'],
            'nativeCode': native_detail['detail']['nativeCode'],
            'nativeSubcode': native_detail['detail']['nativeSubcode'],
            'rawSongs': native_detail['detail']['rawSongs'],
            'total': native_detail['detail']['total'],
            'strictMappingCount': native_detail['detail']['strictMappingCount'],
            'responseIdMatches': native_detail['detail']['responseIdMatches'],
            'result': 'Read-only Daily leaf qualification closed for explicit native-ct19 response variant. Original embedded-web source301 and original false301 observation remain separate. This does not establish a native C++ enum or playback of these30 tracks.',
            'privacy': 'This agent did not invoke RPC, read private card/disstid/GUID values, or access account/profile/window.',
        },
    },
    'sdkBoundary': 'Current provider SDK has fetchRecommendSongs(context?)->Track[] and fetchRecommendPlaylists->PlaylistSummary[]; ui.streamingSections requires Track[]. No getHomeSections/fetchHomeSection/fetchDailySongs methods. Root explicitly adapts newsong type5 as latest-release song preview first20; this source finding must not silently relabel that as daily or add unsupported generic SDK methods.',
    'sourceErrorAndLifetimeLimits': [
        'SDK490 transport/comm/header/auth/signing implementations not expanded under2-asset cap; do not inherit wk_v17, Android or nativeCPP defaults.',
        'm consumes data without first checking inner business code; transport catch invokes showWebErrorTips1 and resolvesundefined. Strict production error handling remains caller responsibility.',
        'v wraps a promise and silently catches malformed songlist/format errors without settling; transport rejection also lacks reject handling. Do not copy this hanging behavior into provider.',
        'Empty-Mac-feed diagnostic source reads document.cookie; no entire module execution or cookie/diagnostic path was performed. Inert PC fixture disables it and forbids cookie getter.',
        'Request/card output may carry extra_info, trace, AB/reporting/accountcontext. These are not provider persisted identity or authority fields.',
    ],
    'isolatedReplay': {'path': str(BASE / 'qq-windows-personal-daily-replay.json'), 'passed': replay['passed'], 'failed': replay['failed'], 'scope': replay['scope'], 'fragments': replay['fragments'], 'limits': replay['limits']},
    'independentReview': {
        'reviewer': '/root/qq_packaged_resources',
        'method': 'Read existing public raw JS only, no new query/network/production/Git.',
        'result': 'Confirms strict number301/firstniche/known-title, initialm(1,0),620modules0grids,first20albumconverter and544hostfromprops; creator.uin profile-only. No alternateDailyenum or currentavailability inference.',
        'receipt': pin('qq-home-personal-independent-source-contract-v1.json'),
        'sourceLocators': {'dailySelector': {'char': 81627, 'byte': 81998}, 'initialHt': {'char': 80721, 'byte': 81092}, 'sharedPlay': {'char': 44061, 'byte': 44144}, 'sharedJump': {'char': 45659, 'byte': 45770}, 'creatorProfile': {'char': 46492, 'byte': 46603}},
    },
    'sourcePins': [pin(name) for name in [
        'qq-qr-resources-pe-json-2009.json',
        'qq-windows-home-index.chunk.20f80323e.js',
        'qq-windows-home-runtime.d807a2801c869ee2f901.bundle.js',
        *assets,
        'qq-windows-personal-recommend-consumer-extracts.json',
        'qq-windows-personal-module544-consumer-extracts.json',
        'qq-windows-personal-daily-replay.mjs',
        'qq-windows-personal-daily-replay.json',
        'qq-daily-real-response-shapes.json',
        'qq-daily-real-known-selector-checks.json',
        'qq-daily-native-variant-real-detail.json',
    ]],
    'prohibitedOperationsPerformed': False,
    'productionChanges': [],
    'unknown': [
        'Reason for embedded-web301 vs actual native-ct19 response201 mismatch; no C++ enum derivation or web transport defaults established.',
        'Raw official grid numeric kind semantics and lossless native canonical owner/tid compatibility.',
        'SDK490 wire/auth/comm defaults and module240 GUID implementation.',
        'Daily track playback/rights availability is not established by accepted30-record strict mapping alone.',
    ],
}
daily_sha = write('qq-windows-personal-daily-findings.json', findings)
home['status'] = 'homepage public consumer recovered; root observed native-comm response variant; daily embedded-source301 and direct native-ct19 adapter201 kept distinct with Root actual30-record leaf qualification'
home['generatedAtUtc'] = NOW
home['assetBudget']['scope'] = 'Historical initial home investigation scope only; later independent2-asset authorization is recorded in supplementAssetScope.'
home['assetBudget']['noFurtherAssetsFetchedInOriginalScope'] = home['assetBudget'].pop('noFurtherAssetsFetched', True)
home['assetBudget']['additionalRootAuthorization'] = 'Initial home scope allowed exactly1 business chunk28 asset, total3. Shared dependencies were not fetched in that original scope.'
home['requestAndConsumerContracts'][1]['sdkReadOnlyCandidate'] = 'Existing fetchRecommendPlaylists->PlaylistSummary[] candidate. module544 has ordinary Dissinfo/playlist widget branch, but no numeric type/source_type/recomm_type semantics or native creator-host proof. Root real data.grids12/modules[]0 variant requires strict explicit adapter and independent native detail compatibility verification; no owner0 guess.'
home['requestAndConsumerContracts'][1]['responseVariant'] = findings['officialGridSharedConsumer']['actualRootProvidedHomeVariant']
home['requestAndConsumerContracts'][1]['sharedConsumer'] = findings['officialGridSharedConsumer']
home['requestAndConsumerContracts'][2]['sdkReadOnlyCandidate'] = 'Public source Y builds album cards from first20 rows. Root real accepted data.songlist43 independently supports fullSongInfo strict map43; Root explicitly chooses latest-release song preview first20 via existing fetchRecommendSongs->Track[]. This is an adapter choice; no Daily or web album-to-Track equivalence claim.'
home['dailyRecommendation'] = {'status': 'embedded-source301 misses; direct observed native-ct19 adapter201 plus exact known title has actual30-record read-only qualification', 'findingsPath': str(BASE / 'qq-windows-personal-daily-findings.json'), 'findingsSha256': daily_sha, 'initialParam': findings['feedRequest']['initialExactParam'], 'embeddedSourceSelector': findings['dailySelector']['exactPredicate'], 'originalFalse301Boundary': findings['actualDailyResponseBoundary'], 'nativeCt19AdapterResponseVariant': findings['nativeCt19AdapterResponseVariant']}
home['sdkMappingBoundary'] = findings['sdkBoundary']
home['supplementAssetScope'] = findings['assetBudget']
home_sha = write('qq-windows-home-configured-public-findings.json', home)
print(json.dumps({'dailyFindingsSha256': daily_sha, 'homeFindingsSha256': home_sha, 'mockReplayPassed': replay['passed']}, ensure_ascii=True))
