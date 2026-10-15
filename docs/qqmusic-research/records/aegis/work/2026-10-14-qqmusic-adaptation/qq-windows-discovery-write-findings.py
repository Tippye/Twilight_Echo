import datetime
import hashlib
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
NOW = datetime.datetime.now(datetime.timezone.utc).isoformat()


def pin(name):
    data = (BASE / name).read_bytes()
    return {'path': str(BASE / name), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def read(name):
    return json.loads((BASE / name).read_text(encoding='utf-8-sig'))


def excerpt(name, label, start, end):
    text = (BASE / name).read_text(encoding='utf-8')
    return {'source': str(BASE / name), 'label': label, 'startChar': start, 'startByte': len(text[:start].encode('utf-8')), 'endChar': end, 'text': text[start:end]}


HOME = 'qq-windows-home-musicroom.chunk.8c94a3ab5.js'
INDEX = 'qq-windows-embedded-artist-index_077e164667b177696512.js'
RUNTIME = 'qq-windows-embedded-artist-runtime.42d3fec943b9435c8a6d.js'
COMMON = 'qq-windows-embedded-artist-common_05d6a42fa95b1f315e83.js'
CATEGORY = 'qq-windows-discovery-category-47_6310a49dce36f4f651de.js'
DETAIL = 'qq-windows-discovery-detail-46_a108f7ad3f3fed083d1e.js'
REPLAY = 'qq-windows-discovery-replay.json'
replay = read(REPLAY)
assert replay['passed'] == 7 and replay['failed'] == 0
data = {
    'schema': 'qq-windows-discovery-findings-v1',
    'generatedAtUtc': NOW,
    'owner': '/root/qq_qr_resources',
    'status': 'Exact configured embedded-web discovery entry and category list builders/consumers recovered; nativect19 acceptance/DTO/identity compatibility needs Root actual sanitized probes.',
    'authority': {
        'installedArtifact': 'E:/Program Files (x86)/QQMusic/QQMusic2271.18.09.14/QQMusicResource.dll',
        'artifactSha256': 'f635b213a60fad43f46dd8c49c913904420a4f9f480be952984955ccc2186e89',
        'resource': 'JSON/2009/2052',
        'evidenceId': 'ev_a5b17e227de5bb3b46adbb1b35ee846a68a3f2d708f7fc6a23805cf0b9975ae1',
        'pipeline': 'Windows22.71 shipped musichall_v20_url -> current public wk_v20 module620/565 navigation -> exact linked wk_v17 category route -> already cached wk_v17 index/runtime/common -> precisely2 public category business assets. This is Windows-configured embedded-web behavior, not a native C++ producer or original-process runtime request.',
    },
    'entryChain': [
        'Configured https://i2.y.qq.com/n3/wk_v20/entry/index/musicroom/recommend',
        'wk_v20 module565 base route {path:/category,title:分类歌单,match:https://y.qq.com/wk_v17/#/musicroom}',
        'module565 NavLink to=((props.match?.path)||route.match)+route.path; module620 uses createElement(U.a,null,...), U=n(565), so no match override.',
        'Exact linked full URL https://y.qq.com/wk_v17/#/musicroom/category',
        'Existing wk_v17 index musicroom parent + /category componentCe -> chunk47/module441',
        'Existing runtime b.p=//y.qq.com/wk_v17/, chunk47 hash6310a49dce36f4f651de -> category asset',
        'module441 tag click SDK1.j(category,TagID,...,{source:TagType===5?1:0}); existing common module1 exportj=J.a/J=n(109), module109 category branch -> /category_detail?category_id=<tag>.',
        'Existing wk_v17 index category_detail componentit -> chunk46/module435; runtime46 hash a108f7ad3f3fed083d1e -> detail asset.',
    ],
    'assetBudget': {
        'firstScope': 'wk_v20-only existing local index/runtime/musicroom inventory; no assets fetched there.',
        'secondRootAuthorization': 'Exact linked wk_v17 category route, reuse cached index/runtime/common, at most2 new precise JS assets (category producer + direct category detail consumer).',
        'newJsLimit': 2,
        'newJsUsed': 2,
        'fetches': [read('qq-windows-discovery-category-fetch.json'), read('qq-windows-discovery-detail-fetch.json')],
        'diagnosticMistake': {'requestedUrl': 'https://y.qq.com/wk_v17/46_f3b6c373239e10c2adea.js?max_age=2592000', 'status': 404, 'cause': 'Transcribed neighboring chunk45 hash for46. No JavaScript asset returned/saved. Corrected by exact runtime regex46 key; both CSS andJS hash maps agree a108f7ad3f3fed083d1e. No generalized URL guessing/retry enumeration.'},
        'privacyBoundary': 'Public stateless GET, no CookieJar/Cookie/Authorization, default TLS, bounded2MiB, HTTPS exact y.qq.com redirect guard; no business RPC, profile, account or window.',
        'noFurtherFetches': True,
    },
    'initialDiscoveryCalls': [
        {
            'sourceModule': 441, 'module': 'music.playlist.PlaylistSquare', 'method': 'GetRecommendWhole',
            'exactParam': {'IsReqHead': False, 'IsReqFeed': True, 'FeedReq': {'From': 0, 'Size': 60}},
            'types': {'IsReqHead': 'boolean', 'IsReqFeed': 'boolean', 'FeedReq.From': 'number', 'FeedReq.Size': 'number'},
            'sourceState': 'sin0/size60; order5 exists in state but is not sent by this method. No entry scroll/paging handler or total consumer in441.',
            'recordPath': 'response[0].data.FeedRsp.List[].Playlist.basic',
            'mapping': {'picurl': 'basic.cover.medium_url -> SDK.u.fixUrl', 'creator.nick': 'basic.creator.nick', 'creator.uin': 'basic.creator.uin', 'updatetime': '1000*parseInt(basic.modify_time)', 'listeners': 'basic.play_cnt', 'id': 'basic.tid without parseInt', 'title': 'basic.title'},
            'notes': 'Source mutates and retains outer FeedRsp.List record while adding mapped public card fields. Strict adapter should choose validated DTO fields; no total/pagination or all-record playlist namespace claim from source alone.',
        },
        {
            'sourceModule': 441, 'module': 'music.playlist.PlaylistSquare', 'method': 'GetSquareTab', 'exactParam': {},
            'recordPath': 'response[1].data.List[]', 'fieldsConsumed': ['TagID', 'TagName', 'TagType'],
            'localSyntheticItem': {'TagID': 0, 'TagName': '全部', 'TagType': 0},
            'localSyntheticItemBoundary': 'Source appends UI navigation item0 after nonempty tab response; it navigates to category_tags, not a get_category_content request with category_id0.',
            'loginBoundary': 'Render suppresses TagType5 unless SDK.t.isLogin(). Tags of this type navigate with source1 (AI category service). Other tags navigate with source0. Do not merge login-dependent AI branch into anonymous ordinary list.',
        },
    ],
    'categoryNavigation': {
        'normalTag': 'SDK1.j(category,record.TagID,empty,empty,empty,empty,{source:record.TagType===5?1:0})',
        'knownAllTag0': 'SDK1.j(category_tags)',
        'officialMore': 'wk_v20 module620 SDK490.i(category,3317), mirrored cached wk_v17 index R.j(category,3317). Literal3317 is a navigation argument, not a recovered named category enum.',
        'commonModule109': 'category -> /category_detail?category_id=<ID>; u/l add from/ext/source metadata to URL then native togglePage. Only category route literals were inspected; unrelated open/login cookie branches not executed.',
    },
    'ordinaryCategory': {
        'source': 'module435 source0/default branch',
        'constructor': {'categoryId': 'parseInt(query.category_id ||query.id ||3204)', 'titleId': 'parseInt(query.titleid ||categoryId)', 'source': 'parseInt(query.source,10)||0', 'size': 60, 'order': 5, 'last_id': '', 'page': 0},
        'constructorBoundaries': 'Default3204 is a source literal only; no named All/hot semantic or native UInt32 enum proof. JS parseInt on query input is not strict type/range validation; production caller must validate explicit category references.',
        'initialContent': {
            'module': 'playlist.PlayListCategoryServer', 'method': 'get_category_content',
            'paramExpression': {'caller': 'SDK.t.getUin()||string0', 'category_id': 'categoryId(number)', 'page': 0, 'use_page': 1, 'size': 60},
            'paramTypes': {'caller': 'SDK current UIN or string0 fallback', 'category_id': 'number', 'page': 'number', 'use_page': 'number', 'size': 'number'},
        },
        'initialBasic': {
            'module': 'playlist.PlayListCategoryServer', 'method': 'get_category_basic',
            'paramExpression': {'caller': 'SDK.t.getUin()||number0', 'category_id': 'parseInt(titleId)'},
            'callerTypeBoundary': 'The source fallback is number0 here, whereas initialContent/cursor fallback is string0. This difference is preserved rather than silently normalized.',
        },
        'cursorContent': {
            'module': 'playlist.PlayListCategoryServer', 'method': 'get_category_content',
            'paramExpression': {'last_id': 'last returned basic.tid.toString()', 'size': 60, 'order': 5, 'is_parent': 0, 'caller': 'SDK.t.getUin()||string0', 'titleid': 'titleId(number)', 'category_id': 'categoryId(number)'},
            'omitted': ['page', 'use_page'],
            'orderBoundary': 'Default order5 is transmitted by cursor builder, with no source label/sort-control explaining it in435. Do not give it a guessed hot/new name.',
        },
        'responseConsumer': {
            'contentRecords': 'response[0].data.content.v_item[].basic',
            'mapping': {'picurlInitial': 'cover.medium_url ||cover.default_url -> SDK.u.fixUrl', 'picurlCursor': 'cover.medium_url ||cover.default_url ||cover.big_url ||cover.pic_url2 -> SDK.u.fixUrl', 'creator.nick': 'creator.nick', 'creator.uin': 'creator.encrypt_uin', 'updatetime': '1000*parseInt(create_time)', 'listeners': 'play_cnt', 'id': 'tid unchanged', 'title': 'title'},
            'total': 'data.content.total_cnt',
            'endPredicate': '(existing playlist length + returned item count)>=total_cnt',
            'cursor': 'last mapped item id.toString(); increment local page counter; scroll appends and stops when end predicate true or an empty page occurs.',
            'basicRecords': 'response[1].data.category',
            'basicFields': ['v_child[].id', 'v_child[].name', 'v_child[].tag', 'desc', 'name'],
        },
    },
    'aiCategorySeparateBranch': {
        'predicate': 'query source===1, introduced by known TagType5 UI navigation',
        'module': 'music.playlist.AiPlCategory', 'method': 'get_ai_category_content', 'size': 12,
        'initial': 'Same page0/use_page1 content fields, size12; get_category_basic remains ordinary PlayListCategoryServer with titleId.',
        'cursor': 'Same cursor fields, size12 plus use_page0.',
        'authorityBoundary': 'A login-gated embedded-web branch, not evidence of anonymous availability or native rights acceptance. Root ordinary discovery scope should not accidentally switch to it.',
    },
    'identityAndTransportBoundaries': [
        'Discovery FeedRsp basic.creator.uin and category-detail basic.creator.encrypt_uin are different source fields. Neither mapping alone proves lossless native GetDetail hostUin compatibility or authorizes owner0 substitution.',
        'Source preserves basic.tid without numeric conversion; public replay verifies a beyond-MAX_SAFE_INTEGER decimal string remains exact. Actual nativect19 server DTO may be number/string and requires lossless validation.',
        'Configured embedded-web requests use SDK1.s (cached transport export module48/79); this is not a native C++ request proof or nativect19 default comm/header/signing guarantee. Root must probe actual native transport independently.',
        'Source uses loose0==code and partial setState/loaded behavior; production strict decoder/error policy should not silently expose malformed or failed records.',
        'Source playAll calls separate get_category_playtrack/get_ai_category_playtrack then playSong; these were read statically but deliberately excluded from read-only list integration and isolated execution.',
        'Pagination termination and cursor demonstrated for synthetic public valid responses; server cursor stability/accepted enum/ranges/total semantics remain actual-probe scope.',
    ],
    'nextPointedMissingConsumer': {
        'route': 'https://y.qq.com/wk_v17/#/category_tags', 'purpose': 'Known UI All0 entry; full categories screen, not same as GetSquareTab abbreviated tabs.',
        'cachedIndex': 'st loader n.e(48).then(n.bind(null,436))',
        'cachedRuntime': 'chunk48 hash c239a904d5fd430ccb28',
        'exactJsUrl': 'https://y.qq.com/wk_v17/48_c239a904d5fd430ccb28.js?max_age=2592000',
        'status': 'Not fetched under current2-new-JS cap; no GetPlaylistTag/PlazaPage or full-tag response contract claim.',
    },
    'isolatedReplay': {'path': str(BASE / REPLAY), 'passed': replay['passed'], 'failed': replay['failed'], 'scope': replay['scope'], 'fragments': replay['fragments'], 'limits': replay['limits']},
    'boundedSourceEvidence': [
        excerpt(HOME, 'wk_v20 navigation component565 -> exact linked category page', 13700, 15600),
        excerpt(HOME, 'wk_v20 module620 layout565 no match override and official more literal3317', 154600, 156130),
        excerpt(INDEX, 'wk_v17 category componentCe -> chunk47/module441', 28079, 28615),
        excerpt(INDEX, 'wk_v17 musicroom parent and category route', 29000, 30000),
        excerpt(INDEX, 'wk_v17 category_detail46/435 and All48/436 loader', 37210, 37900),
        excerpt(COMMON, 'Existing common1 exportj delegates navigation to109', 11080, 11200),
        excerpt(COMMON, 'Existing common109 exact category/category_tags switch only', 44260, 44480),
    ],
    'sourcePins': [pin(name) for name in [
        'qq-qr-resources-pe-json-2009.json', 'qq-windows-home-index.chunk.20f80323e.js',
        'qq-windows-home-runtime.d807a2801c869ee2f901.bundle.js', HOME, INDEX, RUNTIME, COMMON,
        CATEGORY, DETAIL, 'qq-windows-discovery-category-fetch.json', 'qq-windows-discovery-detail-fetch.json',
        'qq-windows-discovery-replay.mjs', REPLAY,
    ]],
    'productionChanges': [], 'prohibitedOperationsPerformed': False,
    'unknown': ['Actual nativect19 acceptance and response DTO schema for all recovered discovery/category requests.', 'Full-tag provider contract behind unacquired category_tags module436.', 'Actual lossless native playlist creator-host/tid compatibility for both source response variants.', 'Native enum meaning for numeric order5/category default3204/official-more3317.'],
}
output = (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
(BASE / 'qq-windows-discovery-findings.json').write_bytes(output)
print(json.dumps({'findingsSha256': hashlib.sha256(output).hexdigest(), 'sourcePins': len(data['sourcePins']), 'replayPassed': replay['passed'], 'newJsUsed': 2}))
