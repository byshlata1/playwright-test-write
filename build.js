const esbuild = require('esbuild');

const isWatch = process.argv.includes('--watch');

const buildOptions = {
  entryPoints: {
    'dist/background': 'src/background/index.js',
    'dist/content': 'src/content/index.js',
    'dist/panel': 'src/panel/index.js',
    'dist/inject': 'src/inject.js',
    'dist/devtools': 'src/devtools.js',
    'dist/picker': 'src/picker.js',
  },
  bundle: true,
  format: 'iife',
  outdir: '.',
  logLevel: 'info',
};

async function main() {
  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await esbuild.build(buildOptions);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
