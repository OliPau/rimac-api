export type DependencyGraph = Map<string, string[]>;

const layers = ['domain', 'application', 'infrastructure', 'composition', 'handlers'] as const;
type Layer = (typeof layers)[number];

function layer(file: string): Layer | undefined {
  return layers.find((name) => file.startsWith(`src/${name}/`));
}

export function verifyDependencies(graph: DependencyGraph): void {
  for (const [source, dependencies] of graph) {
    const owner = layer(source);
    if (!owner) {
      throw new Error(`Unknown backend layer: ${source}`);
    }
    for (const dependency of dependencies) {
      const target = layer(dependency);
      if (
        !target ||
        layers.indexOf(target) > layers.indexOf(owner) ||
        (owner === 'handlers' && target !== 'composition' && target !== 'handlers')
      ) {
        throw new Error(`Forbidden dependency: ${source} -> ${dependency}`);
      }
    }
  }
  const visited = new Set<string>();
  const path: string[] = [];
  function visit(file: string): void {
    if (path.includes(file)) {
      throw new Error(`Circular dependency: ${[...path, file].join(' -> ')}`);
    }
    if (visited.has(file)) {
      return;
    }
    path.push(file);
    for (const dependency of graph.get(file) ?? []) {
      visit(dependency);
    }
    path.pop();
    visited.add(file);
  }
  for (const file of graph.keys()) {
    visit(file);
  }
}
