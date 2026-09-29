import { createRequire } from 'node:module';
import { Language, Parser, type Node } from 'web-tree-sitter';

export type CodeLanguage = 'typescript' | 'tsx' | 'javascript';
export type SymbolKind =
  'FUNCTION' | 'CLASS' | 'METHOD' | 'INTERFACE' | 'TYPE' | 'ENUM' | 'VARIABLE';

export interface ParsedSymbol {
  /** Index within this file; used to link calls and routes before ids exist. */
  index: number;
  kind: SymbolKind;
  name: string;
  qualifiedName: string;
  signature: string;
  startLine: number;
  endLine: number;
  exported: boolean;
  isDefault: boolean;
  docComment: string | null;
  /** Class that owns a method. */
  parentIndex: number | null;
  /** Byte range, for finding the symbol that encloses a call. */
  startIndex: number;
  endIndex: number;
}

export interface ImportBinding {
  /** Name used in this file. */
  local: string;
  /** 'default', '*' for a namespace/module object, or the exported name. */
  imported: string;
}

export interface ParsedImport {
  specifier: string;
  kind: 'static' | 'reexport' | 'require' | 'dynamic';
  bindings: ImportBinding[];
  /** For re-exports: exported name → name in the source module ('*' for export *). */
  reexports: { exported: string; imported: string }[];
  line: number;
}

export interface ParsedCall {
  /** Innermost enclosing symbol, or null at module scope. */
  fromSymbolIndex: number | null;
  calleeName: string;
  /** Receiver for member calls, e.g. "this.payments" in this.payments.create(). */
  receiver: string | null;
  calleeText: string;
  line: number;
  isConstructor: boolean;
}

export interface ParsedFile {
  symbols: ParsedSymbol[];
  imports: ParsedImport[];
  calls: ParsedCall[];
  hasErrors: boolean;
}

export interface CodeParser {
  parse(source: string, language: CodeLanguage): ParsedFile;
  /** Access to the raw tree for further analysis (route detection). Deletes it afterwards. */
  withTree<T>(source: string, language: CodeLanguage, fn: (root: Node) => T): T;
}

const GRAMMARS: Record<CodeLanguage, string> = {
  typescript: 'tree-sitter-typescript/tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-typescript/tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
};

let languagesPromise: Promise<Record<CodeLanguage, Language>> | undefined;

function loadLanguages(): Promise<Record<CodeLanguage, Language>> {
  languagesPromise ??= (async () => {
    await Parser.init();
    const require = createRequire(import.meta.url);
    const entries = await Promise.all(
      (Object.entries(GRAMMARS) as [CodeLanguage, string][]).map(
        async ([name, path]) => [name, await Language.load(require.resolve(path))] as const,
      ),
    );
    return Object.fromEntries(entries) as Record<CodeLanguage, Language>;
  })();
  return languagesPromise;
}

/** Loads the WASM grammars once; the returned parser is synchronous and reusable. */
export async function createCodeParser(): Promise<CodeParser> {
  const languages = await loadLanguages();
  const parsers = new Map<CodeLanguage, Parser>();
  const parserFor = (language: CodeLanguage) => {
    let parser = parsers.get(language);
    if (!parser) {
      parser = new Parser();
      parser.setLanguage(languages[language]);
      parsers.set(language, parser);
    }
    return parser;
  };

  const withTree: CodeParser['withTree'] = (source, language, fn) => {
    const tree = parserFor(language).parse(source);
    if (!tree) throw new Error('tree-sitter returned no tree');
    try {
      return fn(tree.rootNode);
    } finally {
      // Trees live in WASM memory and are not garbage collected.
      tree.delete();
    }
  };

  return {
    withTree,
    parse: (source, language) => withTree(source, language, (root) => extract(root)),
  };
}

// ---------------------------------------------------------------------------

const MAX_SIGNATURE = 300;
const MAX_DOC = 1_000;
const MAX_CALLEE_TEXT = 120;

function extract(root: Node): ParsedFile {
  const symbols: ParsedSymbol[] = [];
  const imports: ParsedImport[] = [];
  const localExports = new Map<string, string>(); // local name → exported name
  let defaultExportName: string | null = null;

  const add = (
    symbol: Omit<ParsedSymbol, 'index' | 'isDefault' | 'parentIndex'> & {
      isDefault?: boolean;
      parentIndex?: number | null;
    },
  ) => {
    const full: ParsedSymbol = {
      isDefault: false,
      parentIndex: null,
      ...symbol,
      index: symbols.length,
    };
    symbols.push(full);
    return full;
  };

  for (const statement of root.namedChildren) {
    if (statement.type === 'import_statement') {
      imports.push(parseImport(statement));
      continue;
    }

    if (statement.type === 'export_statement') {
      const source = statement.childForFieldName('source');
      if (source) {
        imports.push(parseReexport(statement, source));
        continue;
      }
      const declaration = statement.childForFieldName('declaration');
      if (declaration) {
        // "export default function f() {}" is a declaration with a `default` keyword.
        const isDefault = statement.children.some((c) => c?.type === 'default');
        collectDeclaration(declaration, statement, { exported: true, isDefault }, add);
        continue;
      }
      const value = statement.childForFieldName('value');
      if (value) {
        if (value.type === 'identifier') {
          defaultExportName = value.text;
        } else if (isFunctionLike(value) || value.type === 'class') {
          const name = value.childForFieldName('name')?.text ?? 'default';
          collectValue(name, value, statement, statement, { exported: true, isDefault: true }, add);
        }
        continue;
      }
      // export { a, b as c };
      for (const spec of descendants(statement, 'export_specifier')) {
        const name = spec.childForFieldName('name')?.text;
        if (name) localExports.set(name, spec.childForFieldName('alias')?.text ?? name);
      }
      continue;
    }

    collectDeclaration(statement, statement, { exported: false, isDefault: false }, add);
  }

  for (const symbol of symbols) {
    if (symbol.parentIndex !== null) continue;
    const exportedAs = localExports.get(symbol.name);
    if (exportedAs) {
      symbol.exported = true;
      if (exportedAs === 'default') symbol.isDefault = true;
    }
    if (defaultExportName && symbol.name === defaultExportName) {
      symbol.exported = true;
      symbol.isDefault = true;
    }
  }

  imports.push(...findRequireAndDynamicImports(root));

  return {
    symbols,
    imports: imports.sort((a, b) => a.line - b.line),
    calls: findCalls(root, symbols),
    hasErrors: root.hasError,
  };
}

type AddSymbol = (
  symbol: Omit<ParsedSymbol, 'index' | 'isDefault' | 'parentIndex'> & {
    isDefault?: boolean;
    parentIndex?: number | null;
  },
) => ParsedSymbol;

function collectDeclaration(
  node: Node,
  outer: Node,
  flags: { exported: boolean; isDefault: boolean },
  add: AddSymbol,
): void {
  const name = node.childForFieldName('name')?.text;
  const base = {
    ...flags,
    ...lines(outer),
    startIndex: outer.startIndex,
    endIndex: outer.endIndex,
    docComment: docCommentFor(outer),
  };

  switch (node.type) {
    case 'function_declaration':
    case 'generator_function_declaration':
      if (name) {
        add({ ...base, kind: 'FUNCTION', name, qualifiedName: name, signature: headerOf(node) });
      }
      return;
    case 'class_declaration':
    case 'abstract_class_declaration':
      if (name) collectClass(node, name, base, add);
      return;
    case 'interface_declaration':
      if (name)
        add({ ...base, kind: 'INTERFACE', name, qualifiedName: name, signature: firstLine(node) });
      return;
    case 'type_alias_declaration':
      if (name)
        add({ ...base, kind: 'TYPE', name, qualifiedName: name, signature: firstLine(node) });
      return;
    case 'enum_declaration':
      if (name)
        add({ ...base, kind: 'ENUM', name, qualifiedName: name, signature: firstLine(node) });
      return;
    case 'lexical_declaration':
    case 'variable_declaration':
      for (const declarator of node.namedChildren) {
        if (declarator.type !== 'variable_declarator') continue;
        const id = declarator.childForFieldName('name');
        const value = declarator.childForFieldName('value');
        if (id?.type !== 'identifier') continue;
        // Single-declarator statements keep the whole statement ("export const …") as range.
        const range = node.namedChildren.length === 1 ? outer : declarator;
        collectValue(id.text, value, range, node, flags, add);
      }
      return;
  }
}

function collectValue(
  name: string,
  value: Node | null,
  range: Node,
  declaration: Node,
  flags: { exported: boolean; isDefault: boolean },
  add: AddSymbol,
): void {
  const base = {
    ...flags,
    ...lines(range),
    startIndex: range.startIndex,
    endIndex: range.endIndex,
    docComment: docCommentFor(range),
  };
  if (value && isFunctionLike(value)) {
    add({
      ...base,
      kind: 'FUNCTION',
      name,
      qualifiedName: name,
      signature: clean(
        `${sourceBetween(declaration, declaration.startIndex, value.startIndex)}${headerOf(value)}`,
      ),
    });
  } else if (value?.type === 'class') {
    collectClass(value, name, base, add);
  } else if (flags.exported) {
    // Exported non-function values: routers, schemas, config objects.
    add({
      ...base,
      kind: 'VARIABLE',
      name,
      qualifiedName: name,
      signature: firstLine(declaration),
    });
  }
}

function collectClass(
  node: Node,
  name: string,
  base: Omit<
    ParsedSymbol,
    'index' | 'kind' | 'name' | 'qualifiedName' | 'signature' | 'isDefault' | 'parentIndex'
  > & {
    isDefault: boolean;
  },
  add: AddSymbol,
): void {
  const cls = add({ ...base, kind: 'CLASS', name, qualifiedName: name, signature: headerOf(node) });
  const body = node.childForFieldName('body');
  for (const member of body?.namedChildren ?? []) {
    const memberName = member.childForFieldName('name');
    if (!memberName) continue;
    const isMethod = member.type === 'method_definition';
    const value = member.childForFieldName('value');
    const isArrowField =
      member.type === 'public_field_definition' && value !== null && isFunctionLike(value);
    if (!isMethod && !isArrowField) continue;
    add({
      kind: 'METHOD',
      name: memberName.text,
      qualifiedName: `${name}.${memberName.text}`,
      signature: isMethod
        ? headerOf(member)
        : clean(
            `${sourceBetween(member, member.startIndex, value!.startIndex)}${headerOf(value!)}`,
          ),
      ...lines(member),
      startIndex: member.startIndex,
      endIndex: member.endIndex,
      exported: base.exported,
      docComment: docCommentFor(member),
      parentIndex: cls.index,
    });
  }
}

function parseImport(node: Node): ParsedImport {
  const bindings: ImportBinding[] = [];
  const clause = node.namedChildren.find((c) => c.type === 'import_clause');
  for (const part of clause?.namedChildren ?? []) {
    if (part.type === 'identifier') bindings.push({ local: part.text, imported: 'default' });
    if (part.type === 'namespace_import') {
      const id = part.namedChildren.find((c) => c.type === 'identifier');
      if (id) bindings.push({ local: id.text, imported: '*' });
    }
    if (part.type === 'named_imports') {
      for (const spec of part.namedChildren) {
        if (spec.type !== 'import_specifier') continue;
        const imported = spec.childForFieldName('name')?.text;
        if (!imported) continue;
        bindings.push({ local: spec.childForFieldName('alias')?.text ?? imported, imported });
      }
    }
  }
  return {
    specifier: stringValue(node.childForFieldName('source')),
    kind: 'static',
    bindings,
    reexports: [],
    line: node.startPosition.row + 1,
  };
}

function parseReexport(node: Node, source: Node): ParsedImport {
  const reexports = descendants(node, 'export_specifier').flatMap((spec) => {
    const imported = spec.childForFieldName('name')?.text;
    return imported
      ? [{ exported: spec.childForFieldName('alias')?.text ?? imported, imported }]
      : [];
  });
  const namespace = node.namedChildren.find((c) => c.type === 'namespace_export');
  if (namespace) {
    const alias = namespace.namedChildren[0]?.text;
    if (alias) reexports.push({ exported: alias, imported: '*' });
  } else if (reexports.length === 0) {
    reexports.push({ exported: '*', imported: '*' });
  }
  return {
    specifier: stringValue(source),
    kind: 'reexport',
    bindings: [],
    reexports,
    line: node.startPosition.row + 1,
  };
}

function findRequireAndDynamicImports(root: Node): ParsedImport[] {
  const found: ParsedImport[] = [];
  for (const call of descendants(root, 'call_expression')) {
    const fn = call.childForFieldName('function');
    const args = call.childForFieldName('arguments')?.namedChildren ?? [];
    const first = args[0];
    if (args.length !== 1 || !first || !isStaticString(first)) continue;

    if (fn?.type === 'import') {
      found.push({
        specifier: stringValue(first),
        kind: 'dynamic',
        bindings: [],
        reexports: [],
        line: call.startPosition.row + 1,
      });
    } else if (fn?.type === 'identifier' && fn.text === 'require') {
      found.push({
        specifier: stringValue(first),
        kind: 'require',
        bindings: requireBindings(call),
        reexports: [],
        line: call.startPosition.row + 1,
      });
    }
  }
  return found;
}

/** const x = require('m') → x is the module; const { a, b: c } = require('m') → named. */
function requireBindings(call: Node): ImportBinding[] {
  const declarator = call.parent?.type === 'variable_declarator' ? call.parent : null;
  const target = declarator?.childForFieldName('name');
  if (!target) return [];
  if (target.type === 'identifier') return [{ local: target.text, imported: '*' }];
  if (target.type !== 'object_pattern') return [];
  return target.namedChildren.flatMap((p): ImportBinding[] => {
    if (p.type === 'shorthand_property_identifier_pattern')
      return [{ local: p.text, imported: p.text }];
    if (p.type === 'pair_pattern') {
      const key = p.childForFieldName('key')?.text;
      const value = p.childForFieldName('value');
      if (key && value?.type === 'identifier') return [{ local: value.text, imported: key }];
    }
    return [];
  });
}

function findCalls(root: Node, symbols: ParsedSymbol[]): ParsedCall[] {
  // Innermost-first lookup: sort by size so the first containing range is the tightest.
  const bySize = [...symbols].sort(
    (a, b) => a.endIndex - a.startIndex - (b.endIndex - b.startIndex),
  );
  const enclosing = (index: number) =>
    bySize.find((s) => s.startIndex <= index && index < s.endIndex)?.index ?? null;

  const calls: ParsedCall[] = [];
  for (const node of descendants(root, ['call_expression', 'new_expression'])) {
    const isConstructor = node.type === 'new_expression';
    const callee = node.childForFieldName(isConstructor ? 'constructor' : 'function');
    if (!callee) continue;

    let calleeName: string;
    let receiver: string | null = null;
    if (callee.type === 'identifier') {
      calleeName = callee.text;
      if (!isConstructor && calleeName === 'require') continue;
    } else if (callee.type === 'member_expression') {
      const property = callee.childForFieldName('property');
      const object = callee.childForFieldName('object');
      if (!property || !object) continue;
      calleeName = property.text;
      receiver = truncate(object.text.replace(/\s+/g, ''), 80);
    } else {
      continue; // import(), super(), IIFEs, call chains like a()()
    }

    calls.push({
      fromSymbolIndex: enclosing(node.startIndex),
      calleeName,
      receiver,
      calleeText: truncate(callee.text.replace(/\s+/g, ''), MAX_CALLEE_TEXT),
      line: node.startPosition.row + 1,
      isConstructor,
    });
  }
  return calls;
}

// --- helpers ---------------------------------------------------------------

export function descendants(node: Node, types: string | string[]): Node[] {
  return node.descendantsOfType(types).filter((n): n is Node => n !== null);
}

function isFunctionLike(node: Node): boolean {
  return ['arrow_function', 'function_expression', 'function', 'generator_function'].includes(
    node.type,
  );
}

export function isStaticString(node: Node): boolean {
  if (node.type === 'string') return true;
  return (
    node.type === 'template_string' &&
    !node.namedChildren.some((c) => c.type === 'template_substitution')
  );
}

export function stringValue(node: Node | null): string {
  if (!node) return '';
  if (node.type === 'string') return node.namedChildren.map((c) => c.text).join('');
  return node.text.slice(1, -1);
}

function lines(node: Node) {
  return { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
}

/** Declaration text up to its body: "async function f(a: number): Promise<void>". */
function headerOf(node: Node): string {
  const body = node.childForFieldName('body');
  const end = body ? body.startIndex : node.endIndex;
  return clean(sourceBetween(node, node.startIndex, end));
}

function firstLine(node: Node): string {
  return clean(node.text.split('\n')[0] ?? '');
}

function sourceBetween(node: Node, start: number, end: number): string {
  // Node.text is the node's own source; slice relative to its start.
  return node.text.slice(start - node.startIndex, end - node.startIndex);
}

function clean(text: string): string {
  return truncate(
    text
      .replace(/\s+/g, ' ')
      .replace(/\s*=>\s*$/, ' =>')
      .trim(),
    MAX_SIGNATURE,
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function docCommentFor(node: Node): string | null {
  const previous = node.previousSibling;
  if (previous?.type !== 'comment' || !previous.text.startsWith('/**')) return null;
  if (node.startPosition.row - previous.endPosition.row > 1) return null;
  const text = previous.text
    .replace(/^\/\*\*\s?/, '')
    .replace(/\s*\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\* ?/, ''))
    .join('\n')
    .trim();
  return text ? truncate(text, MAX_DOC) : null;
}
