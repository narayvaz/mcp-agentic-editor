import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('rebuilding identical inputs creates a distinct release, while lock and build configuration changes alter source identity',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'azat-manifest-test-'));
  const script=fileURLToPath(new URL('../scripts/create-build-manifest.mjs',import.meta.url));
  try {
    for(const dir of ['dist','dist-server','dist-electron','src','server','shared','electron','scripts','tests','public']) {
      fs.mkdirSync(path.join(root,dir));fs.writeFileSync(path.join(root,dir,'fixture.txt'),'same');
    }
    fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'0.2.0'}));
    for(const file of ['server.ts','package-lock.json','tsconfig.json','tsconfig.electron.json','vite.config.ts','index.html'])fs.writeFileSync(path.join(root,file),'fixture');
    const build=()=>{execFileSync(process.execPath,[script],{cwd:root,stdio:'pipe'});return JSON.parse(fs.readFileSync(path.join(root,'build-manifest.json'),'utf8'));};
    const first=build(),second=build();
    assert.notEqual(first.buildId,second.buildId);assert.equal(first.sourceHash,second.sourceHash);assert.deepEqual(first.files,second.files);
    fs.writeFileSync(path.join(root,'package-lock.json'),'changed dependency lock');
    const third=build();assert.notEqual(second.sourceHash,third.sourceHash);
    fs.writeFileSync(path.join(root,'vite.config.ts'),'changed build configuration');
    const fourth=build();assert.notEqual(third.sourceHash,fourth.sourceHash);
    fs.writeFileSync(path.join(root,'shared','fixture.txt'),'changed shared input');
    assert.notEqual(fourth.sourceHash,build().sourceHash);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
