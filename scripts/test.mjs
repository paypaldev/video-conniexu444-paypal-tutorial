// ---------------------------------------------------------------------
//  Tests: tests/*.test.ts -> bundled -> node --test
//
//  Bundled through esbuild rather than run directly, for the same reason
//  the app is: the sources import each other with `.js` specifiers that
//  point at `.ts` files, which esbuild resolves and node does not.
//  Reusing the bundler we already depend on beats adding a test runner
//  that needs its own opinion about module resolution.
//
//  Only pure logic is tested here — date arithmetic, streak counting,
//  the maths/currency parser, and the PayPal v6 load/createOrder/
//  onApprove contract. Those are the parts where being wrong is silent:
//  a streak that quietly resets, a word problem that renders as
//  gibberish, or a checkout that still speaks classic Buttons. The
//  paywall chrome is checked by eye against the real app.
// ---------------------------------------------------------------------

import * as esbuild from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = resolve(root, 'tests');
// Outside the repo, and outside node_modules: node --test ignores
// anything under node_modules, and a build directory in the tree would
// only need gitignoring.
const outDir = resolve(tmpdir(), `katsat-tests-${process.pid}`);

const entries = (await readdir(testsDir))
  .filter((name) => name.endsWith('.test.ts'))
  .map((name) => join(testsDir, name));

if (entries.length === 0) {
  console.error('No tests found in tests/');
  process.exit(1);
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await esbuild.build({
  entryPoints: entries,
  outdir: outDir,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  jsx: 'automatic',
  // Dependencies are bundled in, not left as imports: the output lives
  // in a temp directory with no node_modules above it, so an unresolved
  // `react` or `katex` import would fail at run time. Node's own
  // builtins stay external automatically under platform: 'node'.
  logLevel: 'error',
  outExtension: { '.js': '.mjs' },
});

// Explicit files rather than the directory: `node --test <dir>` only
// discovers tests under the working directory, and this output lives in
// the system temp folder.
const built = (await readdir(outDir)).map((name) => join(outDir, name));

const child = spawn(process.execPath, ['--test', ...built], { stdio: 'inherit' });

child.on('exit', async (code) => {
  await rm(outDir, { recursive: true, force: true });
  process.exit(code ?? 1);
});
