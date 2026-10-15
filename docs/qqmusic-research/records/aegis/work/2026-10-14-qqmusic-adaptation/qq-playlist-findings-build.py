"""Record bounded native playlist findings and pure-builder verification."""
import hashlib,json
from pathlib import Path
WORK=Path(__file__).resolve().parent
ROOT=WORK.parents[3]
PLUGIN=ROOT/'Twilight-Echo-plugins/plugins/qqmusic-provider'
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
source=[]
for f in ['qq-playlist-native-detail-builder.json','qq-playlist-native-user-builder.json']:
    p=WORK/f;r=json.loads(p.read_text(encoding='utf-8-sig'));d=r['data'];n=d['normalized_result']
    source.append(dict(file=str(p),sha256=digest(p),evidence_id=d['evidence_id'],
        procedure=n['procedure'],pseudocode=n['pseudocode'],assembly=n['assembly'],
        callees=[dict(address=x['address'],name=x['name']) for x in n['callees']],
        callers=n.get('callers'),strings=n['referenced_strings']))
bounded=WORK/'qq-playlist-bounded-native-source.json'
bounded.write_text(json.dumps(dict(schema='qq-playlist-bounded-native-source-v1',functions=source),indent=2)+'\n',encoding='utf-8')
files=[PLUGIN/'lib/windows/playlist-call.mjs',PLUGIN/'windows-playlist-call.test.mjs',WORK/'qq-playlist-builder-tests.log',WORK/'qq-playlist-native-locators.py',WORK/'qq-playlist-native-locators.json',WORK/'qq-playlist-native-json-imports.json',bounded]
record=dict(schema='qq-windows-playlist-findings-v1',
    authority='Approved Windows22.71 adaptation; static native2-dossier slice and offline public synthetic builder tests only',
    target=dict(path=r'E:\Program Files (x86)\QQMusic\QQMusic2271.18.09.14\QQMusic_Protocol.dll',sha256='ba66aa248b885227179f1676fbc54576a036f46b9d096fea33131c4f30fa6476',imagebase='0x10000000'),
    dossiers=[dict(file=s['file'],sha256=s['sha256'],evidence_id=s['evidence_id'],address=s['procedure']['address'],bytes=s['procedure']['body']['total_bytes'],query_exit_code=0,stderr_bytes=(WORK/Path(s['file']).name.replace('.json','.stderr.log')).stat().st_size) for s in source],
    observed=[
        dict(producer='0x1005cb06',request_key='music.srfDissInfo.DissInfoForPc.uniform_get_Dissinfo',module='music.srfDissInfo.DissInfoForPc',method='uniform_get_Dissinfo',
            fields=dict(login_uin='JSON unsigned64 number from current-session globals101b55f8/fc',host_uin='JSON unsigned64 number',disstid='JSON signed64 number from caller record text through1005da6c',dirid='JSON unsigned64 number from caller record text through1005da1d, only zero local-record-scalar branch'),
            assembly_proof=dict(login_uin_ctor='1005cc05 IAT101235e8 (_K unsigned64)',dirid_ctor='1005cc4f IAT101235e8 (_K unsigned64)',host_own_ctor='1005cc8a IAT101235e8',host_caller_ctor='1005cca2 IAT101235e8',disstid_ctor='1005ccd7 IAT10123578 (_J signed64)',branch='1005cc3d compare copied caller-record scalar to0; nonzero jump1005cc96',dispatch='1005cd6c calls10073e50',return_='1005cdac RET8'),
            limits=['Only first record in native vector is read. Empty vector dispatches nothing.','Zero local-record-scalar branch includes dirid and host=current-session; nonzero omits dirid and uses caller-record host.','No paging/count/order fields emitted here. Upstream scalar semantics and record string parsers are unexpanded.']),
        dict(producer='0x1005e1a1',request_key='music.musicasset.PlaylistBaseRead.GetPlaylistByUin',module='music.musicasset.PlaylistBaseRead',method='GetPlaylistByUin',fields=dict(uin='JSON string, current-session64 globals55f8/fc through string formatter1005f27c'),assembly_proof=dict(string_ctor='1005e1f4 IAT10123594 (std::string)',dispatch='1005e27a calls10073e50',next_producer='1005e29e calls1005e2b7',return_='1005e2b4 RET4'),limits=['Only uin emitted; no paging or caller-specified arbitrary user parameter.','Subsequent1005e2b7 has GetPlaylistFavInfo literal candidates in ordinaryPE but was not recovered; no favorites behavior/DTO claim.'])],
    implemented=dict(module=str(files[0]),tests=str(files[1]),exports=['buildWindowsPlaylistDetailCall','buildWindowsUserPlaylistsCall','WINDOWS_PLAYLIST_DETAIL_REQUEST_KEY','WINDOWS_USER_PLAYLISTS_REQUEST_KEY','WINDOWS_PLAYLIST_PROVENANCE'],
        policies=['Caller must supply decimal strings to preserve64bit IDs. Inputs capped20characters and native ranges enforced.','UInt64 rawJSON numbers and signed64 helper preserve JSON decimal digits beyond Number.MAX_SAFE_INTEGER.','Optionaldirid represents zero-record-scalar wire branch and requires normalizedhost==login.','Useruin decimal normalization/unsigned64 range is adapter policy; native formatter1005f27c was not expanded.','Errors contain fieldnames only; no supplied IDs.','Response decoder intentionally absent until actual native-response/publicshape contract is available.']),
    verification=dict(command='node --test plugins/qqmusic-provider/windows-playlist-call.test.mjs',cwd=str(ROOT/'Twilight-Echo-plugins'),exit_code=0,tests=6,pass_=6,fail=0,log=str(WORK/'qq-playlist-builder-tests.log'),scope=['Exact RPC/fields/type serialization','UInt64MAX and signed64MIN/MAX exactwiretext','dirid/current-session invariant','No inferred pagination/favorites fields','Type/NUL/whitespace/length/overflow and missing-input rejects','Outputdoesnotalias input, error privacy']),
    unknowns=['No playlist RPC network request or response read in this subtask. No response DTO/list/membercount/songidentity/ownership fields are established.','GetPlaylistByUin current-session creation list versus favorites and liked default list remains unconfirmed.','Arbitraryuid support not proven by recovered producer; root diagnostic owns currentplugin session.','Detailresponse/songlist pagination owner unresolved; no full-list/paging guarantee.','Native record string conversion1005da1d/da6c, inputrecord scalar semantic and UINformatter1005f27c remain unexpanded.'],
    files=[dict(path=str(p),sha256=digest(p)) for p in files],
    boundaries=['No target load/execution, network, original/privateprofile/cache/account state or livewindows.','Only2new nativefunction dossiers; one perprivate matching snapshot.','Only2newassigned production paths; no existingmodule/index/manifest edits; no Git mutation.'])
out=WORK/'qq-playlist-findings.json';out.write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
print(json.dumps(dict(file=str(out),sha256=digest(out),tests=record['verification'],dossiers=record['dossiers']),indent=2))
