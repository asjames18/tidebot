// After npm ci && npm run build: node --test tests/chat-roundtrip.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,cp,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

const listen = async s => { s.listen(0,'127.0.0.1'); await once(s,'listening'); return s.address().port; };
async function until(fn) {
  for(let i=0;i<250;i++){const value=await fn(); if(value)return value; await sleep(100);}
  throw Error('Timed out waiting for server or assistant reply');
}
test('custom provider outage has bounded retries; chat recovers and survives restart', async t => {
  const d=await mkdtemp(tmpdir()+'/tide-chat-');
  t.after(()=>rm(d,{recursive:true,force:true}));
  await cp(new URL('../server/dist/',import.meta.url),d+'/server/dist',{recursive:true});
  await cp(new URL('../server/package.json',import.meta.url),d+'/server/package.json');
  await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),d+'/node_modules','dir');
  const prompt='Round trip test', reply='Local fixture reply';
  const requests=[];
  let unavailable=true;
  const mock=createServer(async(req,res)=>{
    let body=''; for await(const chunk of req)body+=chunk;
    requests.push({url:req.url,...JSON.parse(body)});
    if(unavailable){res.writeHead(503);res.end("Local model unavailable");return;}
    if (requests.at(-1).tools?.length) {
      res.writeHead(500,{'content-type':'application/json'});
      res.end(JSON.stringify({error:{message:'Cannot use tools with stream'}})); return;
    }
    res.writeHead(200,{'content-type':'text/event-stream'});
    for(const text of ['Local fixture',' reply']) res.write(`data: ${JSON.stringify({choices:[{index:0,delta:{content:text}}]})}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  const modelPort=await listen(mock); t.after(()=>mock.close());
  const holder=createServer(); const port=await listen(holder); await new Promise(r=>holder.close(r));
  const base=`http://127.0.0.1:${port}`;
  let child,exit,cookie='';
  async function stop(){if(child){child.kill();await exit;child=null;}}
  t.after(stop);
  async function start(){
    child=spawn(process.execPath,['server/dist/index.js'],{cwd:d,stdio:'ignore',env:{HOME:d,HOST:'127.0.0.1',PORT:String(port),DB_PATH:d+'/fixture.db',DEV_LOGIN:'1',GROKBOT_NO_SCHEDULER:'1',LLM_PROVIDER:'custom',LLM_BASE_URL:`http://127.0.0.1:${modelPort}/v1`,LLM_MODEL:'fixture'}});
    exit=once(child,'exit'); await until(async()=>{assert.equal(child.exitCode,null);return fetch(base+'/api/health').then(r=>r.ok,()=>false);});
  }
  async function api(path,body){const r=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)});assert.ok(r.ok,`${path}: ${r.status}`);if(path==='/auth/dev')cookie=r.headers.get('set-cookie').split(';')[0];return r.json();}
  await start();await api('/auth/dev',{email:'qa@example.test',name:'QA'});
  const {bot}=await api('/bots',{name:'Fixture'});const path='/bots/'+bot.id;
  const first='Message while local provider is unavailable';
  await api(path+'/messages',{text:first});
  await until(async()=>(await api(path+'/rows')).rows.some(r=>r.kind==='notice' && r.body.tone==='error' && /503/.test(r.body.text)));
  assert.equal(requests.length,4,'one attempt plus three retries');
  unavailable=false;
  await api(path+'/messages',{text:prompt});
  const messages=async()=>(await api(path+'/rows')).rows.filter(r=>r.kind==='message').map(r=>[r.body.role,r.body.text]);
  const expected=[['user',first],['user',prompt],['assistant',reply]];
  await until(async()=>(await messages()).some(([role,text])=>role==='assistant'&&text===reply));
  assert.deepEqual(await messages(),expected);
  assert.deepEqual(requests.slice(4).map(r=>Boolean(r.tools?.length)),[true,false]);
  assert.ok(requests.some(r=>r.url==='/v1/chat/completions'&&r.stream&&r.messages.some(m=>m.role==='user'&&m.content===prompt)));
  await stop();await start();assert.deepEqual(await messages(),expected);
});
