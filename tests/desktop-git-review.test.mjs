import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import review from '../desktop/git-repository.cjs';

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'tidebot-git-review-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'Source repository');
  await mkdir(repo);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  const git = (...args) => execFileSync('git', [
    '-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args,
  ], { env, encoding: 'utf8' });
  git('init', '-qb', 'main');
  await writeFile(join(repo, 'tracked.txt'), 'original\n');
  await writeFile(join(repo, 'before.txt'), 'rename fixture\n');
  git('add', '--', 'tracked.txt', 'before.txt');
  git('commit', '-qm', 'Fixture commit');
  return { root, repo, git };
}

test('reviews staged, unstaged, renamed and untracked files without changing Git state', async (t) => {
  const { repo, git } = await fixture(t);
  const child = join(repo, 'sub');
  await mkdir(child);
  assert.equal(await review.openRepository(child), repo);

  await writeFile(join(repo, 'tracked.txt'), 'staged\n');
  git('add', '--', 'tracked.txt');
  await writeFile(join(repo, 'tracked.txt'), 'working tree\n');
  const newName = 'file with spaces [one].txt';
  await writeFile(join(repo, newName), 'new content\n');
  await rename(join(repo, 'before.txt'), join(repo, 'after.txt'));
  git('add', '-A', '--', 'before.txt', 'after.txt');

  const before = git('status', '--porcelain=v1');
  const { files } = await review.changes(repo);
  assert.equal(files.find((file) => file.name === 'tracked.txt').status, 'MM');
  assert.equal(files.find((file) => file.name === 'after.txt').previous, 'before.txt');
  assert.equal(files.find((file) => file.name === newName).status, '??');
  const tracked = await review.diff(repo, 'tracked.txt');
  assert.match(tracked.staged, /-original\r?\n\+staged/);
  assert.match(tracked.working, /-staged\r?\n\+working tree/);
  const renamed = await review.diff(repo, 'after.txt');
  assert.match(renamed.staged, /rename to after\.txt/);
  assert.equal((await review.diff(repo, newName)).newFile.text, 'new content\n');
  await assert.rejects(review.diff(repo, '../outside.txt'), /no longer in the change list/);
  assert.equal(git('status', '--porcelain=v1'), before);
});

test('creates a clean, sibling Git worktree from HEAD while keeping the source changes', async (t) => {
  const { root, repo, git } = await fixture(t);
  const destination = join(root, 'Worktrees');
  await mkdir(destination);
  await writeFile(join(repo, 'tracked.txt'), 'Uncommitted change\n');
  await assert.rejects(review.createWorktree(repo, repo), /outside the source repository/);
  const directory = await review.createWorktree(repo, destination);
  assert.match(basename(directory), /Source-repository-tidebot-/);
  assert.equal(await readFile(join(directory, 'tracked.txt'), 'utf8'), 'original\n');
  assert.equal(await readFile(join(repo, 'tracked.txt'), 'utf8'), 'Uncommitted change\n');
  assert.deepEqual((await review.changes(directory)).files, []);
  assert.equal(git('branch', '--show-current').trim(), 'main');
});

test('leaves operations that may run content filters to the Git client', async (t) => {
  const { root, repo, git } = await fixture(t);
  git('config', 'filter.fixture.smudge', 'cat');
  assert.deepEqual((await review.changes(repo)).files, []);
  await assert.rejects(review.createWorktree(repo, root), /checkout filters/);
  git('config', 'filter.fixture.clean', 'cat');
  await assert.rejects(review.changes(repo), /Git content filters/);
  await assert.rejects(review.diff(repo, 'tracked.txt'), /Git content filters/);
});
