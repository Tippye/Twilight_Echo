"""Record narrow directory201 zero-host compatibility evidence; no private values."""
import hashlib,json
from pathlib import Path
WORK=Path(__file__).resolve().parent
ROOT=WORK.parents[3]
PLUGIN=ROOT/'Twilight-Echo-plugins/plugins/qqmusic-provider'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
prior=WORK/'qq-playlist-data-v2-findings.json'
namespace=WORK/'qq-real-library-namespace-relations.json'
files=[PLUGIN/'lib/windows/playlist-data.mjs',PLUGIN/'windows-playlist-data.test.mjs',WORK/'qq-playlist-data-v3-tests.log']
record=dict(schema='qq-windows-playlist-data-v3-findings',status='Directory201 compatibility implemented; favorite tombstone interpretation still pending integration',
    prior_record=dict(path=str(prior),sha256=sha(prior),meaning='Preserved genuinehostmismatch/tombstoneevidence before namespaceprobe'),
    namespace_evidence=dict(path=str(namespace),sha256=sha(namespace),data=json.loads(namespace.read_text(encoding='utf-8-sig'))),
    observations=['All4createdrecordownersmatchverifiedcurrentsession; earliercreatedownerconstraintisnowactualrelationverified.','Firstrequested directory201 detailcode0/subcode0,idanddirmatch,hostresponse0placeholder,creator.musicidnotcurrentsession; noQQlegacynamespaceclaim.','Realfirstdetailfullsongcount544matchesreportedtotal; actualdecoderall544itemsnotyetexecutedbythisagent.'],
    explicit_compatibility_policy=dict(source='Root-approved minimal observed-current-directory201 policy after safe boolean diagnostics',
        conditions=['All directory reference decoding requirescallerexplicitverified-session UIN equalcanonicalrequesthost andpositivehost.','Successbusinesscode0/subcode0 andactualresponseid==requestedtid,actualdirid==requesteddirid alwaysrequired.','Only requesteddirid201 and actualresponsehost0 permitsresponsehost!=requesthost.','Public/favorite references withoutdirid and alldifferentdirectoryIDs retainstrictresponsehostmatch.'],
        nonclaims=['Puredecoderdoesnotindependentlyvalidate remoteauth; RootentrymustcheckLogin and nativebuilderhost=login.','Directory201 exceptionisnotblanketzero-ownerfallback, ownernamespaceconversion orliked-folderclassifier.','No creator.musicid default ornativeplaceholderbehavior generalizedbeyondtheobservedcase.']),
    decoder_api='decodeWindowsPlaylistDetail(data,{playlistId,sessionUin}); sessionUinrequiredforall directoryreferences, optionalforpublicreferences',
    tests=dict(command='node --test plugins/qqmusic-provider/windows-playlist-data.test.mjs plugins/qqmusic-provider/windows-playlist-call.test.mjs plugins/qqmusic-provider/windows-tracks.test.mjs',cwd=str(ROOT/'Twilight-Echo-plugins'),exit_code=0,tests=32,pass_=32,fail=0,own_tests=20,
        added=['Current-sessiondirectory201+zeroresponsehostaccepts','Missing/mismatchedsessionreject','Publiczeroownerresponseexceptionreject','Differentdirectoryzeroownerreject','Nonzeroownermismatchreject','Changedtid/dir/businessstatusreject','Allnon201directorydecodingalsorequiresverified-sessioncontext'],meaning='Syntheticbehaviorandactualsafeprobe relationevidence; notlive544songdecoderacceptance'),
    remaining=['Favoritesrealreturnedlistoverlapstombstones; nativeconsumermerge/filter scopeawaitedbeforeintegration.','No liked-folderclassification fromdirIDyet; separate staticworker investigating consumerpredicate.','Own20tests do not proveother directoryzeroownerresponses areallowed; narrowexceptiononly.','Rootownsanyadditional realaccount/networkprobe and integration.'],
    files=[dict(path=str(p),sha256=sha(p)) for p in files],boundaries=['No newnetwork, originalprofile/cache/read orlivewindow','No newREAqueries','Onlyassignedplaylist-data.mjs/tests productionedits; noRootindex/manifest/playlist-call/Git'])
out=WORK/'qq-playlist-data-v3-findings.json'
out.write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
print(json.dumps(dict(path=str(out),sha256=sha(out),status=record['status'],files=record['files']),indent=2))
