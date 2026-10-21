import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeSecurity, requiredCapability } from '../server/runtime-security.ts';
import { redactSettings, mergeSettingsSecrets, publicSites } from '../server/settings-security.ts';

const token = 'a'.repeat(64);
const security = createRuntimeSecurity({ token, port: 3210 });
function invoke(headers: Record<string,string>, url='/api/settings', method='GET', guard=security) {
  let code=200, next=false, body:unknown;
  const response={setHeader(){},status(x:number){code=x;return this;},json(x:unknown){body=x;return this;}};
  guard.middleware({headers,path:url,method} as any,response as any,()=>{next=true;});
  return {code,next,body};
}
const authorized={host:'127.0.0.1:3210',authorization:`Bearer ${token}`};
test('API rejects unauthenticated local processes and wrong tokens',()=>{
  assert.equal(invoke({host:authorized.host}).code,401);
  assert.equal(invoke({...authorized,authorization:'Bearer wrong'}).code,401);
  assert.equal(invoke(authorized).next,true);
});
test('Host, Origin and fetch metadata reject cross-origin and rebinding attempts',()=>{
  assert.equal(invoke({...authorized,host:'attacker.example:3210'}).code,403);
  assert.equal(invoke({...authorized,origin:'https://attacker.example'}).code,403);
  assert.equal(invoke({...authorized,'sec-fetch-site':'cross-site'}).code,403);
});
test('health readiness remains public but execution through GET is blocked',()=>{
  assert.equal(invoke({host:authorized.host},'/api/health').next,true);
  assert.equal(invoke(authorized,'/api/automations/a/trigger').code,405);
});
test('privileged routes require their declared session capabilities',()=>{
  const readOnly=createRuntimeSecurity({token,port:3210,capabilities:['read']});
  assert.equal(invoke(authorized,'/api/settings','PUT',readOnly).code,403);
  assert.equal(requiredCapability('PUT','/api/wp/post/17'),'wordpress:write');
  assert.equal(requiredCapability('POST','/api/self-mod/apply'),'development:validate');
});
test('WebSocket requires exact origin, host and session protocol',()=>{
  const h={host:authorized.host,origin:'http://127.0.0.1:3210','sec-websocket-protocol':`azat-status, azat-session.${token}`};
  assert.equal(security.acceptSocket({headers:h} as any),true);
  assert.equal(security.acceptSocket({headers:{...h,origin:'https://attacker.example'}} as any),false);
  assert.equal(security.acceptSocket({headers:{...h,'sec-websocket-protocol':'azat-status'}} as any),false);
});
const base={ai:{apiKey:'secret-ai',model:'model'},vps:{apiToken:'secret-vps'},hostinger:{apiToken:'secret-host'},google:{serviceAccountJson:'private-key'},wordpressSites:[{id:'am',name:'Armenian',baseUrl:'https://azat.tv',username:'editor',appPassword:'secret-wp'}],selfModification:{enabled:false,autoApplyEnabled:false}};
test('configuration responses contain status but no saved credentials',()=>{
  const clean=redactSettings(base);
  assert.equal(clean.ai.apiKey,'');assert.equal(clean.wordpressSites[0].appPassword,'');
  assert.equal(clean.secretStatus['wordpress.am.appPassword'],true);
  assert.equal(JSON.stringify(clean).includes('secret-'),false);
  assert.equal(JSON.stringify(publicSites(base)).includes('secret-'),false);
  assert.equal(base.ai.apiKey,'secret-ai');
});
test('saving redacted forms retains existing secrets; explicit clearing is scoped',()=>{
  const incoming=redactSettings(base);
  const merged=mergeSettingsSecrets(base,incoming);
  assert.equal(merged.ai.apiKey,base.ai.apiKey);
  assert.equal(merged.wordpressSites[0].appPassword,base.wordpressSites[0].appPassword);
  assert.equal(mergeSettingsSecrets(base,{clearSecrets:['ai.apiKey']}).ai.apiKey,'');
  assert.throws(()=>mergeSettingsSecrets(base,{clearSecrets:['__proto__.anything']}));
  assert.throws(()=>mergeSettingsSecrets(base,{wordpressSites:[{id:'am'},{id:'am'}]}));
  assert.equal(mergeSettingsSecrets(base,{selfModification:{enabled:true,autoApplyEnabled:true}}).selfModification.autoApplyEnabled,false);
});
