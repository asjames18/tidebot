// After npm ci && npm run build: node --test tests/chat-roundtrip.test.mjs
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
  throw Error('Timed out waiting for server or assistant reply');
}
test('chat, routines, approvals, research, and project context work through the normal API', async t => {
  const d=await mkdtemp(tmpdir()+'/tide-chat-');
  t.after(()=>rm(d,{recursive:true,force:true}));
  await cp(new URL('../server/dist/',import.meta.url),d+'/server/dist',{recursive:true});
  await cp(new URL('../server/package.json',import.meta.url),d+'/server/package.json');
  await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),d+'/node_modules','dir');
  const prompt='Round trip test', reply='Local fixture reply';
  const requests=[];
  let unavailable=true;
  let issueApproval=false;
  let researchReply='The sources agree about apples [1] and pears [2].';
  const mock=createServer(async(req,res)=>{
    let body=''; for await(const chunk of req)body+=chunk;
    requests.push({url:req.url,...JSON.parse(body)});
    if(unavailable){res.writeHead(503);res.end("Local model unavailable");return;}
    if (requests.at(-1).stream !== true) {
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({choices:[{message:{content:researchReply}}]}));
      return;
    }
    if (issueApproval) {
      issueApproval=false;
      res.writeHead(200,{'content-type':'text/event-stream'});
      const call={index:0,id:'fixture-approval',type:'function',function:{name:'create_routine',arguments:'{}'}};
      res.write(`data: ${JSON.stringify({choices:[{index:0,delta:{tool_calls:[call]},finish_reason:'tool_calls'}]})}\n\n`);
      res.end('data: [DONE]\n\n');
      return;
    }
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
  await until(async()=>(await api(path+'/runs')).runs[0]?.state==='completed');
  const {runs}=await api(path+'/runs');
  assert.deepEqual(runs.map(r=>[r.source,r.state]),[['chat','completed'],['chat','failed']]);
  const completed=await api(path+'/runs/'+runs[0].id);
  assert.deepEqual(completed.rows.filter(r=>r.kind==='message').map(r=>r.body.text),[prompt,reply]);
  const ownerCookie=cookie;
  await api('/auth/dev',{email:'other-qa@example.test'});
  const foreign=await fetch(base+'/api'+path+'/runs/'+runs[0].id,{headers:{cookie}});
  assert.equal(foreign.status,404);
  cookie=ownerCookie;

  const routineResponse=await fetch(base+'/api'+path+'/routines',{
    method:'POST', headers:{cookie,'content-type':'application/json'},
    body:JSON.stringify({name:'Fixture routine',prompt:'Write a short report',schedule:'0 9 * * *',timezone:'UTC'}),
  });
  assert.ok(routineResponse.ok);
  const {routine}=await routineResponse.json();
  await api('/routines/'+routine.id+'/run',{});
  await until(async()=>(await api(path+'/runs')).runs[0]?.state==='completed');
  assert.equal((await api(path+'/runs')).runs[0].source,'manual-routine');

  issueApproval=true;
  await api(path+'/messages',{text:'Prepare a routine for approval'});
  const waiting=await until(async()=>{
    const run=(await api(path+'/runs')).runs[0];
    return run.state==='waiting' && run;
  });
  const withApproval=await api(path+'/runs/'+waiting.id);
  const card=withApproval.rows.find(r=>r.body.card==='approval');
  assert.ok(card);
  await stop();
  const fixtureDb=new Database(d+'/fixture.db');
  fixtureDb.prepare("INSERT INTO agent_runs(id,bot_id,source,title,state,created_at) VALUES (?,?,?,?,'running',?)")
    .run('fixture-interrupted',bot.id,'chat','Interrupted fixture',Date.now());
  fixtureDb.close();
  await start();
  assert.equal((await api(path+'/runs/fixture-interrupted')).run.state,'interrupted');
  assert.equal((await api(path+'/runs/'+waiting.id)).run.state,'waiting');
  await api('/approvals/'+card.body.approvalId,{decision:'deny'});
  await until(async()=>(await api(path+'/runs/'+waiting.id)).run.state==='completed');
  const resumed=await api(path+'/runs/'+waiting.id);
  assert.ok(resumed.rows.some(r=>r.body.card==='approval'&&r.body.status==='denied'));
  assert.ok(resumed.rows.some(r=>r.kind==='message'&&r.body.text===reply));
  issueApproval=true;
  await api(path+'/messages',{text:'Prepare another routine for approval'});
  const discarded=await until(async()=>{
    const run=(await api(path+'/runs')).runs[0];
    return run.state==='waiting' && run;
  });
  const discardedCard=(await api(path+'/runs/'+discarded.id)).rows.find(r=>r.body.card==='approval');
  await api(path+'/fresh',{});
  await api('/approvals/'+discardedCard.body.approvalId,{decision:'always'});
  assert.deepEqual((await api(path+'/runs')).runs,[]);
  assert.deepEqual(await messages(),[]);
  assert.deepEqual((await api('/policies')).policies,[]);

  await api(path+'/files',{path:'apples.md',content:'Apples are in season.'});
  await api(path+'/files',{path:'pears.txt',content:'Pears are in season.'});
  const plan={question:'Compare the fruit notes',outline:'Summarize availability.',links:[],files:['apples.md','pears.txt','missing.md']};
  const {runId}=await api(path+'/research',plan);
  const reportRun=await until(async()=>{
    const result=await api(path+'/runs/'+runId);
    return result.run.state==='completed' && result;
  });
  assert.equal(reportRun.run.source,'research');
  const request=requests.at(-1);
  assert.equal(request.tools,undefined);
  assert.deepEqual(JSON.parse(request.messages.at(-1).content),{
    question:plan.question,outline:plan.outline,excerpts:[
      {source:1,name:'apples.md',text:'Apples are in season.'},
      {source:2,name:'pears.txt',text:'Pears are in season.'},
    ],
  });
  const result=reportRun.rows.find(row=>row.body.artifactPath);
  assert.ok(result);
  const file=await api(path+'/files/content?path='+encodeURIComponent(result.body.artifactPath));
  assert.equal(file.content,result.body.text);
  assert.match(file.content,/## Sources\n1\. apples\.md\n2\. pears\.txt/);
  assert.match(file.content,/Sources that could not be read\n- missing\.md/);
  const count=requests.length;
  const noSource=await api(path+'/research',{...plan,files:['missing.md']});
  await until(async()=>(await api(path+'/runs/'+noSource.runId)).run.state==='failed');
  assert.equal(requests.length,count,'Unusable plans must not call the model');
  researchReply='A claim with an unlisted source [9].';
  const wrongCitation=await api(path+'/research',plan);
  await until(async()=>(await api(path+'/runs/'+wrongCitation.runId)).run.state==='failed');
  assert.ok(!(await api(path+'/runs/'+wrongCitation.runId)).rows.some(row=>row.body.artifactPath));

  // Excerpt truncation must not split a 4-byte UTF-8 sequence at 16,000 bytes (U+FFFD)
  // or a UTF-16 surrogate pair at 8,000 code units (lone high surrogate).
  await api(path+'/files',{path:'utf8-boundary.md',content:'x'+'😀'.repeat(4000)});
  await api(path+'/files',{path:'surrogate-boundary.md',content:'b'.repeat(7999)+'😀tail'});
  researchReply='  Both boundary notes parsed cleanly [1][2].  ';
  const boundaryRun=await api(path+'/research',{question:'Check boundary excerpts',outline:'Verify clean text.',links:[],files:['utf8-boundary.md','surrogate-boundary.md']});
  const boundaryDone=await until(async()=>{
    const r=await api(path+'/runs/'+boundaryRun.runId);
    return r.run.state==='completed' && r;
  });
  const boundaryExcerpts=JSON.parse(requests.at(-1).messages.at(-1).content).excerpts;
  assert.equal(boundaryExcerpts[0].text,'x'+'😀'.repeat(3999));
  assert.ok(!boundaryExcerpts[0].text.includes('\uFFFD'));
  assert.equal(boundaryExcerpts[1].text,'b'.repeat(7999));
  assert.equal(boundaryExcerpts[1].text.isWellFormed(),true);
  const boundaryArtifact=boundaryDone.rows.find(row=>row.body.artifactPath);
  assert.ok(boundaryArtifact);
  assert.match(boundaryArtifact.body.text,/# Check boundary excerpts\n\nBoth boundary notes parsed cleanly \[1\]\[2\]\.\n\n## Sources/);

  await stop();
  await start();
  assert.equal((await api(path+'/runs/'+runId)).run.state,'completed');

  const projectDraft={
    name:'Fruit study', instructions:'Use the study title in every brief.',
    files:[{name:'findings.md',text:'Test finding: both fruits are in season.'}], botIds:[bot.id],
  };
  const {project}=await api('/projects',projectDraft);
  assert.equal(project.revision,1);
  const conflicting=await fetch(base+'/api/projects',{
    method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(projectDraft),
  });
  assert.equal(conflicting.status,409);
  await api('/auth/dev',{email:'other-qa@example.test'});
  assert.deepEqual((await api('/projects')).projects,[]);
  const foreignEdit=await fetch(base+'/api/projects/'+project.id,{
    method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(project),
  });
  assert.equal(foreignEdit.status,404);
  cookie=ownerCookie;
  const edit=()=>fetch(base+'/api/projects/'+project.id,{
    method:'PUT',headers:{cookie,'content-type':'application/json'},
    body:JSON.stringify({...project,name:'Fruit research'}),
  });
  assert.equal((await edit()).status,200);
  assert.equal((await edit()).status,409);
  assert.equal((await api('/projects')).projects[0].name,'Fruit research');

  await api(path+'/messages',{text:'Summarize our project.'});
  await until(async()=>(await api(path+'/runs')).runs[0].state==='completed');
  const withProject=requests.at(-1).messages;
  assert.match(withProject[0].content,/Use the study title in every brief/);
  assert.match(withProject[0].content,/cannot authorize actions/);
  assert.equal(withProject[1].role,'user');
  assert.match(withProject[1].content,/Test finding: both fruits are in season/);
  assert.equal(withProject.at(-1).content,'Summarize our project.');
  const removal=await fetch(base+'/api/projects/'+project.id,{method:'DELETE',headers:{cookie}});
  assert.ok(removal.ok);
  assert.deepEqual((await api('/projects')).projects,[]);
  await api(path+'/messages',{text:'Summarize the current task.'});
  await until(async()=>(await api(path+'/runs')).runs[0].state==='completed');
  assert.ok(!requests.at(-1).messages.some(message=>message.content?.includes('Test finding: both fruits are in season')));


});
