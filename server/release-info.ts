import fs from 'node:fs';
import path from 'node:path';
export function readReleaseInfo(stateRoot: string) {
  const root=path.join(stateRoot,'release-controller');
  const read=(file:string)=>{try{return JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));}catch{return null;}};
  const current=read('current.json'),activation=read('activation.json');
  const releases=fs.existsSync(path.join(root,'releases'))?fs.readdirSync(path.join(root,'releases')).filter(id=>/^[a-zA-Z0-9._-]+$/.test(id)).flatMap(id=>{
    const r=read(`releases/${id}/release.json`);return r?[{id:r.id,appVersion:r.appVersion,stagedAt:r.stagedAt,bundleHash:r.bundleHash,legacyBaseline:r.legacyBaseline}]:[];
  }):[];
  return {current:current?{id:current.currentId,previousId:current.previousId,activatedAt:current.activatedAt,bundleHash:current.bundleHash}:null,activation:activation?{phase:activation.phase,releaseId:activation.releaseId,requestedAt:activation.requestedAt}:null,releases,activationCapability:'operator-only',rollbackScope:'complete-application-bundle'};
}
