import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EvidenceStore } from '../server/evidence.ts';
import { unicodeTokens, normalizeWordPressPost, completedGscWindow, expertRunObservation, smartRunObservation, readVpsStatus } from '../server/integrations.ts';
import { observeWordPress, observeProduction } from '../server/observation.ts';
import { postEditPreview } from '../server/wordpress-edit.ts';

test('HY, RU, EN and mixed-script queries retain meaningful tokens',()=>{
  for(const q of ['Հայաստանի հանրային ծառայություններ','Общественные услуги Армении','Armenian public services','Երևան Yerevan Ереван 2026']) assert.ok(unicodeTokens(q).length>=2);
  assert.deepEqual(unicodeTokens('Ազատ Ազատ'),['ազատ']);
});
test('WordPress revisions include raw source, status, schedule and media',()=>{
  const raw={id:7,modified_gmt:'2026-10-19T10:00:00',title:{raw:'Հայերեն',rendered:'Հայերեն'},content:{raw:'<p>Աղբյուր</p>',rendered:'rendered'},status:'draft',featured_media:8};
  const post=normalizeWordPressPost(raw);assert.equal(post.content,raw.content.raw);assert.equal(post.rawAvailable,true);
  assert.notEqual(normalizeWordPressPost({...raw,status:'publish'}).revision,post.revision);
  assert.notEqual(normalizeWordPressPost({...raw,featured_media:9}).revision,post.revision);
  assert.equal(postEditPreview(post,{title:'New title'}).after.content,raw.content.raw);
  assert.throws(()=>postEditPreview(post,{status:'publish'}));
});
test('GSC uses a bounded completed window and genuine zero is not a fallback fixture',()=>{
  const window=completedGscWindow(28,new Date('2026-10-19T12:00:00Z'));
  assert.equal(window.endDate,'2026-10-16');assert.equal(window.startDate,'2026-09-19');
  assert.equal(expertRunObservation({is_running:false,manifest:{status:'idle'},topic_count:0}).counts.topics,0);
  assert.equal(smartRunObservation({is_running:false,daily_count:0,state:'idle'}).counts.publishedToday,0);
  assert.throws(()=>expertRunObservation({}));
});
test('public HTTP tokens and unknown production paths are refused before a request',async()=>{
  await assert.rejects(readVpsStatus({baseUrl:'http://example.org',apiToken:'private'},'/api/expert/status'),/HTTPS/);
  await assert.rejects(readVpsStatus({transport:'ssh'},'/api/expert/start'),/read-only/);
  const observation=await observeProduction({vps:{}});assert.equal(observation.available,false);assert.deepEqual(observation.items,[]);
});
test('WordPress health reports only the measured REST response',async()=>{
  const previous=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({namespaces:['wp/v2']}),{status:200,headers:{'Content-Type':'application/json'}});
  try{const result=await observeWordPress({baseUrl:'https://example.org',name:'Test'});assert.equal(result.status,'healthy');assert.equal(result.performance.uptime,null);assert.equal(result.performance.score,null);assert.equal(result.metrics.length,1);}
  finally{globalThis.fetch=previous;}
});
test('evidence saves preserve revisions, reject stale edits and mark dependent outputs after correction',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'azat-evidence-test-'));
  try{
    const store=new EvidenceStore(path.join(root,'evidence.json'));
    assert.throws(()=>store.create({title:'Question',claims:[{text:'Claim',status:'supported',sourceIds:[]}]}));
    const record=store.create({title:'What changed?',language:'hy',sources:[{id:'original',title:'Original document',url:'https://example.org/document',excerpt:'The service starts on 20 October.'}],claims:[{id:'date',text:'The service starts on 20 October.',status:'supported',sourceIds:['original']}]});
    const withOutput=store.update(record.id,{expectedRevision:1,format:'brief'},'output');
    assert.equal(withOutput.outputs[0].status,'current');assert.equal(withOutput.evidenceRevision,1);
    assert.throws(()=>store.update(record.id,{expectedRevision:1,summary:'stale'}),/changed/);
    const corrected=store.update(record.id,{expectedRevision:withOutput.revision,reason:'The original document was revised.',claims:[{id:'date',text:'The date is unconfirmed.',status:'disputed',sourceIds:['original']}]},'correction');
    assert.equal(corrected.outputs[0].status,'needs-review');assert.equal(corrected.evidenceRevision,2);assert.equal(corrected.revisions.at(-1)?.kind,'correction');
    assert.equal(new EvidenceStore(path.join(root,'evidence.json')).get(record.id).revision,corrected.revision);
    fs.writeFileSync(path.join(root,'evidence.json'),'invalid');assert.throws(()=>store.list());
    assert.equal(fs.readFileSync(path.join(root,'evidence.json'),'utf8'),'invalid');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('translated outputs preserve the source record language and evidence revision across editions',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'azat-evidence-languages-'));
  try{
    const store=new EvidenceStore(path.join(root,'evidence.json'));
    const record=store.create({title:'Ի՞նչ է փոխվել',summary:'Աղբյուրի հայերեն համատեքստը',language:'hy',sources:[{id:'source',title:'Original document',url:'https://example.org/document',excerpt:'Retained source passage.'}],claims:[{id:'claim',text:'Unresolved source claim.',status:'unverified',sourceIds:['source']}]});
    const english=store.update(record.id,{expectedRevision:record.revision,format:'article',language:'en',text:'English dependent draft.',summary:'Output request must not replace source context.'},'output');
    assert.equal(english.language,'hy');assert.equal(english.summary,record.summary);assert.equal(english.evidenceRevision,record.evidenceRevision);assert.equal(english.revision,record.revision+1);
    assert.equal(english.outputs[0].language,'en');assert.equal(english.outputs[0].text,'English dependent draft.');assert.equal(english.revisions.at(-1)?.snapshot.language,'hy');
    assert.deepEqual(english.sources,record.sources);assert.deepEqual(english.claims,record.claims);
    const russian=store.update(record.id,{expectedRevision:english.revision,format:'script',language:'ru',text:'Русский зависимый черновик.'},'output');
    const retained=new EvidenceStore(path.join(root,'evidence.json')).get(record.id);
    assert.equal(retained.language,'hy');assert.equal(retained.evidenceRevision,1);assert.deepEqual(retained.outputs.map(output=>[output.language,output.status]),[['en','current'],['ru','current']]);
    assert.equal(russian.revisions.at(-1)?.snapshot.language,'hy');
    const edited=store.update(record.id,{expectedRevision:russian.revision,language:'ru'});
    assert.equal(edited.language,'ru');assert.equal(edited.evidenceRevision,2);assert.ok(edited.outputs.every(output=>output.status==='needs-review'));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
