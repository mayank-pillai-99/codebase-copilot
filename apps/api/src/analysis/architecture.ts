import type { Architecture } from '@codebase-copilot/shared';
import { groupComponents, type GroupOptions } from './components';
import type { DataModel, DetectedIntegration, EnvVar } from './integrations';

export interface ArchitectureInput {
  /** Source files only (the map shows code, not docs or config). */
  codeFiles: readonly string[];
  symbolsPerFile: ReadonlyMap<string, number>;
  /** File path of each detected route. */
  routeFiles: readonly string[];
  /** Resolved imports between files in the snapshot. */
  internalImports: readonly { from: string; to: string; specifier: string; line: number }[];
  integrations: readonly DetectedIntegration[];
  dataModels: readonly DataModel[];
  envVars: readonly EnvVar[];
}

const EXAMPLES = 5;

/**
 * The architecture map (SPEC §9.1): directory components, the imports between them,
 * and the integrations each one uses. Every edge carries example import statements
 * as evidence, so nothing on the map is asserted without a line to point at.
 */
export function buildArchitecture(input: ArchitectureInput, options?: GroupOptions): Architecture {
  const components = groupComponents(input.codeFiles, options);
  const componentOf = new Map<string, string>();
  for (const c of components) for (const file of c.files) componentOf.set(file, c.id);

  const routesPerFile = new Map<string, number>();
  for (const file of input.routeFiles) routesPerFile.set(file, (routesPerFile.get(file) ?? 0) + 1);

  const dependencies = new Map<string, Architecture['dependencies'][number]>();
  for (const imp of input.internalImports) {
    const from = componentOf.get(imp.from);
    const to = componentOf.get(imp.to);
    if (!from || !to || from === to) continue;
    const key = `${from}\u0000${to}`;
    const edge = dependencies.get(key) ?? { from, to, count: 0, examples: [] };
    edge.count++;
    if (edge.examples.length < EXAMPLES) {
      edge.examples.push({ file: imp.from, line: imp.line, specifier: imp.specifier });
    }
    dependencies.set(key, edge);
  }

  return {
    components: components.map((c) => ({
      id: c.id,
      role: c.role,
      files: c.files,
      symbolCount: c.files.reduce((n, f) => n + (input.symbolsPerFile.get(f) ?? 0), 0),
      routeCount: c.files.reduce((n, f) => n + (routesPerFile.get(f) ?? 0), 0),
    })),
    dependencies: [...dependencies.values()].sort((a, b) => b.count - a.count),
    integrations: input.integrations.map((integration) => {
      const usedBy = new Map<string, Architecture['integrations'][number]['usedBy'][number]>();
      for (const imp of integration.imports) {
        const component = componentOf.get(imp.file);
        if (!component) continue;
        const use = usedBy.get(component) ?? { component, count: 0, examples: [] };
        use.count++;
        if (use.examples.length < EXAMPLES) use.examples.push(imp);
        usedBy.set(component, use);
      }
      return {
        name: integration.name,
        kind: integration.kind,
        packages: integration.packages,
        declaredIn: integration.declaredIn,
        usedBy: [...usedBy.values()].sort((a, b) => b.count - a.count),
      };
    }),
    dataModels: [...input.dataModels],
    envVars: input.envVars.map(({ name, count, usages }) => ({ name, count, usages })),
  };
}
