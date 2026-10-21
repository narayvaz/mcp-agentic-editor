import test from 'node:test';
import assert from 'node:assert/strict';
import {assistantHistory,canRecoverAssistantTurn,describeAssistantFailure,narrowedAssistantRetry,restoredAssistantTurnId} from '../src/lib/assistant-workflows';

test('failed requests retain actionable provider information and request IDs', () => {
  const failure = describeAssistantFailure({message:'The AI provider is busy. Try again shortly.',code:'MODEL_UNAVAILABLE',requestId:'request-1',retryable:true});
  assert.equal(failure.code,'MODEL_UNAVAILABLE'); assert.equal(failure.requestId,'request-1'); assert.match(failure.message,/busy/);
  assert.equal(describeAssistantFailure({message:'Check the saved AI connection.',retryable:false}).retryable,false);
  assert.match(describeAssistantFailure({name:'AbortError'}).message,/question is retained/);
});

test('retry honors new opt-outs and never silently adds research or story data',()=>{
  const original={includeContext:true,research:{web:true,scholar:false,notebook:true},payload:{context:'original story'},files:['retained attachment']};
  const narrower=narrowedAssistantRetry(original,{includeContext:false,web:false,scholar:true,notebook:true});
  assert.equal(narrower.includeContext,false);assert.equal(narrower.research.web,false);assert.equal(narrower.research.scholar,false);assert.equal(narrower.payload,undefined);assert.deepEqual(narrower.files,original.files);
  assert.equal(original.includeContext,true);assert.ok(original.payload);
});

test('restoring the same unanswered question reuses its ID only in its original chat',()=>{
  const last={id:'q',role:'user' as const,content:'Question'};const restored={threadId:'one',id:'q',prompt:'Question'};
  assert.equal(restoredAssistantTurnId(last,restored,'one','Question'),'q');
  assert.equal(restoredAssistantTurnId(last,restored,'two','Question'),undefined);
  assert.equal(restoredAssistantTurnId(last,restored,'one','Edited question'),undefined);
});

test('only the last unanswered turn of an active chat is recoverable', () => {
  const question={id:'q',role:'user' as const,content:'Describe Studio.'};
  assert.equal(canRecoverAssistantTurn([question],'q','active',false),true);
  assert.equal(canRecoverAssistantTurn([question],'q','archived',false),false);
  assert.equal(canRecoverAssistantTurn([question],'q','active',true),false);
  assert.equal(canRecoverAssistantTurn([question,{id:'a',role:'agent',content:'Answer'}],'q','active',false),false);
  assert.equal(canRecoverAssistantTurn([question,{...question,id:'new'}],'q','active',false),false);
});

test('long histories retain the newest context with an explicit bounded excerpt', () => {
  const messages=Array.from({length:20},(_,i)=>({id:String(i),role:'agent' as const,content:`turn-${i} `+'x'.repeat(3000)}));
  const text=assistantHistory(messages,10_000);
  assert.ok(text.length<10_100); assert.ok(text.includes('turn-19')); assert.ok(!text.includes('turn-1 ')); assert.match(text,/omitted/);
});
