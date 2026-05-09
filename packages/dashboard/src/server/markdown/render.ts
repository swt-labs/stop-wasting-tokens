import rehypeShiki from '@shikijs/rehype';
import matter from 'gray-matter';
import rehypeSanitize, { defaultSchema, type Options as SanitizeOptions } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

const sanitizeSchema: SanitizeOptions = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'details', 'summary'],
  attributes: {
    ...defaultSchema.attributes,
    details: [...(defaultSchema.attributes?.['details'] ?? []), 'open'],
    code: [...(defaultSchema.attributes?.['code'] ?? []), ['className', /^language-/]],
    pre: [...(defaultSchema.attributes?.['pre'] ?? []), ['style', /^[\w\-:#%(),. ]+$/]],
    span: [...(defaultSchema.attributes?.['span'] ?? []), ['style', /^[\w\-:#%(),. ]+$/]],
  },
};

function buildProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeShiki, { theme: 'github-dark' })
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify);
}

type CachedProcessor = ReturnType<typeof buildProcessor>;
let cachedProcessor: CachedProcessor | null = null;

function getProcessor(): CachedProcessor {
  if (cachedProcessor) return cachedProcessor;
  cachedProcessor = buildProcessor();
  return cachedProcessor;
}

export interface RenderedMarkdown {
  html: string;
  frontmatter: Record<string, unknown>;
}

/**
 * Parse a markdown source string into HTML + frontmatter. Frontmatter is the
 * YAML between the leading `---` markers (gray-matter). HTML is sanitized to
 * the rehype-sanitize default schema plus `<details>`/`<summary>` allowance.
 */
export async function renderMarkdown(source: string): Promise<RenderedMarkdown> {
  const parsed = matter(source);
  const file = await getProcessor().process(parsed.content);
  return {
    html: String(file),
    frontmatter: parsed.data,
  };
}
