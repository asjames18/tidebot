const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

function resolveBundledDependency(resolve, dependenciesDir, name) {
  try {
    return resolve(name);
  } catch (error) {
    if (error && error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
      // ESM-only packages (exports with only "import") reject CJS require.resolve(name).
      // Verify the package manifest exists directly inside the bundled node_modules.
      const manifestPath = path.join(dependenciesDir, ...name.split('/'), 'package.json');
      if (fs.existsSync(manifestPath)) return manifestPath;
      throw new Error(`Packaged TideBot server dependency resolves outside the bundle: ${name}`, { cause: error });
    }
    throw new Error(`Packaged TideBot server dependency is missing: ${name}`, { cause: error });
  }
}

module.exports = async function checkServerBundle({ appOutDir, packager }) {
  const server = path.join(packager.getResourcesDir(appOutDir), 'server');
  const entry = path.join(server, 'dist', 'index.js');
  if (!fs.existsSync(entry)) throw new Error('Packaged TideBot server entry is missing');

  const manifest = JSON.parse(fs.readFileSync(path.join(server, 'package.json'), 'utf8'));
  const depNames = Object.keys(manifest.dependencies ?? {});
  if (depNames.length === 0) return;

  const dependenciesDir = path.join(server, 'node_modules');
  if (!fs.existsSync(dependenciesDir)) throw new Error('Packaged TideBot server node_modules is missing');
  const dependenciesPrefix = fs.realpathSync(dependenciesDir) + path.sep;
  const resolve = createRequire(entry).resolve;

  for (const name of depNames) {
    const resolved = resolveBundledDependency(resolve, dependenciesDir, name);
    if (fs.realpathSync(resolved).startsWith(dependenciesPrefix)) continue;
    throw new Error(`Packaged TideBot server dependency resolves outside the bundle: ${name}`);
  }
};
