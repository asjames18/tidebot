// After npm ci && npm run build: node --test tests/auth-purge.test.mjs
// Expired sign-in sessions and abandoned Google sign-in attempts are removed at startup; live ones are kept.
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

test('startup purges expired sessions and stale login attempts only', async t => {
  const d=await mkdtemp(tmpdir()+'/tide-purge-');
  t.after(()=>rm(d,{recursive:true,force:true}));
  await cp(new URL('../server/dist/',import.meta.url),d+'/server/dist',{recursive:true});
  await cp(new URL('../server/package.json',import.meta.url),d+'/server/package.json');
  await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),d+'/node_modules','dir');
  const holder=createServer(); const port=await listen(holder); await new Promise(r=>holder.close(r));
  const base=`http://127.0.0.1:${port}`;
  let child,exit;
  async function stop(){if(child){child.kill();await exit;child=null;}}
  t.after(stop);
  async function start(){
    child=spawn(process.execPath,['server/dist/index.js'],{cwd:d,stdio:'ignore',env:{HOME:d,HOST:'127.0.0.1',PORT:String(port),DB_PATH:d+'/fixture.db',DEV_LOGIN:'1',GROKBOT_NO_SCHEDULER:'1',LLM_PROVIDER:'custom',LLM_BASE_URL:'http://127.0.0.1:9/v1',LLM_MODEL:'fixture'}});
    exit=once(child,'exit'); await until(async()=>{assert.equal(child.exitCode,null);return fetch(base+'/api/health').then(r=>r.ok,()=>false);});
  }
  await start();
  const login=await fetch(base+'/api/auth/dev',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'qa@example.test',name:'QA'})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  await stop();
  const db=new Database(d+'/fixture.db');
  const user=db.prepare('SELECT id FROM users').get().id;
  const now=Date.now();
  const ins=db.prepare('INSERT INTO auth_sessions(token,user_id,created_at,expires_at,verified) VALUES (?,?,?,?,0)');
  ins.run('expired-1',user,now-9e9,now-1000);
  ins.run('expired-2',user,now-9e9,now-86400000);
  const att=db.prepare('INSERT INTO login_attempts(id,provisional_user_id,connected_account_id,created_at) VALUES (?,?,?,?)');
  att.run('old-attempt','u1','c1',now-2*3600*1000);
  att.run('fresh-attempt','u2','c2',now-60*1000);
  db.close();
  await start();
  const after=new Database(d+'/fixture.db',{readonly:true});
  assert.deepEqual(after.prepare('SELECT token FROM auth_sessions WHERE token LIKE ?').all('expired-%'),[]);
  assert.deepEqual(after.prepare('SELECT id FROM login_attempts').all().map(r=>r.id),['fresh-attempt']);
  assert.equal(after.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n,1,'the live session stays');
  after.close();
  const me=await fetch(base+'/api/bots',{headers:{cookie}});
  assert.equal(me.status,200,'the live session still works');
});
