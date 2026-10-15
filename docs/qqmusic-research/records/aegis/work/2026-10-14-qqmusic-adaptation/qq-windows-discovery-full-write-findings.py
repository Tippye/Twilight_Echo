import datetime
import hashlib
import json
from collections import Counter
from pathlib import Path

BASE = Path(__file__).resolve().parent


def read(name):
    return json.loads((BASE / name).read_text(encoding='utf-8-sig'))


def pin(name):
    file = BASE / name
    data = file.read_bytes()
    return {'path': str(file), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


fetch = read('qq-windows-discovery-full-fetch.json')
replay = read('qq-windows-discovery-full-replay.json')
actual = read('qq-discovery-real-full-taxonomy.json')
actual_snapshot = BASE / 'qq-windows-discovery-full-root-schema-snapshot.json'
actual_snapshot.write_bytes((BASE / 'qq-discovery-real-full-taxonomy.json').read_bytes())
assert fetch['scopeNewJsUsed'] == fetch['scopeNewJsLimit'] == 1
assert fetch['sha256'] == '9048ce89e17d460ed38f27bdc2b20904e7cfba3b651f491b3728ff3342d7f93f'
assert replay['passed'] == 5 and replay['failed'] == 0
rows = [row for group in actual['groups'] for row in group['rows']]
counts = Counter(row['source'] for row in rows)
assert set(counts) <= {0, 1}
assert all(row['tagType'] == 'undefined' and row['tagTruthy'] is False for row in rows)
duplicates = [(group['name'], row['id'], row['source']) for group in actual['groups'] for row in group['rows'] if row['name'] == '私藏']
assert ('最近常用', 3419, 0) in duplicates and ('热门', 3417, 0) in duplicates
data = {
    'schema': 'qq-windows-discovery-full-taxonomy-findings-v1',
    'generatedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'owner': '/root/qq_qr_resources',
    'status': 'Exact configured embedded-web full taxonomy request/consumer and Root actual native-ct19 shape/duplicate-label evidence recovered; no further assets or production implementation.',
    'sourceAuthority': {
        'pipeline': 'Windows22.71 shipped Resource musichall_v20_url -> current wk_v20 musicroom module565 category navigation -> wk_v17 index category entry441 -> All0 category_tags -> cachedindex st loads48/module436 -> exact public businessasset.',
        'artifact': 'E:/Program Files (x86)/QQMusic/QQMusic2271.18.09.14/QQMusicResource.dll',
        'artifactSha256': 'f635b213a60fad43f46dd8c49c913904420a4f9f480be952984955ccc2186e89',
        'resource': 'JSON/2009/2052',
        'resourceEvidenceId': 'ev_a5b17e227de5bb3b46adbb1b35ee846a68a3f2d708f7fc6a23805cf0b9975ae1',
        'cachedLoader': 'wk_v17 index st=k()({loader:()=>n.e(48).then(n.bind(null,436))}); route /category_tags.',
        'cachedRuntime': 'b.p=//y.qq.com/wk_v17/;48:c239a904d5fd430ccb28.',
        'sourceKind': 'Windows-configured embedded-web static source, not a recovered native C++ GetAllTag producer/enum.',
    },
    'assetBudget': {'rootAuthorization': 'New separate scope: exactly this one Full Category asset, no further dependencies.', 'newJsUsed': 1, 'newJsLimit': 1, 'fetch': fetch, 'furtherAssetsFetched': False},
    'exactRequest': {'module': 'music.playlist.PlaylistSquare', 'method': 'GetAllTag', 'param': {'qq': ''}, 'paramTypes': {'qq': 'empty string literal'}, 'sourceModule': 436, 'boundary': 'Empty qq is source literal, not copied account UIN. Caller native transport/auth remains Root own-session adapter compatibility, not SDK browser defaults.'},
    'sourceConsumer': {
        'successCondition': 'No transport error; response[0] exists,0==code,data.v_group nonempty.',
        'recordPath': 'data.v_group[] -> group.group_name + group.v_item[]',
        'fieldsRead': ['group_name', 'v_item[].id', 'v_item[].name', 'v_item[].source', 'v_item[].tag'],
        'groupIdentity': 'Rendering key uses group array index. Source does not read group_id, parent ID or hierarchy relationships.',
        'anonymousFilter': 'SDK.t.isLogin() false causes strict item.source===0 filter. Missing source and string0 do not pass this anonymous filter.',
        'authenticatedFilter': 'Logged-in branch leaves all source values visible; does not itself establish business acceptance of AI source1 service.',
        'ordinaryAndAiNavigation': 'Truthy item.id -> /category_detail?id=<id>&source=<source default0 when undefined>; source1 constructor435 selectsAiPlCategory service, while ordinarysource0 selectsPlayListCategoryServer.',
        'placeholderBoundary': 'Renderer mutates v_item and pads to multiple6 with{name:emptystring}. These have no ID and route back/category_tags. Generated layout placeholders must never enter canonical taxonomy; do not copy in-place filtering/padding into provider.',
        'tagDecoration': 'Truthy item.tag inserts an icon element containing the tag text. No hot field, hot boolean conversion or label value is established by this function.',
        'emptyErrorBehavior': 'No manufactured taxonomy on empty/nonzero/transport-error; source keeps tags null. Strict provider error handling is a separate production policy.',
    },
    'actualRootNativeCt19Evidence': {
        'authority': 'Root direct own-session GetAllTag accepted; qq-discovery-real-full-taxonomy.json copied byte-for-byte into the reviewer evidence snapshot. Reviewer only read Root sanitized public taxonomy metadata; no RPC/account/profile/window.',
        'snapshot': pin(actual_snapshot.name),
        'originalRootArtifact': str(BASE / 'qq-discovery-real-full-taxonomy.json'),
        'storedFileNote': 'Acceptance is reported by trusted Root task message; file stores investigationOnly/schema/groups rather than an accepted field.',
        'groups': len(actual['groups']), 'rawRowCount': len(rows), 'sourceCounts': dict(counts),
        'groupId': 'Actual schema has group_id:number; saved group summaries store idType only. Values/provided-ID/uniqueness relation pending Root followup.',
        'schemaDifference': 'Actual group has group_id/group_name/group_color/group_pos/group_icon; item schema includes id/name/cover/type/tjreport/status/source. Decorative tag field is absent/undefined for every saved actual row.',
        'sourceEnumObservation': 'Only0/1 observed; production current ordinaryPC0 scope excludes source1 explicitly. Source1 service/rights/DTO is not proven by displaying a taxonomy row.',
        'noServerHotFieldProof': 'Every actual tagType isundefined/tagTruthyfalse. Hot classification may be derived from actual known group_name热门 as an explicit adapter membership policy, not from tag or a recovered serverhot boolean.',
    },
    'sdkNameOnlyDisambiguation': {
        'authority': 'Current SDK fetchPlaylistCategories tags{name,hot}, fetchDiscoveryPlaylists(cat:string,...) and renderer selectTag passes only name; group/row IDs are not provided as separate selection params.',
        'confirmedPublicDuplicate': [
            {'group': '最近常用', 'name': '私藏', 'id': 3419, 'source': 0, 'displayLabel': '私藏（最近常用）'},
            {'group': '热门', 'name': '私藏', 'id': 3417, 'source': 0, 'displayLabel': '私藏（热门）'},
        ],
        'requiredPolicy': 'Construct unique visible labels for distinct(id,source) bindings sharing a name; use group suffix for this proven duplicate. Store exact displayLabel->verifiedid/source map in memory. Neverfirstwins/lastwins or resolve raw私藏 ambiguously. Reject any residual label collision rather than misroute.',
        'hotMembershipPolicy': 'If SDK hotTags/tags.hot uses actual known热门 group membership, mark it as adapter presentation derived from group label, not source item.tag/hotbool/ranking proof. Apply the same disambiguated labels to rail and groups.',
        'groupIdPolicy': 'Prefer validated actual group_id values after Root verifies uniqueness/type; source only proves group labels and indexkey. Any SDK display-index fallback must be named adapter policy and must not claim native group enum semantics.',
        'allBoundary': 'Existing SDK全部 is an unfiltered-discovery choice; source All0 navigates taxonomy screen. Do not invent get_category_content(category_id0) or relabel source constructordefault3204 asAll.',
    },
    'isolatedPublicReplay': {'path': str(BASE / 'qq-windows-discovery-full-replay.json'), 'passed': 5, 'failed': 0, 'scope': replay['scope'], 'fragments': replay['fragments'], 'limits': replay['limits']},
    'sourcePins': [pin(name) for name in ['qq-qr-resources-pe-json-2009.json', 'qq-windows-home-musicroom.chunk.8c94a3ab5.js', 'qq-windows-embedded-artist-index_077e164667b177696512.js', 'qq-windows-embedded-artist-runtime.42d3fec943b9435c8a6d.js', 'qq-windows-discovery-category-47_6310a49dce36f4f651de.js', 'qq-windows-discovery-full-48_c239a904d5fd430ccb28.js', 'qq-windows-discovery-full-fetch.json', 'qq-windows-discovery-full-replay.mjs', 'qq-windows-discovery-full-replay.json', actual_snapshot.name]],
    'unknown': ['Actual provided group_id values/uniqueness relation pending Root followup.', 'AI source1 content/canonicalidentity/rights availability remains outside proven ordinaryPC0 adapter.', 'item.tag label/hot/ranking semantics unproven and actual field absent.', 'Underlying browser SDK transport/default auth and native C++ producer/enum not recovered.'],
    'productionChanges': [], 'gitOperations': [], 'businessRpcCallsByReviewer': 0,
}
output = (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
(BASE / 'qq-windows-discovery-full-findings.json').write_bytes(output)
print(json.dumps({'receiptSha256': hashlib.sha256(output).hexdigest(), 'sourcePins': len(data['sourcePins']), 'replayPassed': 5, 'actualGroups': len(actual['groups']), 'actualRows': len(rows), 'actualSourceCounts': dict(counts)}, ensure_ascii=True))
