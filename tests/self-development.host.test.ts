import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runIsolatedCommand } from '../server/self-development.ts';

// Host-only mechanism probes: run by the full host suite, never nested inside a candidate sandbox.
test('OS sandbox permits private candidate work and blocks outside file reads and writes',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'azat-sandbox-host-')),workspace=path.join(root,'workspace');fs.mkdirSync(workspace);
 try{
  const privateFile=path.join(root,'outside-private.txt');fs.writeFileSync(privateFile,'private fixture');
  const script=`const fs=require('fs');const p=${JSON.stringify(privateFile)};let denied=0;for(const action of [()=>fs.readFileSync(p),()=>fs.writeFileSync(p,'changed')]){try{action()}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e;denied++;}}if(denied!==2)process.exit(9);fs.writeFileSync('permitted.txt','candidate');console.log('outside read and write blocked');`;
  const result=await runIsolatedCommand(process.execPath,['-e',script],workspace,new AbortController().signal,10000);
  assert.equal(result.code,0,result.output);assert.match(result.output,/outside read and write blocked/);assert.equal(fs.readFileSync(privateFile,'utf8'),'private fixture');assert.equal(fs.readFileSync(path.join(workspace,'permitted.txt'),'utf8'),'candidate');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('OS sandbox refuses network connection creation without contacting external services',async()=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'azat-sandbox-net-'));
 try{
  const script=`const net=require('net');const socket=net.connect({host:'127.0.0.1',port:9});socket.on('connect',()=>process.exit(9));socket.on('error',error=>{if(!['EPERM','EACCES'].includes(error.code)){console.error(error.code);process.exit(8);}console.log('network creation blocked');process.exit(0);});setTimeout(()=>process.exit(7),1000);`;
  const result=await runIsolatedCommand(process.execPath,['-e',script],workspace,new AbortController().signal,10000);assert.equal(result.code,0,result.output);assert.match(result.output,/network creation blocked/);
 }finally{fs.rmSync(workspace,{recursive:true,force:true});}
});
test('cancelling an isolated worker does not return success',async()=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'azat-sandbox-cancel-'));const controller=new AbortController();
 try{const pending=runIsolatedCommand(process.execPath,['-e',`setInterval(()=>{},1000)`],workspace,controller.signal,10000);setTimeout(()=>controller.abort(),30);await assert.rejects(pending,/cancelled/);}finally{fs.rmSync(workspace,{recursive:true,force:true});}
});
