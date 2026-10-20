import test from 'node:test';
import assert from 'node:assert/strict';
import {editReadiness,hasMeasuredSearchData,formatSearchMetric,publicHttpUrl,articlePreviewDocument,evidenceOutputLabel,refreshEvidenceDrafts} from '../src/lib/editor-workflows.ts';

const edited = {title:'Changed title',content:'<p>Changed</p>',baseTitle:'Original',baseContent:'<p>Original</p>',expectedRevision:'revision-a'};
test('search failures and unknown fields never become traffic numbers',()=>{
  assert.equal(hasMeasuredSearchData(null),false);
  assert.equal(hasMeasuredSearchData({available:false}),false);
  assert.equal(hasMeasuredSearchData({available:true}),true);
  assert.equal(formatSearchMetric(3210,false),'—');
  assert.equal(formatSearchMetric(null,true),'—');
  assert.equal(formatSearchMetric(Number.NaN,true),'—');
  assert.equal(formatSearchMetric(0,true),'0');
});
test('GSC ratio is displayed as a percentage and real zero remains zero',()=>{
  assert.equal(formatSearchMetric(0.081,true,'ctr'),'8.1%');
  assert.equal(formatSearchMetric(0,true,'ctr'),'0%');
  assert.equal(formatSearchMetric(null,true,'ctr'),'—');
});
test('revision token cannot make rendered WordPress fallback editable',()=>{
  assert.equal(editReadiness(edited,{revision:'revision-a',rawAvailable:false}).allowed,false);
  assert.equal(editReadiness(edited,{revision:'revision-a'}).allowed,false);
  assert.equal(editReadiness(edited,{revision:'revision-a',rawAvailable:true}).allowed,true);
});
test('missing, stale and unchanged article drafts cannot be staged',()=>{
  assert.equal(editReadiness(undefined,null).allowed,false);
  assert.equal(editReadiness({...edited,expectedRevision:''},{revision:'revision-a',rawAvailable:true}).allowed,false);
  assert.equal(editReadiness(edited,{revision:'revision-b',rawAvailable:true}).allowed,false);
  assert.equal(editReadiness({...edited,title:edited.baseTitle,content:edited.baseContent},{revision:'revision-a',rawAvailable:true}).allowed,false);
});
test('external links reject executable schemes and embedded credentials',()=>{
  assert.equal(publicHttpUrl('javascript:alert(1)'),undefined);
  assert.equal(publicHttpUrl('file:///tmp/private'),undefined);
  assert.equal(publicHttpUrl('https://user:secret@example.org/source'),undefined);
  assert.equal(publicHttpUrl('https://example.org/հայերեն')?.startsWith('https://example.org/'),true);
});
test('preview document denies active content and external resource access by default',()=>{
  const document=articlePreviewDocument('<p>Հայերեն Русский</p><script>bad()</script>');
  assert.ok(document.includes("default-src 'none'"));
  assert.ok(document.includes("form-action 'none'"));
  assert.ok(document.includes("base-uri 'none'"));
  assert.ok(!document.includes("script-src 'unsafe-inline'"));
  assert.ok(document.includes('Հայերեն Русский'));
});
test('retained outputs are unreviewed even at the current evidence revision',()=>{
  assert.equal(evidenceOutputLabel({status:'current',evidenceRevision:2},2).stale,false);
  assert.match(evidenceOutputLabel({status:'current',evidenceRevision:2},2).label,/unreviewed/);
  assert.equal(evidenceOutputLabel({status:'current',evidenceRevision:1},2).stale,true);
  assert.equal(evidenceOutputLabel({status:'needs-review',evidenceRevision:2},2).stale,true);
});
test('refresh advances clean records but preserves unsaved local evidence',()=>{
  const dirty={item:{id:'a',title:'Unsaved local edit',revision:1},dirty:true};
  const clean={item:{id:'b',title:'Old saved state',revision:1},dirty:false};
  const result=refreshEvidenceDrafts({a:dirty,b:clean},[{id:'a',title:'Changed elsewhere',revision:2},{id:'b',title:'New saved state',revision:2}]);
  assert.equal(result.a,dirty);
  assert.equal(result.b.item.title,'New saved state');
  assert.equal(clean.item.title,'Old saved state');
});
