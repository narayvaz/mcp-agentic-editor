import test from 'node:test';
import assert from 'node:assert/strict';
import {generateWithBoundedFallback} from '../server/model-client.ts';
test('only configured models are attempted and actual answering model is recorded',async()=>{
  const calls:string[]=[];const ai={models:{generateContent:async(x:any)=>{calls.push(x.model);if(x.model==='first')throw Error('Unavailable');return{text:'Reviewed response'};}}};
  const result=await generateWithBoundedFallback(ai,'first',['first','second'],[],0.2);
  assert.deepEqual(calls,['first','second']);assert.equal(result.modelUsed,'second');assert.equal(result.fallback,true);
});
test('empty output never becomes apparent success',async()=>{await assert.rejects(generateWithBoundedFallback({models:{generateContent:async()=>({text:''})}},'first',[],[],0.2),/usable output/);});
test('cancellation reaches the provider and prevents fallback after an aborted request',async()=>{
  const abort=new AbortController();let calls=0;
  const ai={models:{generateContent:async(x:any)=>{calls++;return await new Promise<never>((_resolve,reject)=>{x.config.abortSignal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});abort.abort();});}}};
  await assert.rejects(generateWithBoundedFallback(ai,'first','second',[],0.2,1000,abort.signal),/cancelled/);assert.equal(calls,1);
});
