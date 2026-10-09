/** Run the original node:test business/API suites with Deno itself and verify real assertion counts. */
const root = new URL("../../", import.meta.url);
const baselineMinimum = 204;
const reportDir = await Deno.makeTempDir({
  prefix: "pc-workbench-deno-tests-",
});
const reportPath = `${reportDir}/suite.xml`;
const expectedFiles: string[] = [];
for await (const entry of Deno.readDir(new URL("tests/", root))) {
  if (entry.isFile && entry.name.endsWith(".test.ts")) {
    expectedFiles.push(entry.name);
  }
}
expectedFiles.sort();
if (!expectedFiles.length) {
  throw new Error("No application test files found.");
}

console.log(
  `Running ${expectedFiles.length} application suite files with Deno ${Deno.version.deno}.`,
);
const process = new Deno.Command(Deno.execPath(), {
  cwd: root,
  args: [
    "test",
    "--config=deno.json",
    "--no-check",
    "--allow-all",
    `--junit-path=${reportPath}`,
    "tests/",
  ],
  stdin: "null",
  stdout: "inherit",
  stderr: "inherit",
}).spawn();
const status = await process.status;

try {
  const xml = await Deno.readTextFile(reportPath);
  const summary = xml.match(/<testsuites\b([^>]*)>/)?.[1];
  if (!summary) {
    throw new Error(
      "Missing Deno JUnit summary; cannot verify the suite actually ran.",
    );
  }
  const count = (key: string) =>
    Number(summary.match(new RegExp(`\\b${key}="(\\d+)"`))?.[1] ?? NaN);
  const tests = count("tests"),
    failures = count("failures"),
    errors = count("errors");
  const cases = [...xml.matchAll(/<testcase\b/g)].length;
  const suites = [...xml.matchAll(/<testsuite\s+name="([^"]+)"/g)].map(
    (match) => match[1],
  );
  const missing = expectedFiles.filter((file) =>
    !suites.some((suite) => suite.endsWith(`/${file}`))
  );
  if (
    !Number.isInteger(tests) || tests < baselineMinimum || cases !== tests ||
    missing.length
  ) {
    throw new Error(
      `Incomplete test execution: ${tests} tests, ${cases} cases; minimum ${baselineMinimum}; missing suites: ${
        missing.join(", ") || "none"
      }.`,
    );
  }
  console.log(
    `Verified ${tests} individual test cases across ${expectedFiles.length} application suites; failures=${failures}, errors=${errors}.`,
  );
  if (!status.success || failures !== 0 || errors !== 0) {
    throw new Error("Application suite failed.");
  }
  await Deno.remove(reportDir, { recursive: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`Diagnostic JUnit report retained at ${reportPath}`);
  Deno.exit(status.code || 1);
}
