// Operator-only controller. Never imported by a model's editable runtime or exposed as an HTTP mutation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const defaultState=()=>path.join(process.env.AZAT_STATE_DIR||path.join(os.homedir(),'.mcp-agentic-editor'),'release-controller');
function atomicJson(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const tmp=`${file}.${crypto.randomUUID()}.tmp`,fd=fs.openSync(tmp,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(value,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(tmp,file);
}
function locked(root,run){
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  const lock=path.join(root,'release.lock');
  let fd;try{fd=fs.openSync(lock,'wx',0o600);}catch{throw new Error('Another release operation owns the controller. Preserve the lock for recovery.');}
  try{fs.writeFileSync(fd,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));return run();}
  finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
export function fingerprintBundle(bundle){
  const root=fs.realpathSync(bundle),files={};
  function visit(relative=''){
    for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      const rel=path.join(relative,entry.name),full=path.join(root,rel);
      if(entry.isSymbolicLink()){
        const target=fs.realpathSync(full);if(target!==root&&!target.startsWith(root+path.sep))throw new Error('A release symlink escapes its bundle.');
        files[rel]=`symlink:${fs.readlinkSync(full)}`;
      }else if(entry.isDirectory())visit(rel);
      else if(entry.isFile())files[rel]=hash(fs.readFileSync(full));
    }
  }
  visit();return {files,bundleHash:hash(JSON.stringify(files))};
}
function readDescriptor(root,id){
  if(typeof id!=='string'||!/^[a-zA-Z0-9._-]+$/.test(id))throw Error('Invalid release ID.');
  return JSON.parse(fs.readFileSync(path.join(root,'releases',id,'release.json'),'utf8'));
}
function stageUnlocked(source,root){
  if(!fs.existsSync(path.join(source,'Contents/MacOS')))throw Error('Choose a complete macOS application bundle.');
  const snapshot=fingerprintBundle(source);
  let manifest=null;
  try{manifest=JSON.parse(fs.readFileSync(path.join(source,'Contents/Resources/build-manifest.json'),'utf8'));}catch{}
  const id=manifest?.buildId||`baseline-${snapshot.bundleHash.slice(0,12)}`;
  if(!/^[a-zA-Z0-9._-]+$/.test(id))throw Error('Invalid bundle identity.');
  const directory=path.join(root,'releases',id),bundle=path.join(directory,'Azat Studio.app');
  if(fs.existsSync(path.join(directory,'release.json'))){const previous=readDescriptor(root,id);if(previous.bundleHash!==snapshot.bundleHash)throw Error('A different bundle already has this release ID.');return previous;}
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  if(fs.existsSync(bundle))throw Error('An incomplete staged bundle needs operator recovery.');
  fs.cpSync(source,bundle,{recursive:true,dereference:false,verbatimSymlinks:true,mode:fs.constants.COPYFILE_FICLONE});
  if(fingerprintBundle(bundle).bundleHash!==snapshot.bundleHash)throw Error('The staged application differs from its source.');
  const descriptor={schemaVersion:1,id,appVersion:manifest?.appVersion||null,bundleHash:snapshot.bundleHash,files:snapshot.files,stagedAt:new Date().toISOString(),legacyBaseline:!manifest};
  atomicJson(path.join(directory,'release.json'),descriptor);return descriptor;
}
export function stageRelease(source,root=defaultState()){return locked(root,()=>stageUnlocked(path.resolve(source),root));}

function ensureStopped(installedPath){
  const escaped=path.join(installedPath,'Contents/MacOS/').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  try{execFileSync('/usr/bin/pgrep',['-f',`^${escaped}`],{stdio:'pipe'});throw Error('Quit Azat Studio before activating a complete release.');}
  catch(e){if(e.status!==1)throw e;}
}
export function promoteRelease(id,{root=defaultState(),installedPath='/Applications/Azat Studio.app',checkProcess=true}={}){
  return locked(root,()=>{
    if(process.platform!=='darwin')throw Error('Atomic application promotion requires macOS.');
    if(checkProcess)ensureStopped(installedPath);
    const descriptor=readDescriptor(root,id),source=path.join(root,'releases',id,'Azat Studio.app');
    if(fingerprintBundle(source).bundleHash!==descriptor.bundleHash)throw Error('The staged release failed its integrity check.');
    const previous=fs.existsSync(installedPath)?stageUnlocked(installedPath,root):null;
    const staging=path.join(path.dirname(installedPath),`.Azat Studio.stage-${crypto.randomUUID()}.app`);
    fs.cpSync(source,staging,{recursive:true,dereference:false,verbatimSymlinks:true,mode:fs.constants.COPYFILE_FICLONE});
    if(fingerprintBundle(staging).bundleHash!==descriptor.bundleHash)throw Error('The activation copy failed verification.');
    const journal={schemaVersion:1,phase:'prepared',releaseId:id,previousId:previous?.id||null,installedPath,staging,requestedAt:new Date().toISOString()};
    atomicJson(path.join(root,'activation.json'),journal);
    if(previous){
      // RENAME_SWAP exchanges two complete directories atomically on the same filesystem.
      const program='import ctypes,os,sys\nlib=ctypes.CDLL(None,use_errno=True)\nf=lib.renameatx_np\nf.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]\nr=f(-2,os.fsencode(sys.argv[1]),-2,os.fsencode(sys.argv[2]),2)\nif r: raise OSError(ctypes.get_errno(),os.strerror(ctypes.get_errno()))';
      execFileSync('/usr/bin/python3',['-c',program,installedPath,staging],{stdio:'pipe'});
    }else fs.renameSync(staging,installedPath);
    if(fingerprintBundle(installedPath).bundleHash!==descriptor.bundleHash)throw Error('Activation identity could not be confirmed. Keep both bundles for recovery.');
    const current={schemaVersion:1,currentId:id,previousId:previous?.id||null,bundleHash:descriptor.bundleHash,installedPath,activatedAt:new Date().toISOString(),previousBundleAt:previous?staging:null};
    atomicJson(path.join(root,'current.json'),current);atomicJson(path.join(root,'activation.json'),{...journal,phase:'complete',completedAt:current.activatedAt});
    return current;
  });
}
export function releaseStatus(root=defaultState()){
  const read=name=>{try{return JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));}catch{return null;}};
  return {current:read('current.json'),activation:read('activation.json'),releases:fs.existsSync(path.join(root,'releases'))?fs.readdirSync(path.join(root,'releases')).filter(id=>fs.existsSync(path.join(root,'releases',id,'release.json'))).map(id=>{const {files,...record}=readDescriptor(root,id);return record;}):[]};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  try{
    const [action,value]=process.argv.slice(2);
    const result=action==='stage'?stageRelease(value):action==='activate'?promoteRelease(value):action==='rollback'?promoteRelease(value||releaseStatus().current?.previousId):action==='status'?releaseStatus():null;
    if(!result)throw Error('Use stage <application>, activate <release-id>, rollback [release-id], or status.');
    const {files,...safe}=result;console.log(JSON.stringify(safe,null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
