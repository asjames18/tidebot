const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

module.exports = async function checkServerBundle({ appOutDir, packager }) {
  const server = path.join(packager.getResourcesDir(appOutDir), 'server');
  const entry = path.join(server, 'dist', 'index.js');
  if (!fs.existsSync(entry)) throw new Error('Packaged TideBot server entry is missing');

  const manifest = JSON.parse(fs.readFileSync(path.join(server, 'package.json'), 'utf8'));
  const resolve = createRequire(entry).resolve;
  const dependencies = path.join(server, 'node_modules') + path.sep;
  for (const name of Object.keys(manifest.dependencies)) {
    try {
      if (fs.realpathSync(resolve(name)).startsWith(fs.realpathSync(dependencies) + path.sep)) continue;
    } catch (error) {
      throw new Error(`Packaged TideBot server dependency is missing: ${name}`, { cause: error });
    }
    throw new Error(`Packaged TideBot server dependency resolves outside the bundle: ${name}`);
  }
};
