import { createModuleResolver, type ConfigFile } from './modules';
import type { CodeLanguage, CodeParser, ParsedImport, ParsedSymbol } from './parser';
import { analyzeFile, type AnalyzedFile, type RouteFramework } from './routes';

export interface SourceFile {
  path: string;
  kind: 'CODE' | 'DOC' | 'CONFIG';
  language: string;
  content: string;
}

export interface SymbolRef {
  path: string;
  index: number;
}

export interface GraphImport {
  fromPath: string;
  toPath: string | null;
  specifier: string;
  importedNames: string[];
  kind: ParsedImport['kind'];
  line: number;
  external: boolean;
  packageName: string | null;
}

export interface GraphCall {
  path: string;
  fromSymbolIndex: number | null;
  target: SymbolRef | null;
  calleeName: string;
  calleeText: string;
  line: number;
}

export interface GraphRoute {
  path: string;
  method: string;
  urlPath: string;
  framework: RouteFramework;
  handlerName: string | null;
  handler: SymbolRef | null;
  startLine: number;
  endLine: number;
}

export interface CodeGraph {
  /** Per-file parse results, keyed by path (code files only). */
  files: Map<string, { symbols: ParsedSymbol[]; hasErrors: boolean }>;
  imports: GraphImport[];
  calls: GraphCall[];
  routes: GraphRoute[];
}

const CODE_LANGUAGES = new Set<string>(['typescript', 'tsx', 'javascript']);
const MAX_REEXPORT_DEPTH = 6;

/**
 * Parses every code file, then links the files together: imports to files,
 * calls and route handlers to the symbols they most likely refer to. Resolution
 * is name-based and approximate by design (see SPEC §5.3); anything it can't
 * pin down is left unresolved rather than guessed.
 */
export function buildCodeGraph(
  sources: SourceFile[],
  parser: CodeParser,
  onFileParsed?: (done: number, total: number) => void,
): CodeGraph {
  const code = sources.filter((f) => f.kind === 'CODE' && CODE_LANGUAGES.has(f.language));
  const configs: ConfigFile[] = sources
    .filter((f) => f.kind === 'CONFIG' && f.language === 'json')
    .map((f) => ({ path: f.path, content: f.content }));

  const analyzed = new Map<string, AnalyzedFile>();
  code.forEach((file, i) => {
    analyzed.set(
      file.path,
      analyzeFile(parser, file.content, file.language as CodeLanguage, file.path),
    );
    onFileParsed?.(i + 1, code.length);
  });

  const modules = createModuleResolver(analyzed.keys(), configs);
  const imports: GraphImport[] = [];
  // path → specifier → resolved path (for binding lookups below)
  const resolvedSpecifiers = new Map<string, Map<string, string | null>>();

  for (const [path, file] of analyzed) {
    const bySpecifier = new Map<string, string | null>();
    for (const imp of file.imports) {
      const resolution = modules.resolve(path, imp.specifier);
      bySpecifier.set(imp.specifier, resolution.toPath);
      imports.push({
        fromPath: path,
        toPath: resolution.toPath,
        specifier: imp.specifier,
        importedNames:
          imp.kind === 'reexport'
            ? imp.reexports.map((r) => r.exported)
            : imp.bindings.map((b) => b.imported),
        kind: imp.kind,
        line: imp.line,
        external: resolution.external,
        packageName: resolution.packageName,
      });
    }
    resolvedSpecifiers.set(path, bySpecifier);
  }

  /** Follows exports and re-export chains to the symbol a module exports as `name`. */
  function findExport(path: string, name: string, seen = new Set<string>()): SymbolRef | null {
    const key = `${path}#${name}`;
    const file = analyzed.get(path);
    if (!file || seen.has(key) || seen.size > MAX_REEXPORT_DEPTH) return null;
    seen.add(key);

    const local = file.symbols.find(
      (s) =>
        s.parentIndex === null &&
        s.exported &&
        (name === 'default' ? s.isDefault : s.name === name),
    );
    if (local) return { path, index: local.index };

    for (const imp of file.imports) {
      if (imp.kind !== 'reexport') continue;
      const target = resolvedSpecifiers.get(path)?.get(imp.specifier);
      if (!target) continue;
      for (const { exported, imported } of imp.reexports) {
        if (exported === name && imported !== '*') {
          const hit = findExport(target, imported, seen);
          if (hit) return hit;
        }
        if (exported === '*' && name !== 'default') {
          const hit = findExport(target, name, seen);
          if (hit) return hit;
        }
      }
    }
    return null;
  }

  function bindingsFor(path: string) {
    const file = analyzed.get(path)!;
    const bindings = new Map<string, { target: string; imported: string }>();
    for (const imp of file.imports) {
      const target = resolvedSpecifiers.get(path)?.get(imp.specifier);
      if (!target) continue;
      for (const b of imp.bindings) bindings.set(b.local, { target, imported: b.imported });
    }
    return bindings;
  }

  function methodOf(classRef: SymbolRef, method: string): SymbolRef | null {
    const file = analyzed.get(classRef.path)!;
    const cls = file.symbols[classRef.index];
    if (cls?.kind !== 'CLASS') return null;
    const hit = file.symbols.find((s) => s.parentIndex === classRef.index && s.name === method);
    return hit ? { path: classRef.path, index: hit.index } : null;
  }

  /** Resolves `name` or `receiver.name` as seen from inside `path` (optionally within a symbol). */
  function resolveName(
    path: string,
    bindings: Map<string, { target: string; imported: string }>,
    receiver: string | null,
    name: string,
    fromSymbolIndex: number | null,
  ): SymbolRef | null {
    const file = analyzed.get(path)!;
    const topLevel = (n: string) => {
      // Members assigned onto objects (res.send = …) aren't bare names in scope.
      const s = file.symbols.find(
        (sym) => sym.parentIndex === null && sym.container === null && sym.name === n,
      );
      return s ? { path, index: s.index } : null;
    };
    const member = (container: string, n: string) => {
      const s = file.symbols.find((sym) => sym.container === container && sym.name === n);
      return s ? { path, index: s.index } : null;
    };
    const identifier = (n: string): SymbolRef | null => {
      const binding = bindings.get(n);
      if (binding) {
        // Calling a require()'d module directly calls what it assigned to module.exports.
        return findExport(binding.target, binding.imported === '*' ? 'default' : binding.imported);
      }
      return topLevel(n);
    };

    if (receiver === null) return identifier(name);

    if (receiver === 'this' && fromSymbolIndex !== null) {
      const from = file.symbols[fromSymbolIndex];
      if (from?.container) return member(from.container, name);
      const classIndex = from?.kind === 'CLASS' ? from.index : from?.parentIndex;
      return classIndex === null || classIndex === undefined
        ? null
        : methodOf({ path, index: classIndex }, name);
    }

    if (/^[A-Za-z_$][\w$]*$/.test(receiver)) {
      const binding = bindings.get(receiver);
      if (binding?.imported === '*') return findExport(binding.target, name); // namespace / module object
      const sameFileMember = binding ? null : member(receiver, name); // app.init() next to app.init = …
      if (sameFileMember) return sameFileMember;
      const owner = identifier(receiver);
      if (owner) return methodOf(owner, name); // static method on a class
    }
    return null;
  }

  const calls: GraphCall[] = [];
  const routes: GraphRoute[] = [];
  for (const [path, file] of analyzed) {
    const bindings = bindingsFor(path);
    for (const call of file.calls) {
      calls.push({
        path,
        fromSymbolIndex: call.fromSymbolIndex,
        target: resolveName(path, bindings, call.receiver, call.calleeName, call.fromSymbolIndex),
        calleeName: call.calleeName,
        calleeText: call.calleeText,
        line: call.line,
      });
    }
    for (const route of file.routes) {
      let handler: SymbolRef | null =
        route.handlerSymbolIndex !== null ? { path, index: route.handlerSymbolIndex } : null;
      if (!handler && route.handlerName) {
        const dot = route.handlerName.lastIndexOf('.');
        handler =
          dot === -1
            ? resolveName(path, bindings, null, route.handlerName, null)
            : resolveName(
                path,
                bindings,
                route.handlerName.slice(0, dot),
                route.handlerName.slice(dot + 1),
                null,
              );
      }
      routes.push({
        path,
        method: route.method,
        urlPath: route.path,
        framework: route.framework,
        handlerName: route.handlerName,
        handler,
        startLine: route.startLine,
        endLine: route.endLine,
      });
    }
  }

  return {
    files: new Map(
      [...analyzed].map(([path, f]) => [path, { symbols: f.symbols, hasErrors: f.hasErrors }]),
    ),
    imports,
    calls,
    routes,
  };
}
