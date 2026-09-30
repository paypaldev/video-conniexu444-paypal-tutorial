// ---------------------------------------------------------------------
//  Build: src/ -> public/
//
//  src/app.ts is bundled into a single public/app.js. Static assets
//  (index.html, styles.css) are copied across untouched.
//
//  Output format is `iife`, not `esm`, so index.html can keep loading it
//  with a plain <script> tag — no type="module", no CORS rules to think
//  about when someone opens the file over file://.
//
//  Everything in public/ is generated. Never edit it by hand; the next
//  build will overwrite you.
// ---------------------------------------------------------------------

import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'src');
const outDir = resolve(root, 'public');

const watch = process.argv.includes('--watch');
const serve = process.argv.includes('--serve');

/** Dev builds are readable and debuggable; production builds are neither. */
const dev = watch || serve;

/** Files and directories copied verbatim from src/ to public/. */
const STATIC_ASSETS = ['index.html', 'styles.css', 'assets'];

async function copyStatic() {
  await mkdir(outDir, { recursive: true });
  for (const name of STATIC_ASSETS) {
    // recursive covers `assets/`; it is ignored for single files.
    await cp(resolve(srcDir, name), resolve(outDir, name), { recursive: true });
  }
}

/** esbuild plugin: re-copy static assets on every rebuild in watch mode. */
const staticAssetsPlugin = {
  name: 'static-assets',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return;
      await copyStatic();
    });
  },
};

const options = {
  entryPoints: [resolve(srcDir, 'main.tsx')],
  outfile: resolve(outDir, 'app.js'),
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
  target: ['es2022'],
  platform: 'browser',
  // Source maps in dev only, never in the deployed build.
  //
  // Not for secrecy — a bundle is reversible either way, and nothing
  // secret is allowed in src/ in the first place (the service role key
  // lives in the Edge Functions, never here). The reason is weight: the
  // map is ~1.4MB, almost all of it bundled dependency source, and no
  // visitor benefits from it.
  sourcemap: dev,
  minify: !dev,
  logLevel: 'info',
  plugins: [staticAssetsPlugin],
};

// Start clean so a renamed or deleted source file cannot linger in the
// deployed output.
await rm(outDir, { recursive: true, force: true });

if (watch || serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();

  if (serve) {
    // 8788 by default because that is what Supabase's redirect URL
    // allowlist is configured for. Override with PORT when something
    // else already holds it.
    const requested = Number(process.env['PORT'] ?? 8788);
    const { port } = await ctx.serve({ servedir: outDir, port: requested });
    console.log(`\n  KatSAT dev server -> http://localhost:${port}\n`);
  } else {
    console.log('\n  Watching src/ …\n');
  }
} else {
  await esbuild.build(options);
  console.log('  Built src/ -> public/');
}
