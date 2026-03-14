import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
if (!configPath) {
  console.error("tsconfig.json not found.");
  process.exit(1);
}

const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error) {
  console.error("Failed to read tsconfig.json.");
  process.exit(1);
}

const parsed = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  path.dirname(configPath),
);

const sourceFiles = parsed.fileNames
  .filter((filePath) => /\.(ts|tsx)$/.test(filePath))
  .filter((filePath) => !filePath.endsWith(".d.ts"))
  .filter((filePath) => !/\.test\.ts$/.test(filePath))
  .map((filePath) => path.normalize(filePath));

const sourceFileSet = new Set(sourceFiles);
const graph = new Map(sourceFiles.map((filePath) => [filePath, new Set()]));
const compilerHost = ts.createCompilerHost(parsed.options, true);

const entrypoints = [
  "src/electron/main.ts",
  "src/electron/preload.ts",
  "src/electron/renderer/main.tsx",
].map((relativePath) => path.normalize(path.join(root, relativePath)));

function resolveModule(specifier, containingFile) {
  const resolved = ts.resolveModuleName(
    specifier,
    containingFile,
    parsed.options,
    compilerHost,
  );

  if (!resolved?.resolvedModule) return null;
  const resolvedFile = path.normalize(resolved.resolvedModule.resolvedFileName);
  return sourceFileSet.has(resolvedFile) ? resolvedFile : null;
}

for (const filePath of sourceFiles) {
  const sourceText = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const resolvedFile = resolveModule(node.moduleSpecifier.text, filePath);
      if (resolvedFile) {
        graph.get(filePath)?.add(resolvedFile);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

const reachable = new Set();
const stack = [...entrypoints];

while (stack.length > 0) {
  const current = stack.pop();
  if (!current || reachable.has(current) || !graph.has(current)) continue;
  reachable.add(current);

  for (const dependency of graph.get(current) ?? []) {
    stack.push(dependency);
  }
}

const unreachable = sourceFiles
  .filter((filePath) => !reachable.has(filePath))
  .map((filePath) => path.relative(root, filePath))
  .sort();

if (unreachable.length > 0) {
  console.error("Unreachable runtime files detected:");
  for (const filePath of unreachable) {
    console.error(`- ${filePath}`);
  }
  process.exit(1);
}

console.log("Runtime reachability check passed.");
