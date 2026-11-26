// Test runner: reads the test-file lists from tests/node-tests.txt and
// tests/tsx-tests.txt and runs each group with its own runner.
//
// Why lists in files instead of one long line in package.json: every PR
// that adds a test used to edit the same single line of the "test" script,
// so parallel PRs conflicted on that line over and over (six merge commits
// in one morning, 2026-11-26). Adding a test now means appending one line
// to the right list file; the package.json line never changes.
//
// The runner also fails loudly in two cases that used to fail silently:
//  - a listed file does not exist (typo in a list), and
//  - a tests/*.test.mjs file is listed in neither file (a new test that
//    would otherwise never run).
// Run from the repo root: `node scripts/run-tests.mjs` (or `npm test`,
// which builds first and then calls this).

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readList(name) {
  const path = join(root, "tests", name);
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

const nodeTests = readList("node-tests.txt");
const tsxTests = readList("tsx-tests.txt");

const missing = [...nodeTests, ...tsxTests].filter(
  (file) => !existsSync(join(root, file)),
);
if (missing.length > 0) {
  console.error(`run-tests: listed test file(s) not found:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}

const onDisk = readdirSync(join(root, "tests")).filter((f) =>
  f.endsWith(".test.mjs"),
);
const listed = new Set(
  [...nodeTests, ...tsxTests].map((file) => file.replace(/^tests\//, "")),
);
const unlisted = onDisk.filter((file) => !listed.has(file));
if (unlisted.length > 0) {
  console.error(
    `run-tests: test file(s) exist but are listed in neither tests/node-tests.txt nor tests/tsx-tests.txt:\n  ${unlisted.join("\n  ")}\nAdd each to the right list (node runner, or tsx runner for .tsx imports).`,
  );
  process.exit(1);
}

function run(label, command, args, fileCount) {
  console.log(`\n=== ${label} (${fileCount} files) ===`);
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) {
    console.error(`run-tests: failed to start ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status);
}

// tsx ships in a workspace's node_modules/.bin; prefer the repo-local one
// so the runner works even when run outside `npm test`.
const tsxBin = existsSync(join(root, "node_modules", ".bin", "tsx"))
  ? join(root, "node_modules", ".bin", "tsx")
  : "tsx";

run("node tests", "node", ["--test", ...nodeTests], nodeTests.length);
run("tsx tests", tsxBin, [
  "--tsconfig",
  "web/tsconfig.json",
  "--test",
  ...tsxTests,
], tsxTests.length);
console.log("\nrun-tests: all test groups passed");
