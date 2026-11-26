const address = document.getElementById('address');
const local = document.getElementById('local');
const remote = document.getElementById('remote');
const connect = document.getElementById('connect');
const status = document.getElementById('status');

function showStatus(message, error = false) {
  status.textContent = message;
  status.toggleAttribute('data-error', error);
}

async function connectTo(server) {
  local.disabled = connect.disabled = address.disabled = true;
  showStatus(server ? 'Checking the server…' : 'Starting TideBot…');
  try {
    const result = await window.tidebotConnection.connect(server);
    if (result.error) showStatus(result.error, true);
  } catch {
    showStatus('Could not open TideBot. Try again.', true);
  } finally {
    local.disabled = connect.disabled = address.disabled = false;
  }
}

local.addEventListener('click', () => void connectTo(null));
remote.addEventListener('submit', (event) => {
  event.preventDefault();
  void connectTo(address.value);
});

window.tidebotConnection.settings().then(({ origin, error }) => {
  // Keep anything the user has started typing while initial settings load.
  if (!address.value && origin) address.value = origin;
  if (error) showStatus(error, true);
});
