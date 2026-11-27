// After npm ci && npm run build: node --test tests/screen-lease-race.test.mjs
// screenFor() leases one Orgo screen per bot. Concurrent calls for one user must not lease the
// same screen to two bots, a failed call must not block later ones, and users must not wait on each other.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';

const d=await mkdtemp(tmpdir()+'/tide-lease-');
process.env.DB_PATH=d+'/fixture.db'; process.env.HOME=d; process.env.GROKBOT_NO_SCHEDULER='1';

// Mocked Orgo: computer c1 (user u1) starts with 3 screens, c2 (user u2) with 2.
const screens={c1:[{id:'default'},{id:'screen-2'},{id:'screen-3'}],c2:[{id:'default'},{id:'screen-2'}]};
const listDelay={c1:20,c2:20};
let failNextList=false;
const j=o=>new Response(JSON.stringify(o),{status:200,headers:{'content-type':'application/json'}});
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>{
  const m=String(url).replace('https://www.orgo.ai/api','').match(/^\/computers\/(c\d)(\/.*)?$/);
  if(!m) return j({});
  const c=m[1], rest=m[2]??'';
  if(rest===''&&init.method==='GET') return j({id:c,status:'running'});
  if(rest==='/screens'&&init.method==='GET'){
    await new Promise(r=>setTimeout(r,listDelay[c]));
    if(failNextList){failNextList=false;return new Response('boom',{status:500});}
    return j({screens:screens[c]});
  }
  if(rest.startsWith('/screens/')&&init.method==='GET') return j({id:rest.split('/').pop()});
  if(rest==='/screens'&&init.method==='POST'){const id='screen-'+(screens[c].length+1);screens[c].push({id});return j({id});}
  if(rest.endsWith('/bash')) return j({success:true,output:'',exit_code:0});
  return j({});
};
test.after(async()=>{globalThis.fetch=realFetch;await rm(d,{recursive:true,force:true});});

const {db,now}=await import('../server/dist/db.js');
const {screenFor}=await import('../server/dist/computer.js');
for (const [u,c] of [['u1','c1'],['u2','c2']]) {
  db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run(u,u+'@example.test',u,now());
  db.prepare("INSERT INTO computers(user_id,status,orgo_id,updated_at) VALUES (?,'running',?,?)").run(u,c,now());
}
const addBot=(id,u)=>db.prepare('INSERT INTO bots(id,user_id,name,created_at,updated_at) VALUES (?,?,?,?,?)').run(id,u,id,now(),now());
['b1','b2','b3','b4','b5','b6'].forEach(b=>addBot(b,'u1'));
['c1','c2'].forEach(b=>addBot(b,'u2'));
const rowsFor=u=>db.prepare('SELECT bot_id,screen_id FROM screens WHERE user_id=? ORDER BY bot_id').all(u);

test('concurrent leases for one user get distinct screens and a bot keeps its own', async () => {
  const [r1,r2,r3,r1again]=await Promise.all([screenFor('u1','b1'),screenFor('u1','b2'),screenFor('u1','b3'),screenFor('u1','b1')]);
  const ids=[r1.screenId,r2.screenId,r3.screenId];
  assert.equal(new Set(ids).size,3,'three bots lease three different screens: '+ids.join(','));
  assert.equal(r1again.screenId,r1.screenId,'the same bot keeps its screen');
  assert.equal(rowsFor('u1').length,3);
});

test('a bot that asks again reuses its screen, and gets one again after its lease is released', async () => {
  const first=await screenFor('u1','b2');
  const second=await screenFor('u1','b2');
  assert.equal(second.screenId,first.screenId);
  db.prepare('DELETE FROM screens WHERE bot_id=?').run('b2');
  const again=await screenFor('u1','b2');
  assert.ok(again.screenId,'released bot leases a screen again');
  assert.equal(new Set(rowsFor('u1').map(r=>r.screen_id)).size,rowsFor('u1').length,'no screen is shared');
});

test('when every screen is leased, concurrent new bots still get distinct screens', async () => {
  await Promise.all([screenFor('u1','b4'),screenFor('u1','b5'),screenFor('u1','b6')]);
  const rows=rowsFor('u1');
  assert.ok(rows.length<=4,'at most 4 screens are leased: '+rows.length);
  assert.equal(new Set(rows.map(r=>r.screen_id)).size,rows.length,'no two bots share a screen');
  for (const b of ['b4','b5','b6']) assert.ok(rows.some(r=>r.bot_id===b),b+' holds a lease');
});

test('a failed lease call rejects only itself and does not block later calls', async () => {
  db.prepare('DELETE FROM screens WHERE user_id=?').run('u1');
  failNextList=true;
  const [a,b]=await Promise.allSettled([screenFor('u1','b1'),screenFor('u1','b2')]);
  assert.equal(a.status,'rejected','the call that hit the Orgo error rejects');
  assert.equal(b.status,'fulfilled','the call queued behind it still succeeds');
  const retry=await screenFor('u1','b1');
  assert.ok(retry.screenId,'the failed bot can lease on retry');
  assert.notEqual(retry.screenId,b.value.screenId);
});

test('a slow lease for one user does not delay another user', async () => {
  db.prepare('DELETE FROM screens').run();
  listDelay.c1=600;
  const t0=Date.now();
  const slow=screenFor('u1','b1');
  await screenFor('u2','c1');
  const elapsed=Date.now()-t0;
  await slow;
  listDelay.c1=20;
  assert.ok(elapsed<400,'other user finished in '+elapsed+' ms while the first lease took about 600 ms');
});
