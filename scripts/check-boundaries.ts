import { glob, readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import ts from 'typescript';
import { verifyDependencies, type DependencyGraph } from './boundaries.js';

const root = process.cwd();
const config = ts.readConfigFile('tsconfig.json', (file) => ts.sys.readFile(file));
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
const graph: DependencyGraph = new Map();
const normalize = (file: string) => relative(root, file).replaceAll('\\', '/');

for await (const file of glob(['src/**/*.ts'])) {
  const filename = resolve(file);
  const source = ts.createSourceFile(
    filename,
    await readFile(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const dependencies: string[] = [];
  function add(specifier: ts.Expression): void {
    if (!ts.isStringLiteral(specifier)) {
      throw new Error(`Backend imports must use literal module names: ${file}`);
    }
    const resolved = ts.resolveModuleName(specifier.text, filename, options, ts.sys).resolvedModule;
    if (!resolved) {
      if (specifier.text.startsWith('node:')) {
        return;
      }
      throw new Error(`Unresolved import: ${file} -> ${specifier.text}`);
    }
    const target = normalize(realpathSync(resolved.resolvedFileName));
    if (!target.split('/').includes('node_modules')) {
      dependencies.push(target);
    }
  }
  function inspect(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      add(node.moduleSpecifier);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0]
    ) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node, inspect);
  }
  inspect(source);
  graph.set(normalize(filename), dependencies);
}
verifyDependencies(graph);
console.log(`Verified layer boundaries and absence of cycles across ${graph.size} backend modules`);
