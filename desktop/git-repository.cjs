const { execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const exec = promisify(execFile);
const MAX_OUTPUT = 1024 * 1024;
const MAX_NEW_FILE = 64 * 1024;

async function git(directory, args, { timeout = 10000, allowMissing = false } = {}) {
  // Use the selected repository even when TideBot was launched from inside another Git worktree.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  Object.assign(env, {
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: '',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  });
  try {
    const { stdout } = await exec('git', [
      '-C', directory, '--literal-pathspecs',
      '-c', 'core.fsmonitor=false',
      '-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'),
      '-c', 'core.untrackedCache=false',
      ...args,
    ], { env, timeout, maxBuffer: MAX_OUTPUT, windowsHide: true });
    return stdout;
  } catch (error) {
    if (allowMissing && error.code === 1 && !error.stderr) return '';
    if (error.code === 'ENOENT') throw new Error('Git was not found. Install Git and open TideBot again.');
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new Error('The Git output is too large to display.');
    if (error.killed) throw new Error('Git did not finish in time.');
    throw new Error(String(error.stderr || 'Git could not read this repository.').trim().slice(0, 600));
  }
}

async function openRepository(directory) {
  const canonical = await fs.realpath(directory);
  const top = (await git(canonical, ['rev-parse', '--show-toplevel'])).replace(/\r?\n$/, '');
  if (!top) throw new Error('Choose a folder in a Git working tree.');
  return fs.realpath(top);
}

async function hasFilters(repository, operations) {
  const filters = await git(repository, ['config', '--includes', '--name-only', '--get-regexp',
    `^filter\\..*\\.(${operations})$`], { allowMissing: true });
  return Boolean(filters.trim());
}

async function changes(repository) {
  if (await hasFilters(repository, 'clean|process')) {
    throw new Error('This repository uses Git content filters. Review its changes in your Git client.');
  }
  const output = await git(repository, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=dirty']);
  const fields = output.split('\0');
  const files = [];
  for (let i = 0; i < fields.length - 1; i++) {
    const status = fields[i].slice(0, 2);
    const name = fields[i].slice(3);
    const previous = /[RC]/.test(status) ? fields[++i] : undefined;
    files.push({ name, status, previous });
  }
  return { files: files.slice(0, 500), truncated: files.length > 500 };
}

async function readNewFile(repository, name) {
  const target = path.resolve(repository, name);
  const file = await fs.lstat(target);
  if (!file.isFile()) return { text: '', note: 'This new entry is not a regular file.' };
  const relative = path.relative(repository, await fs.realpath(target));
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    return { text: '', note: 'This file is outside the selected repository.' };
  }
  const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    if (!(await handle.stat()).isFile()) return { text: '', note: 'This new entry is not a regular file.' };
    const buffer = Buffer.alloc(MAX_NEW_FILE + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, Math.min(MAX_NEW_FILE, bytesRead));
    if (bytes.includes(0)) return { text: '', note: 'Binary file.' };
    return { text: bytes.toString('utf8'), note: bytesRead > MAX_NEW_FILE ? 'Showing the first 64 KB.' : '' };
  } finally {
    await handle.close();
  }
}

async function diff(repository, name) {
  const { files } = await changes(repository);
  const file = files.find((entry) => entry.name === name);
  if (!file) throw new Error('This file is no longer in the change list. Refresh to see current changes.');
  if (file.status === '??') return { staged: '', working: '', newFile: await readNewFile(repository, name) };

  const paths = file.previous ? [file.previous, name] : [name];
  const args = ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--submodule=short', '--ignore-submodules=dirty'];
  const [staged, working] = await Promise.all([
    git(repository, [...args, '--cached', '--', ...paths]),
    git(repository, [...args, '--', ...paths]),
  ]);
  return { staged, working };
}

async function createWorktree(repository, parent) {
  const root = await fs.realpath(parent);
  const relative = path.relative(repository, root);
  if (relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))) {
    throw new Error('Choose a folder outside the source repository.');
  }

  // Checkout can run configured content filters. Leave those checkouts to the user's Git client.
  if (await hasFilters(repository, 'clean|smudge|process')) {
    throw new Error('This repository uses checkout filters. Create its worktree with Git and open it here.');
  }
  const leaf = path.basename(repository).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40) || 'repository';
  const suffix = randomUUID().slice(0, 8);
  const branch = `tidebot/${leaf}-${suffix}`;
  const directory = path.join(root, `${leaf}-tidebot-${suffix}`);
  await git(repository, ['worktree', 'add', '-b', branch, '--', directory, 'HEAD'], { timeout: 60000 });
  return directory;
}

module.exports = { openRepository, changes, diff, createWorktree };
