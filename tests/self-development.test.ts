import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSelfDevelopmentController, assertEditableTarget, validateStagedWorkspace } from '../server/self-development.ts';

function fixture(options:any={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'azat-candidate-test-')),workspace=path.join(root,'source');
  fs.mkdirSync(path.join(workspace,'src/components'),{recursive:true});
  fs.writeFileSync(path.join(workspace,'src/components/Test.tsx'),'export default function Test(){return null;}');
  fs.writeFileSync(path.join(workspace,'package.json'),'{}');
  fs.writeFileSync(path.join(workspace,'.env'),'NEVER_COPY_THIS=private');
  let enabled=true;
  const controller=createSelfDevelopmentController({stateRoot:path.join(root,'state'),getConfig:()=>({enabled,workspaceRoot:workspace}),generate:async()=>({summary:'Readable heading',updatedContent:'export default function Test(){return <h1>Question</h1>;}'}),validate:async()=>[{name:'Behavioral fixture',passed:true,detail:'Passed'}],...options});
  return {root,workspace,controller,disable:()=>{enabled=false;},cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const input={targetFile:'src/components/Test.tsx',instruction:'Make the question visible.'};
test('proposal freezes exact code outside the active workspace and omits credentials',async()=>{
  const f=fixture();try{
    const original=fs.readFileSync(path.join(f.workspace,input.targetFile),'utf8'),p=await f.controller.propose(input);
    assert.equal(fs.readFileSync(path.join(f.workspace,input.targetFile),'utf8'),original);
    const staged=path.join(f.root,'state/self-development/proposals',p.id,'workspace');
    assert.equal(fs.existsSync(path.join(staged,'.env')),false);
    await assert.rejects(f.controller.approve(p.id,'wrong'),/exact reviewed/);
    const approved=await f.controller.approve(p.id,p.updatedHash);assert.equal(approved.status,'validated');
    await assert.rejects(f.controller.approve(p.id,p.updatedHash),/replayed/);
    assert.equal(fs.readFileSync(path.join(f.workspace,input.targetFile),'utf8'),original);
  }finally{f.cleanup();}
});
test('stale baseline, tampered candidate, disabled flag and required-check failure block validation',async()=>{
  const stale=fixture();try{const p=await stale.controller.propose(input);fs.writeFileSync(path.join(stale.workspace,input.targetFile),'changed');await assert.rejects(stale.controller.approve(p.id,p.updatedHash),/baseline changed/);}finally{stale.cleanup();}
  const tamper=fixture();try{const p=await tamper.controller.propose(input);fs.writeFileSync(path.join(tamper.root,'state/self-development/proposals',p.id,'workspace',input.targetFile),'tampered');await assert.rejects(tamper.controller.approve(p.id,p.updatedHash),/integrity/);}finally{tamper.cleanup();}
  const disabled=fixture();try{const p=await disabled.controller.propose(input);disabled.disable();await assert.rejects(disabled.controller.approve(p.id,p.updatedHash),/disabled/);}finally{disabled.cleanup();}
  const failed=fixture({validate:async()=>[]});try{const p=await failed.controller.propose(input);await assert.rejects(failed.controller.approve(p.id,p.updatedHash),/validation did not pass/);assert.equal(failed.controller.list()[0].status,'failed');}finally{failed.cleanup();}
});
test('cancellation and shared locking prevent delayed generation from becoming a candidate',async()=>{
  let release:()=>void=()=>{},entered:()=>void=()=>{};
  const started=new Promise<void>(r=>{entered=r;});
  const f=fixture({generate:async()=>{entered();await new Promise<void>(r=>{release=r;});return {summary:'late',updatedContent:'changed'};}});
  try{const pending=f.controller.propose(input);await started;await assert.rejects(f.controller.propose(input),/Another candidate/);f.controller.cancel();release();await assert.rejects(pending,/cancelled/);assert.equal(f.controller.list().length,0);assert.equal(f.controller.operationStatus().active,false);}finally{f.cleanup();}
});
test('protected files, traversal and source symlinks are refused',()=>{
  const f=fixture();try{
    assert.throws(()=>assertEditableTarget(f.workspace,'server.ts'),/protected/);
    assert.throws(()=>assertEditableTarget(f.workspace,'../outside.tsx'));
    fs.symlinkSync('/etc/hosts',path.join(f.workspace,'src/components/Escape.tsx'));
    assert.throws(()=>assertEditableTarget(f.workspace,'src/components/Escape.tsx'),/Symlink/);
  }finally{f.cleanup();}
});

test('approval validates the frozen candidate without generating different code',async()=>{
  let generated=0;
  const f=fixture({generate:async()=>{generated++;return {summary:'Exact change',updatedContent:'export default function Test(){return null;} // reviewed'};}});
  try{const proposal=await f.controller.propose({...input,targetFile:'src/components//Test.tsx'});assert.equal(proposal.targetFile,input.targetFile);await f.controller.approve(proposal.id,proposal.updatedHash);assert.equal(generated,1);assert.equal(f.controller.list()[0].status,'validated');}finally{f.cleanup();}
});
test('master switch and cancellation recheck before recording a successful validation',async()=>{
  let entered:()=>void=()=>{},release:()=>void=()=>{};
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const f=fixture({validate:async()=>{entered();await new Promise<void>(resolve=>{release=resolve;});return [{name:'passed',passed:true,detail:'fixture'}];}});
  try{const p=await f.controller.propose(input),pending=f.controller.approve(p.id,p.updatedHash);await started;f.controller.cancel();release();await assert.rejects(pending,/cancelled/);assert.equal(f.controller.list()[0].status,'cancelled');assert.equal(fs.existsSync(path.join(f.root,'state/self-development/proposals',p.id,'release-candidate.json')),false);}finally{f.cleanup();}
  let disable=()=>{};
  const g=fixture({validate:async()=>{disable();return [{name:'passed',passed:true,detail:'fixture'}];}});disable=g.disable;
  try{const p=await g.controller.propose(input);await assert.rejects(g.controller.approve(p.id,p.updatedHash),/disabled/);assert.equal(g.controller.list()[0].status,'failed');}finally{g.cleanup();}
});
test('separate controller instances cannot overlap against the same state journal',async()=>{
  let release:()=>void=()=>{},entered:()=>void=()=>{};
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const f=fixture({generate:async()=>{entered();await new Promise<void>(resolve=>{release=resolve;});return {summary:'x',updatedContent:'changed'};}});
  const other=createSelfDevelopmentController({stateRoot:path.join(f.root,'state'),getConfig:()=>({enabled:true,workspaceRoot:f.workspace}),generate:async()=>({summary:'x',updatedContent:'changed'})});
  try{const pending=f.controller.propose(input);await started;await assert.rejects(other.propose(input),/another process/);f.controller.cancel();release();await assert.rejects(pending,/cancelled/);}finally{f.cleanup();}
});
test('interrupted validation is retained and never resumed or replayed',async()=>{
  const f=fixture();try{const p=await f.controller.propose(input);const state=path.join(f.root,'state/self-development/state.json');const journal=JSON.parse(fs.readFileSync(state,'utf8'));journal.proposals[0].status='validating';fs.writeFileSync(state,JSON.stringify(journal));const recovered=createSelfDevelopmentController({stateRoot:path.join(f.root,'state'),getConfig:()=>({enabled:true,workspaceRoot:f.workspace}),generate:async()=>{throw new Error('must not generate');}});assert.equal(recovered.list()[0].status,'interrupted');await assert.rejects(recovered.approve(p.id,p.updatedHash),/replayed/);}finally{f.cleanup();}
});
test('missing required behavior regressions cannot become a successful skipped build',async()=>{
  const f=fixture();try{const stage=path.join(f.root,'stage');fs.mkdirSync(stage);fs.mkdirSync(path.join(f.workspace,'node_modules'));fs.writeFileSync(path.join(f.workspace,'node_modules','sentinel.txt'),'private copy');await assert.rejects(validateStagedWorkspace({workspacePath:stage,baselineRoot:f.workspace,signal:new AbortController().signal,assertCurrent(){},log(){}}),/behavioral regression tests are absent/);}finally{f.cleanup();}
});
test('the settings and release controller remain outside candidate editing authority',()=>{
 const f=fixture();try{fs.writeFileSync(path.join(f.workspace,'src/components/Settings.tsx'),'settings');assert.throws(()=>assertEditableTarget(f.workspace,'src/components/Settings.tsx'),/protected/);assert.throws(()=>assertEditableTarget(f.workspace,'server/self-development.ts'),/protected/);assert.throws(()=>assertEditableTarget(f.workspace,'scripts/release-supervisor.mjs'),/protected/);}finally{f.cleanup();}
});
test('expired proposals and source changes introduced by validation never reach release readiness',async()=>{
 let clock=Date.now();
 const expired=fixture({now:()=>clock});try{const p=await expired.controller.propose(input);clock+=25*60*60*1000;await assert.rejects(expired.controller.approve(p.id,p.updatedHash),/expired/);assert.equal(expired.controller.list()[0].status,'expired');}finally{expired.cleanup();}
 const changed=fixture({validate:async({workspacePath}:any)=>{fs.writeFileSync(path.join(workspacePath,'package.json'),'{"changed":true}');return [{name:'passing check',passed:true,detail:'fixture'}];}});try{const p=await changed.controller.propose(input);await assert.rejects(changed.controller.approve(p.id,p.updatedHash),/modified reviewed source/);assert.equal(changed.controller.list()[0].status,'failed');}finally{changed.cleanup();}
});
test('rejecting an exact pending proposal prevents later approval and is recorded',async()=>{
 const f=fixture();try{const p=await f.controller.propose(input);await f.controller.reject(p.id);assert.equal(f.controller.list()[0].status,'rejected');await assert.rejects(f.controller.approve(p.id,p.updatedHash),/replayed/);}finally{f.cleanup();}
});
