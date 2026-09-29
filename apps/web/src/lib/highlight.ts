import 'server-only';
import { createHighlighter, type BundledLanguage, type Highlighter } from 'shiki';

export interface HighlightedToken {
  content: string;
  /** --shiki-light / --shiki-dark colors, applied by CSS for the current theme. */
  style: Record<string, string>;
}

const LANGS = ['ts', 'tsx', 'js', 'jsx', 'json', 'md', 'yaml', 'dockerfile', 'prisma'] as const;
// Very large files are shown as plain text rather than tokenized on every request.
const MAX_HIGHLIGHT_CHARS = 150_000;

let highlighter: Promise<Highlighter> | undefined;

function getHighlighter() {
  highlighter ??= createHighlighter({
    themes: ['github-light', 'github-dark'],
    langs: [...LANGS],
  });
  return highlighter;
}

function shikiLanguage(path: string, language: string): string {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'jsx') return 'jsx';
  const byLanguage: Record<string, string> = {
    typescript: 'ts',
    tsx: 'tsx',
    javascript: 'js',
    json: 'json',
    markdown: 'md',
    yaml: 'yaml',
    dockerfile: 'dockerfile',
    prisma: 'prisma',
  };
  return byLanguage[language] ?? 'text';
}

/** Tokenizes a file into lines of colored tokens (both themes at once). */
export async function highlightFile(
  path: string,
  language: string,
  content: string,
): Promise<HighlightedToken[][]> {
  const lang = shikiLanguage(path, language);
  if (lang === 'text' || content.length > MAX_HIGHLIGHT_CHARS) {
    return content.split('\n').map((line) => [{ content: line, style: {} }]);
  }
  const { tokens } = (await getHighlighter()).codeToTokens(content, {
    lang: lang as BundledLanguage,
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  });
  return tokens.map((line) =>
    line.map((token) => ({
      content: token.content,
      style: (token.htmlStyle ?? {}) as Record<string, string>,
    })),
  );
}
