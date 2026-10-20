import test from 'node:test';
import assert from 'node:assert/strict';
import { createCredentialStore, CredentialError, type CredentialExecutor } from '../server/credential-store';

function deferred() {
  let resolve!: (value: string) => void, reject!: (error: unknown) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('waiting for a credential leaves the main timer responsive and has a bounded cancellable helper lifetime', async () => {
  const read = deferred(); let cancelled = 0, timerFired = false;
  const store = createCredentialStore({ platform:'darwin', timeoutMs:30, executor: (_args, options) => {
    assert.equal(options.timeout,30); assert.equal(options.killSignal,'SIGKILL');
    return {promise:read.promise,cancel:()=>{cancelled++;}};
  }});
  const result = store.resolve('keychain://fake.pending').catch(error=>error);
  await new Promise(resolve=>setTimeout(()=>{timerFired=true;resolve(null);},0));
  assert.equal(timerFired,true); assert.equal(cancelled,0);
  const error=await result;
  assert.ok(error instanceof CredentialError); assert.equal(error.code,'CREDENTIAL_TIMEOUT'); assert.equal(cancelled,1);
  read.resolve('late fake credential');
});

test('concurrent reads share one helper, reuse positive cache, and refresh after expiry', async () => {
  const read=deferred();let calls=0,clock=100;
  const store=createCredentialStore({platform:'darwin',now:()=>clock,cacheTtlMs:100,executor:()=>({promise:++calls===1?read.promise:Promise.resolve('second fake value'),cancel:()=>{}})});
  const first=store.resolve('keychain://fake.shared'), second=store.resolve('keychain://fake.shared');
  assert.equal(calls,1);read.resolve('first fake value');assert.deepEqual(await Promise.all([first,second]),['first fake value','first fake value']);
  assert.equal(await store.resolve('keychain://fake.shared'),'first fake value');assert.equal(calls,1);
  clock=201;assert.equal(await store.resolve('keychain://fake.shared'),'second fake value');assert.equal(calls,2);
});

test('a late helper result after timeout cannot populate the cache or replace a successful retry', async () => {
  const late=deferred();let calls=0;
  const store=createCredentialStore({platform:'darwin',timeoutMs:10,executor:()=>({promise:++calls===1?late.promise:Promise.resolve('retry fake value'),cancel:()=>{}})});
  await assert.rejects(store.resolve('keychain://fake.late'),CredentialError);
  late.resolve('expired fake value');await Promise.resolve();
  assert.equal(await store.resolve('keychain://fake.late'),'retry fake value');assert.equal(calls,2);
  assert.equal(await store.resolve('keychain://fake.late'),'retry fake value');assert.equal(calls,2);
});

test('one unavailable Google reference does not delay or poison an independent VPS reference', async () => {
  const blocked=deferred();const calls:string[]=[];
  const store=createCredentialStore({platform:'darwin',timeoutMs:30,executor:args=>{
    const account=args[args.indexOf('-a')+1];calls.push(account);
    return{promise:account==='fake.google'?blocked.promise:Promise.resolve('fake VPS token'),cancel:()=>{}};
  }});
  const google=store.resolve('keychain://fake.google').catch(error=>error);
  assert.equal(await store.resolve('keychain://fake.vps'),'fake VPS token');
  assert.equal((await google).code,'CREDENTIAL_TIMEOUT');assert.deepEqual(calls,['fake.google','fake.vps']);
  assert.equal(await store.resolve('keychain://fake.vps'),'fake VPS token');
});

test('failed and empty reads fail closed, never cache a fake credential, and redact helper errors', async () => {
  const secret='DO_NOT_RETURN_FAKE_CREDENTIAL';let calls=0;
  const executor:CredentialExecutor=()=>({promise:++calls===1?Promise.reject(Object.assign(new Error(`/private/${secret} Authorization: ${secret}`),{stdout:secret,stderr:secret})):calls===2?Promise.resolve(''):Promise.resolve('recovered fake credential'),cancel:()=>{}});
  const store=createCredentialStore({platform:'darwin',executor});
  for(let index=0;index<2;index++)await assert.rejects(store.resolve('keychain://fake.retry'),error=>{
    assert.ok(error instanceof CredentialError);assert.equal(error.code,'CREDENTIAL_UNAVAILABLE');assert.ok(!String(error).includes(secret));assert.ok(!String(error).includes('/private/'));return true;
  });
  assert.equal(await store.resolve('keychain://fake.retry'),'recovered fake credential');assert.equal(calls,3);
});

test('blank and existing-reference saves retain references without reading or writing any credential', async () => {
  let calls=0;const store=createCredentialStore({platform:'darwin',executor:()=>{calls++;throw Error('No helper should run');}});
  assert.equal(await store.store('fake.key',''),'');assert.equal(await store.store('fake.key','keychain://fake.existing'),'keychain://fake.existing');
  assert.equal(await store.resolve(''),'');assert.equal(await store.resolve('legacy test value'),'legacy test value');assert.equal(calls,0);
  await assert.rejects(store.resolve('keychain://'),CredentialError);assert.equal(calls,0);
});

test('credential replacements return only a new reference and do not read the previous secret', async () => {
  const commands:string[][]=[];
  const store=createCredentialStore({platform:'darwin',executor:args=>{commands.push(args);return{promise:Promise.resolve(''),cancel:()=>{}};}});
  const reference=await store.store('fake.replacement','fake replacement value');
  assert.match(reference,/^keychain:\/\/fake\.replacement\./);assert.ok(!reference.includes('fake replacement value'));
  assert.equal(commands.length,1);assert.equal(commands[0][0],'add-generic-password');
  assert.equal(await store.resolve(reference),'fake replacement value');assert.equal(commands.length,1);
});

test('save failures and deadlines expose no secret and never return a successful reference', async () => {
  const secret='FAKE_SECRET_MUST_STAY_PRIVATE';
  const failed=createCredentialStore({platform:'darwin',executor:()=>({promise:Promise.reject(new Error(secret)),cancel:()=>{}})});
  await assert.rejects(failed.store('fake.save',secret),error=>{assert.ok(error instanceof CredentialError);assert.match(error.message,/Settings were not saved/);assert.ok(!error.message.includes(secret));return true;});
  let cancelled=false;const timeout=createCredentialStore({platform:'darwin',timeoutMs:10,executor:()=>({promise:new Promise(()=>{}),cancel:()=>{cancelled=true;}})});
  await assert.rejects(timeout.store('fake.save',secret),error=>error instanceof CredentialError&&error.code==='CREDENTIAL_TIMEOUT');assert.equal(cancelled,true);
});

test('unsupported platforms refuse configured Keychain reads and new secret storage', async () => {
  let calls=0;const store=createCredentialStore({platform:'linux',executor:()=>{calls++;throw Error('unreachable');}});
  await assert.rejects(store.resolve('keychain://fake.key'),error=>error instanceof CredentialError&&error.code==='CREDENTIAL_STORAGE_UNAVAILABLE');
  await assert.rejects(store.store('fake.key','fake value'),error=>error instanceof CredentialError&&error.code==='CREDENTIAL_STORAGE_UNAVAILABLE');assert.equal(calls,0);
});
