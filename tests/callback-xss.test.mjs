// After npm ci && npm run build: node --test tests/callback-xss.test.mjs
// Regression test for issue #1 / GHSA-hcr8-63c2-jp89: reflected XSS in
// /api/apps/callback via an unvalidated slug interpolated into an inline <script>.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,cp,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';

test('apps callback rejects hostile slugs and never reflects them into the page', async t => {
  const d=await mkdtemp(tmpdir()+'/tide-xss-');
  t.after(()=>rm(d,{recursive:true,force:true}));
  await cp(new URL('../server/dist/',import.meta.url),d+'/server/dist',{recursive:true});
  await cp(new URL('../server/package.json',import.meta.url),d+'/server/package.json');
  await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),d+'/node_modules','dir');
  const holder=createServer(); holder.listen(0,'127.0.0.1'); await once(holder,'listening');
  const port=holder.address().port; await new Promise(r=>holder.close(r));
  const child=spawn(process.execPath,['server/dist/index.js'],{cwd:d,stdio:'ignore',env:{HOME:d,HOST:'127.0.0.1',PORT:String(port),DB_PATH:d+'/fixture.db',DEV_LOGIN:'1',GROKBOT_NO_SCHEDULER:'1'}});
  t.after(()=>{child.kill();});
  const base=`http://127.0.0.1:${port}`;
  let up=false; for(let i=0;i<250&&!up;i++){up=await fetch(base+'/api/health').then(r=>r.ok,()=>false);if(!up)await sleep(100);}
  assert.ok(up,'server started');

  // Hostile slug closing the script tag: rejected with 400, never reflected.
  const evil='/api/apps/callback?slug='+encodeURIComponent('</script><script>alert(1)</script>');
  const bad=await fetch(base+evil);
  assert.equal(bad.status,400,'hostile slug rejected with 400');
  assert.ok(!(await bad.text()).includes('<script>alert'),'no attacker script in response body');

  // Other non-slug characters are rejected too.
  for (const s of ['../../etc','a b','x'.repeat(65),'\u2028','github;drop']) {
    const r=await fetch(base+'/api/apps/callback?slug='+encodeURIComponent(s));
    assert.equal(r.status,400,`slug ${JSON.stringify(s)} rejected`);
  }

  // A legitimate slug still completes the flow with a 200 page.
  const good=await fetch(base+'/api/apps/callback?slug=github');
  assert.equal(good.status,200);
  const body=await good.text();
  assert.ok(body.includes('github'),'legit slug present');
  assert.ok(!body.includes('</script><script'),'inline script cannot be terminated early');
});
