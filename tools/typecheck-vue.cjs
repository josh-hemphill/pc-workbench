// vue-tsc currently requires the JavaScript compiler API, absent from TypeScript 7.
// Pass the maintained TypeScript 6 alias explicitly; keep TypeScript 7 for .ts checks.
require('vue-tsc').run(require.resolve('typescript-vue/lib/tsc'));
