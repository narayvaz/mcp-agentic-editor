import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=process.cwd();
const files={};
function visit(relative){
  const full=path.join(root,relative);
  for(const entry of fs.readdirSync(full,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const rel=`${relative}/${entry.name}`;
    if(entry.isSymbolicLink())throw new Error('Release artifacts must not contain symlinks.');
    if(entry.isDirectory())visit(rel);else if(entry.isFile())files[rel]=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,rel))).digest('hex');
  }
}
for(const dir of ['dist','dist-server','dist-electron'])visit(dir);
const hash=values=>crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const sourceFiles={};
function sourceVisit(relative){for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const rel=`${relative}/${entry.name}`;if(entry.isSymbolicLink())throw new Error('Release source inputs must not contain symlinks.');if(entry.isDirectory())sourceVisit(rel);else if(entry.isFile())sourceFiles[rel]=hash(fs.readFileSync(path.join(root,rel)));}}
for(const dir of ['src','server','shared','electron','scripts','tests','public','build'])sourceVisit(dir);
for(const file of ['server.ts','package.json','package-lock.json','tsconfig.json','tsconfig.electron.json','vite.config.ts','index.html'])sourceFiles[file]=hash(fs.readFileSync(file));
const sourceHash=hash(sourceFiles);
const builtAt=new Date().toISOString(),buildInstanceId=crypto.randomUUID();
const buildId=`${pkg.version}-${hash({files,sourceHash,buildInstanceId}).slice(0,12)}`;
const manifest={schemaVersion:1,appVersion:pkg.version,buildId,builtAt,buildInstanceId,sourceHash,toolchain:{node:process.version,platform:process.platform,arch:process.arch},frontendHash:hash(Object.entries(files).filter(([name])=>name.startsWith('dist/'))),backendHash:hash(Object.entries(files).filter(([name])=>name.startsWith('dist-server/'))),files};
fs.writeFileSync('build-manifest.json',JSON.stringify(manifest,null,2));
console.log(`Identified release ${buildId} (${Object.keys(files).length} verified artifacts)`);
