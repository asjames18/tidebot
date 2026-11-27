// After npm ci && npm run build: node --test tests/card-action-idempotency.test.mjs
// Draft approvals and question answers must apply once, even when requests repeat or overlap.
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
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
  throw Error('Timed out');
}

test('draft approvals and question answers are applied once under repeat and concurrent requests', async t => {
  const d=await mkdtemp(tmpdir()+'/tide-card-');
  t.after(()=>rm(d,{recursive:true,force:true}));
  await cp(new URL('../server/dist/',import.meta.url),d+'/server/dist',{recursive:true});
  await cp(new URL('../server/package.json',import.meta.url),d+'/server/package.json');
  await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),d+'/node_modules','dir');
  const prompts=[];
  const mock=createServer(async(req,res)=>{
    let body=''; for await(const chunk of req)body+=chunk;
    const j=JSON.parse(body);
    prompts.push(JSON.stringify(j.messages??''));
    if(j.stream!==true){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'ok'}}]}));return;}
    res.writeHead(200,{'content-type':'text/event-stream'});
    res.write(`data: ${JSON.stringify({choices:[{index:0,delta:{content:'ok'}}]})}\n\n`);
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
  const call=(path,body)=>fetch(base+'/api'+path,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)});
  await start();
  cookie=(await call('/auth/dev',{email:'qa@example.test',name:'QA'})).headers.get('set-cookie').split(';')[0];
  const {bot}=await (await call('/bots',{name:'Fixture'})).json();
  await stop();
  // Seed cards directly: three drafts and three questions, all pending.
  const db=new Database(d+'/fixture.db');
  const b=db.prepare('SELECT generation, next_seq FROM bots WHERE id=?').get(bot.id);
  const seqs={};
  let seq=b.next_seq;
  const seed=(name,body)=>{db.prepare('INSERT INTO rows(bot_id,generation,seq,updated_seq,kind,body,created_at) VALUES (?,?,?,?,?,?,?)').run(bot.id,b.generation,seq,seq,'card',JSON.stringify(body),Date.now());seqs[name]=seq++;};
  for(const n of ['seq','race']) seed('draft-'+n,{type:'card',card:'draft',channel:'email',to:'a@example.test',subject:'Subj '+n,text:'hi',approvalId:'drf_'+n,status:'pending'});
  for(const n of ['seq','race']) seed('q-'+n,{type:'card',card:'question',question:'Q '+n+'?',options:[],status:'pending'});
  db.prepare('UPDATE bots SET next_seq=? WHERE id=?').run(seq,bot.id);
  db.close();
  await start();
  const rows=async()=>(await (await fetch(base+'/api/bots/'+bot.id+'/rows',{headers:{cookie}})).json()).rows;
  const card=async name=>(await rows()).find(r=>r.seq===seqs[name]).body;
  const count=s=>prompts.filter(p=>p.includes(s)).length;
  const settle=()=>sleep(1500);

  // Sequential: allow, then deny and allow again. Only the first applies.
  assert.equal((await call('/approvals/drf_seq',{decision:'allow'})).status,200);
  assert.equal((await call('/approvals/drf_seq',{decision:'deny'})).status,409);
  assert.equal((await call('/approvals/drf_seq',{decision:'allow'})).status,409);
  await settle();
  assert.equal((await card('draft-seq')).status,'sent');
  assert.equal(count('Subj seq'),1,'one approved-draft turn');

  // Concurrent: mixed decisions race. Exactly one wins and the stored status matches it.
  const decisions=['allow','deny','always','allow','deny'];
  const results=await Promise.all(decisions.map(decision=>call('/approvals/drf_race',{decision})));
  const statuses=results.map(r=>r.status);
  assert.equal(statuses.filter(s=>s===200).length,1,JSON.stringify(statuses));
  assert.equal(statuses.filter(s=>s===409).length,decisions.length-1);
  const winner=decisions[statuses.indexOf(200)];
  await settle();
  assert.equal((await card('draft-race')).status,winner==='deny'?'discarded':'sent');
  assert.equal(count('Subj race'),winner==='deny'?0:1);

  // Question answers: sequential repeat.
  const answers=async text=>(await rows()).filter(r=>r.kind==='message'&&r.body.role==='user'&&r.body.text===text).length;
  assert.equal((await call(`/bots/${bot.id}/cards/${seqs['q-seq']}/answer`,{answer:'first'})).status,200);
  assert.equal((await call(`/bots/${bot.id}/cards/${seqs['q-seq']}/answer`,{answer:'second'})).status,409);
  await settle();
  assert.equal(await answers('first'),1);
  assert.equal(await answers('second'),0);
  assert.equal(count('Answer to \\"Q seq?\\"'),1,'one agent turn for the answer');

  // Question answers: concurrent duplicates.
  const answerResults=await Promise.all(['a','b','c','d'].map(answer=>call(`/bots/${bot.id}/cards/${seqs['q-race']}/answer`,{answer})));
  const as=answerResults.map(r=>r.status);
  assert.equal(as.filter(s=>s===200).length,1,JSON.stringify(as));
  assert.equal(as.filter(s=>s===409).length,3);
  await settle();
  const won=['a','b','c','d'][as.indexOf(200)];
  const card2=await card('q-race');
  assert.equal(card2.status,'answered');
  assert.equal(card2.answer,won);
  let total=0; for(const x of ['a','b','c','d']) total+=await answers(x);
  assert.equal(total,1,'one answer message');
  assert.equal(count('Answer to \\"Q race?\\"'),1);
});
