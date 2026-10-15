"""Record pending playlist DTO contract, including real contradictory evidence."""
import hashlib,json
from pathlib import Path
WORK=Path(__file__).resolve().parent
ROOT=WORK.parents[3]
PLUGIN=ROOT/'Twilight-Echo-plugins/plugins/qqmusic-provider'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
evidence=[]
for name in ['qq-real-user-playlist-shapes-v2.json','qq-real-playlist-detail-shapes.json','qq-real-library-detail-relations.json']:
    p=WORK/name;evidence.append(dict(path=str(p),sha256=sha(p)))
relations=json.loads((WORK/'qq-real-library-detail-relations.json').read_text(encoding='utf-8-sig'))
files=[PLUGIN/'lib/windows/playlist-data.mjs',PLUGIN/'windows-playlist-data.test.mjs',WORK/'qq-playlist-data-v2-tests.log']
record=dict(schema='qq-windows-playlist-data-v2-findings',status='NOT INTEGRATED: native identity/tombstone contracts remain unresolved',
    authority='Root-owned safe shape/equality/count diagnostics; pure module synthetic tests only',
    evidence=evidence,real_relations=relations,
    contradictory_evidence=['Successful native detail code0/subcode0 andid/dir matches butresponsehost_uin!=requestsessionmusicid. Current strict synthetichostmatch therefore rejects this real successfulresponse.','Actual favorite v_list includesa tid also present inv_delTids. Returningunfilteredrecords can displayadeletedplaylist; tombstoneordering/full-vs-delta andnativeconsumerpolicy stillrequirestaticproof.'],
    existing_synthetic_policies=['Createdrecorduin==sessionUin isnotyet established byrealrelationdiagnostic.','Favoriteownedcomparison recorduin==session isnotyet confirmedcreatoraccountnamespace.','Detailhostmustmatchrequest isexplicitcurrentcodeconstraint, contradictedbyrealresponse; notacceptednativecontract.','Favoritehasmore0/1strictnumeric mapping hasactual0 evidence; nextpageinputcontract remainsunknown.'],
    implemented_exports=['createWindowsPlaylistReference','windowsPlaylistReference','mapCreatedWindowsPlaylist','decodeWindowsCreatedPlaylists','mapFavoriteWindowsPlaylist','decodeWindowsFavoritePlaylists','decodeWindowsPlaylistDetail'],
    implementation_behavior=['Canonical4/5segments persistrequesthostU64+tidI64+optionaldirU64 andnormalizeexactdecimalIDs.','Created/favoritesmaponlywhitelistedSDKsummaryfields, no rawmsg/avatar/extensions.','Favoritesreturntombstones asinternaldecimalTIDs withoutapplication; thisbehaviorisnotyet sufficientforlibraryUI.','Detailcurrentlychecksrequesthost/id/dir, emitsmappedtracks+validatedmedia; rejectswholemalformedsongratherthanfiltercursor.','Detailscode/subcodefailure isgenericanddoesnotpropagateservermsg.','Detailtotalgreaterthanrawsongcount explicitlycompletefalse; noestablishednativepagingfields.'],
    verification=dict(command='node --test plugins/qqmusic-provider/windows-playlist-data.test.mjs plugins/qqmusic-provider/windows-playlist-call.test.mjs plugins/qqmusic-provider/windows-tracks.test.mjs',cwd=str(ROOT/'Twilight-Echo-plugins'),exit_code=0,tests=30,pass_=30,fail=0,own_tests=18,meaning='Artificialcontractbehavioronly; notactual544songfull-decoder-validationorrealhostconstraintclosure',fixtures='Allvaluesartificial/public; rootactualprivateIDs/titles/credentialsnotreadorsavedbythisagent'),
    next_evidence=['Rootwillproviderecorduin==session, responsehost==recorduin, creator.musicid==session equalitybooleans.','Rootnativefavoriteconsumerhandlingproof neededbeforetombstones merged/filtered.','No guessing liked-directorynumber/opType/status semantics; separate staticworker investigating actualpredicate.'],
    files=[dict(path=str(p),sha256=sha(p)) for p in files],
    boundaries=['No network/originalDLLexecution/newREAquery inthisdecoderstep.','Onlyassignedplaylist-data.mjs/tests productionwrites; noRootindex/manifest/playlist-call edits orGit.','Afterhostcontradiction Root instructedpause newproductionassumptions; no constraintsrelaxed andnotintegrated.','Earlierqq-playlist-data-findings.json retainedashistoricalsyntheticrecord; itdoesnotproveactualownernamespace.'])
out=WORK/'qq-playlist-data-v2-findings.json'
out.write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
print(json.dumps(dict(path=str(out),sha256=sha(out),status=record['status'],files=record['files']),indent=2))
