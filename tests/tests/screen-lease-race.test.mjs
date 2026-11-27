// After npm ci && npm run build: node --test tests/screen-lease-race.test.mjs
// Concurrent screenFor() calls for one user must not lease the same Orgo screen to two bots.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';

test('concurrent screen leases for one user get distinct screens', async t => {
  const d=await mkdtemp(tmpdir()+'/tide-lease-');
  t.after(()=>rm(d,{recursive:true,force:true}));
  process.env.DB_PATH=d+'/fixture.db'; process.env.HOME=d; process.env.GROKBOT_NO_SCHEDULER='1';
  const screens=[{id:'default',default:true},{id:'screen-2'},{id:'screen-3'}];
  const realFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=realFetch;});
  globalThis.fetch=async(url,init)=>{
    const u=String(url).replace('https://www.orgo.ai/api','');
    const j=o=>new Response(JSON.stringify(o),{status:200,headers:{'content-type':'application/json'}});
    await new Promise(r=>setTimeout(r,20));
    if(u==='/computers/c1') return j({id:'c1',status:'running'});
    if(u==='/computers/c1/screens'&&init.method==='GET') return j({screens});
    if(u.startsWith('/computers/c1/screens/')&&init.method==='GET') return j({id:u.split('/').pop()});
    if(u==='/computers/c1/screens'&&init.method==='POST'){const id='screen-'+(screens.length+1);screens.push({id});return j({id});}
    if(u.endsWith('/bash')) return j({success:true,output:'',exit_code:0});
    return j({});
  };
  const {db,now}=await import('../server/dist/db.js');
  const {screenFor}=await import('../server/dist/computer.js');
  db.prepare("INSERT INTO users(id,email,name,created_at) VALUES ('u1','a@example.test','a',?)").run(now());
  db.prepare("INSERT INTO computers(user_id,status,orgo_id,updated_at) VALUES ('u1','running','c1',?)").run(now());
  for (const b of ['b1','b2','b3']) db.prepare('INSERT INTO bots(id,user_id,name,created_at,updated_at) VALUES (?,?,?,?,?)').run(b,'u1',b,now(),now());

  const [r1,r2,r3,r1again]=await Promise.all([screenFor('u1','b1'),screenFor('u1','b2'),screenFor('u1','b3'),screenFor('u1','b1')]);
  const ids=[r1.screenId,r2.screenId,r3.screenId];
  assert.equal(new Set(ids).size,3,'three bots lease three different screens: '+ids.join(','));
  assert.equal(r1again.screenId,r1.screenId,'the same bot keeps its screen');
  const rows=db.prepare('SELECT bot_id,screen_id FROM screens').all();
  assert.equal(rows.length,3);
  assert.equal(new Set(rows.map(r=>r.screen_id)).size,3);
});
