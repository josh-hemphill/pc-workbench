// Construct the Vue-aware compiler program directly. Deno's CommonJS loader
// bypasses vue-tsc's readFileSync interception, so its CLI can omit Vue files.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type * as TypeScript from "typescript";
const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);
const ts = require("typescript") as typeof TypeScript;
const vueRequire = createRequire(require.resolve("vue-tsc"));
const core = vueRequire("@vue/language-core");
const { proxyCreateProgram } = vueRequire(
  "@volar/typescript/lib/node/proxyCreateProgram",
);
const configFile = `${root}/tsconfig.json`;
const source = ts.readConfigFile(configFile, ts.sys.readFile);
if (source.error) {
  throw Error(ts.flattenDiagnosticMessageText(source.error.messageText, "\n"));
}
const vueOptions =
  core.createParsedCommandLine(ts, ts.sys, configFile).vueOptions;
const extensions = (core.getAllExtensions(vueOptions) as string[]).map(
  (extension) => ({
    extension,
    isMixedContent: true,
    scriptKind: ts.ScriptKind.Deferred,
  }),
);
const config = ts.parseJsonConfigFileContent(
  source.config,
  ts.sys,
  root,
  { noEmit: true, allowNonTsExtensions: true },
  configFile,
  undefined,
  extensions,
);
if (!config.fileNames.length) throw Error("Type check found no source files.");
const createProgram = proxyCreateProgram(
  ts,
  ts.createProgram,
  () => ({
    languagePlugins: [
      core.createVueLanguagePlugin(
        ts,
        config.options,
        vueOptions,
        (id: string) => id,
      ),
    ],
  }),
);
const program = createProgram({
  rootNames: config.fileNames,
  options: config.options,
  host: ts.createCompilerHost(config.options),
  projectReferences: config.projectReferences,
}) as TypeScript.Program;
const diagnostics = [...config.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (name: string) => name,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    }),
  );
}
if (diagnostics.some((d) => d.category === ts.DiagnosticCategory.Error)) {
  Deno.exit(1);
}
console.log(
  `Type checked ${config.fileNames.length} source files, including Vue templates.`,
);
