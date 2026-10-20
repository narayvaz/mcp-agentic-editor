import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stageRelease, promoteRelease, fingerprintBundle, releaseStatus } from '../scripts/release-supervisor.mjs';
test('complete releases promote and roll back as bundles; tampering blocks promotion',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'azat-release-test-'));
  try{
    const make=(name:string,version:string)=>{const dir=path.join(root,name+'.app');fs.mkdirSync(path.join(dir,'Contents/MacOS'),{recursive:true});fs.mkdirSync(path.join(dir,'Contents/Resources'),{recursive:true});fs.writeFileSync(path.join(dir,'Contents/MacOS/Azat Studio'),version);fs.writeFileSync(path.join(dir,'Contents/Resources/build-manifest.json'),JSON.stringify({buildId:version,appVersion:version}));return dir;};
    const old=make('old','0.1.0'),next=make('next','0.2.0'),installed=path.join(root,'installed.app'),state=path.join(root,'controller');
    // Electron frameworks rely on relative symlinks; copied releases must remain self-contained.
    for(const bundle of [old,next]) {
      const framework=path.join(bundle,'Contents/Frameworks/Test.framework');
      fs.mkdirSync(path.join(framework,'Versions/A'),{recursive:true});
      fs.writeFileSync(path.join(framework,'Versions/A/Test'),'framework');
      fs.symlinkSync('A',path.join(framework,'Versions/Current'));
      fs.symlinkSync('Versions/Current/Test',path.join(framework,'Test'));
    }
    fs.cpSync(old,installed,{recursive:true,verbatimSymlinks:true});stageRelease(next,state);
    const promoted=promoteRelease('0.2.0',{root:state,installedPath:installed,checkProcess:false});
    assert.equal(fingerprintBundle(installed).bundleHash,fingerprintBundle(next).bundleHash);
    assert.equal(fs.readlinkSync(path.join(installed,'Contents/Frameworks/Test.framework/Versions/Current')),'A');
    assert.equal(promoted.previousId,'0.1.0');
    promoteRelease('0.1.0',{root:state,installedPath:installed,checkProcess:false});
    assert.equal(fingerprintBundle(installed).bundleHash,fingerprintBundle(old).bundleHash);
    fs.writeFileSync(path.join(state,'releases/0.2.0/Azat Studio.app/Contents/MacOS/Azat Studio'),'tampered');
    assert.throws(()=>promoteRelease('0.2.0',{root:state,installedPath:installed,checkProcess:false}),/integrity/);
    assert.equal(releaseStatus(state).current.currentId,'0.1.0');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
