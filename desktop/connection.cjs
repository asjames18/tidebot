function serverOrigin(address) {
  if (typeof address !== 'string' || address.length > 2048) throw new Error('Enter a server address.');
  let url;
  try { url = new URL(address.trim()); }
  catch { throw new Error('Enter a full server address, such as https://tidebot.example.com.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Use HTTPS for a server on another device.');
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Enter only the server address, without a path or sign-in details.');
  }
  return url.origin;
}

async function checkServer(address) {
  const origin = serverOrigin(address);
  let response;
  try {
    response = await fetch(new URL('/api/desktop', origin), {
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new Error('Could not connect. Check the address, the server, and its HTTPS certificate.');
  }
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    await response.body?.cancel();
    throw new Error('This address did not respond as a compatible TideBot server.');
  }
  let raw = '';
  for await (const chunk of response.body ?? []) {
    raw += Buffer.from(chunk).toString('utf8');
    if (raw.length > 4096) throw new Error('The server returned an invalid connection response.');
  }
  let data;
  try { data = JSON.parse(raw); } catch { /* failed the compatibility check */ }
  if (data?.application !== 'tidebot' || data.apiVersion !== 1 || data.web !== true) {
    throw new Error('This address did not respond as a compatible TideBot server.');
  }
  return origin;
}

module.exports = { checkServer, serverOrigin };
