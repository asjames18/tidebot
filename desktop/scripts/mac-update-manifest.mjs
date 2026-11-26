import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const [version, intel, apple, output] = process.argv.slice(2);
if (!version || !intel || !apple || !output) {
  throw new Error('Usage: mac-update-manifest.mjs <version> <intel directory> <Apple Silicon directory> <output>');
}

const prefix = `TideBot-${version}`;
const assets = [
  join(intel, `${prefix}-mac.zip`),
  join(apple, `${prefix}-arm64-mac.zip`),
  join(intel, `${prefix}.dmg`),
  join(apple, `${prefix}-arm64.dmg`),
];
const files = await Promise.all(assets.map(async (file) => {
  const hash = createHash('sha512');
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    size += chunk.length;
  }
  if (!size) throw new Error(`Empty release asset: ${file}`);
  return { url: basename(file), sha512: hash.digest('base64'), size };
}));

// JSON is valid YAML and keeps this release step free of parser dependencies.
await writeFile(output, JSON.stringify({
  version, files, path: files[0].url, sha512: files[0].sha512, releaseDate: new Date().toISOString(),
}, null, 2) + '\n');
