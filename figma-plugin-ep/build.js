const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');

// Build code.ts -> dist/code.js
const codeBuild = esbuild.context({
  entryPoints: ['src/code.ts'],
  bundle: true,
  outfile: 'dist/code.js',
  target: 'es2020',
  format: 'iife',
});

// Copy ui.html -> dist/ui.html
function copyUI() {
  const src = path.join(__dirname, 'src', 'ui.html');
  const dest = path.join(__dirname, 'dist', 'ui.html');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log('[build] ui.html copied');
}

async function run() {
  copyUI();
  const ctx = await codeBuild;
  if (watch) {
    await ctx.watch();
    console.log('[build] watching...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log('[build] done');
  }
}

run().catch(e => { console.error(e); process.exit(1); });
