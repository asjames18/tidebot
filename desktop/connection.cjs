const MAX_PROBE_BYTES = 4096;
const DEFAULT_PROBE_TIMEOUT_MS = 5000;

function isJsonContentType(header) {
  if (typeof header !== 'string') return false;
  return header.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

function serverOrigin(address) {
  if (typeof address !== 'string' || address.length > 2048) throw new Error('Enter a server address.');
  const trimmed = address.trim();
  if (!trimmed) throw new Error('Enter a server address.');
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    throw new Error('Enter a full server address, such as https://tidebot.example.com.');
  }
  let url;
  try { url = new URL(trimmed); }
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

async function checkServer(address, options = {}) {
  const origin = serverOrigin(address);
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_PROBE_TIMEOUT_MS;
  let response;
  try {
    response = await fetch(new URL('/api/desktop', origin), {
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new Error('Could not connect. Check the address, the server, and its HTTPS certificate.');
  }
  if (!response.ok || !isJsonContentType(response.headers.get('content-type'))) {
    await response.body?.cancel().catch(() => {});
    throw new Error('This address did not respond as a compatible TideBot server.');
  }
  const chunks = [];
  let totalBytes = 0;
  try {
    for await (const chunk of response.body ?? []) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.byteLength;
      if (totalBytes > MAX_PROBE_BYTES) {
        await response.body?.cancel().catch(() => {});
        throw new Error('The server returned an invalid connection response.');
      }
      chunks.push(buf);
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'The server returned an invalid connection response.') {
      throw error;
    }
    throw new Error('Could not connect. Check the address, the server, and its HTTPS certificate.');
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks, totalBytes).toString('utf8')); } catch { /* failed the compatibility check */ }
  if (data?.application !== 'tidebot' || data.apiVersion !== 1 || data.web !== true) {
    throw new Error('This address did not respond as a compatible TideBot server.');
  }
  return origin;
}

module.exports = { checkServer, isJsonContentType, serverOrigin };
