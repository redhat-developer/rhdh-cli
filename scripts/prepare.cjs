/**
 * `prepare` lifecycle: build when `dist/` is missing (git clone, PR via npx/git install).
 * Skip when `dist/` exists (published tarball) so installs from the registry do not rebuild
 * or require devDependency-only tooling.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const distMain = path.join(root, 'dist', 'index.cjs.js');

if (fs.existsSync(distMain)) {
  process.exit(0);
}

const backstageCli = path.join(
  root,
  'node_modules',
  '@backstage',
  'cli',
  'bin',
  'backstage-cli',
);

if (!fs.existsSync(backstageCli)) {
  console.error(
    'prepare: missing node_modules/@backstage/cli — run yarn install before prepare',
  );
  process.exit(1);
}

execFileSync(process.execPath, [backstageCli, 'package', 'build'], {
  stdio: 'inherit',
  cwd: root,
});
