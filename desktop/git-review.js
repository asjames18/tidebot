const api = window.tidebotGitReview;
const choose = document.getElementById('choose');
const refresh = document.getElementById('refresh');
const reveal = document.getElementById('reveal');
const worktree = document.getElementById('worktree');
const locationLabel = document.getElementById('location');
const status = document.getElementById('status');
const files = document.getElementById('files');
const heading = document.getElementById('file');
const output = document.getElementById('output');
let snapshot;
let selected;
let busy = false;

function updateControls() {
  choose.disabled = busy;
  refresh.disabled = reveal.disabled = worktree.disabled = busy || !snapshot;
}

function showStatus(message, error = false) {
  status.textContent = message;
  status.toggleAttribute('data-error', error);
}

async function run(operation, message, success) {
  if (busy) return;
  busy = true;
  updateControls();
  showStatus(message);
  try {
    const { value, error } = await operation();
    if (error) showStatus(error, true);
    else {
      showStatus('');
      success?.(value);
    }
  } catch {
    showStatus('Git Review could not complete this action.', true);
  } finally {
    busy = false;
    updateControls();
  }
}

function fileStatus({ status, previous }) {
  if (status === '??') return 'Untracked';
  const labels = [];
  if (status[0] !== ' ') labels.push('Staged');
  if (status[1] !== ' ') labels.push('Working tree');
  if (previous) labels.push('From ' + previous);
  return labels.join(' · ');
}

function loadList(value) {
  if (!value) return;
  snapshot = value;
  selected = undefined;
  locationLabel.textContent = snapshot.directory;
  heading.textContent = 'Select a file';
  output.replaceChildren();
  files.replaceChildren();
  if (!snapshot.files.length) showStatus('No changes in this working tree.');
  else if (snapshot.truncated) showStatus('Showing the first 500 changed files.');
  for (const file of snapshot.files) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    const detail = document.createElement('span');
    button.type = 'button';
    button.append(file.name, detail);
    detail.textContent = fileStatus(file);
    button.addEventListener('click', () => void run(() => api.diff(file.name), 'Reading changes…', (value) => {
      selected?.removeAttribute('aria-current');
      selected = button;
      button.setAttribute('aria-current', 'true');
      showDiff(file.name, value);
    }));
    item.append(button);
    files.append(item);
  }
}

function showDiff(name, { staged, working, newFile }) {
  heading.textContent = name;
  output.replaceChildren();
  addSection('Staged changes', staged, true);
  addSection('Working tree changes', working, true);
  if (newFile) addSection('New file', newFile.text, false, newFile.note);
  if (!output.childNodes.length) showStatus('Git reported no text diff for this change.');
}

function addSection(label, text, decorate, note) {
  if (!text && !note && label !== 'New file') return;
  const section = document.createElement('section');
  const title = document.createElement('h2');
  title.textContent = label;
  section.append(title);
  if (note) {
    const hint = document.createElement('p');
    hint.textContent = note;
    section.append(hint);
  }
  const result = document.createElement('pre');
  if (decorate) {
    for (const value of text.replace(/\r?\n$/, '').split('\n')) {
      const line = document.createElement('span');
      line.textContent = value || ' ';
      if (value.startsWith('@@')) line.className = 'hunk';
      else if (value.startsWith('+') && !value.startsWith('+++')) line.className = 'add';
      else if (value.startsWith('-') && !value.startsWith('---')) line.className = 'remove';
      result.append(line);
    }
  } else {
    result.textContent = text;
  }
  if (text) section.append(result);
  output.append(section);
}

choose.addEventListener('click', () => void run(api.choose, 'Opening repository…', loadList));
refresh.addEventListener('click', () => void run(api.refresh, 'Refreshing changes…', loadList));
reveal.addEventListener('click', () => void run(api.reveal, 'Opening the folder…'));
worktree.addEventListener('click', () => void run(api.newWorktree, 'Creating a worktree…', (value) => {
  if (!value) return;
  loadList(value);
  showStatus('Opened a new worktree from the source repository’s last commit.');
}));
