// Native tsc checks TypeScript entry points; vue-tsc checks the actual SFCs.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent;
  export default component;
}
