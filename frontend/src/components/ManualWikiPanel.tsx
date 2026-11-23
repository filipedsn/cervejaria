import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSearchParams } from 'react-router-dom';
import {
  isManualSlug,
  MANUAL_ARTICLES,
  MANUAL_DEFAULT_SLUG,
  type ManualArticle,
} from '../content/manual/manifest';

const articleModules = import.meta.glob('../content/manual/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

function articleMarkdown(slug: string): string {
  const entry = Object.entries(articleModules).find(([path]) => path.endsWith(`/${slug}.md`));
  return entry?.[1] ?? '# Artigo não encontrado\n\nVolte ao índice e escolha outra página.';
}

function groupedArticles(): { group: string; items: ManualArticle[] }[] {
  const groups: { group: string; items: ManualArticle[] }[] = [];
  for (const article of MANUAL_ARTICLES) {
    const existing = groups.find((g) => g.group === article.group);
    if (existing) existing.items.push(article);
    else groups.push({ group: article.group, items: [article] });
  }
  return groups;
}

export function ManualWikiPanel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const slug = isManualSlug(searchParams.get('pagina')) ? searchParams.get('pagina')! : MANUAL_DEFAULT_SLUG;
  const markdown = useMemo(() => articleMarkdown(slug), [slug]);
  const current = MANUAL_ARTICLES.find((article) => article.slug === slug) ?? MANUAL_ARTICLES[0];
  const groups = useMemo(() => groupedArticles(), []);

  function selectArticle(nextSlug: string) {
    const next = new URLSearchParams(searchParams);
    next.set('pagina', nextSlug);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface" data-testid="manual-wiki-panel">
      <div className="border-b border-line px-4 py-3 sm:px-5">
        <h2 className="text-base font-semibold text-ink">Manual do Quiver Tap</h2>
        <p className="mt-0.5 text-sm text-ink-muted">Guia funcional com prints do fluxo do PDV.</p>
      </div>

      <div className="border-b border-line px-4 py-3 sm:hidden">
        <label className="block text-xs font-medium uppercase tracking-wide text-ink-faint" htmlFor="manual-wiki-select">
          Página
        </label>
        <select
          id="manual-wiki-select"
          className="mt-1 w-full rounded-lg border border-line bg-surface-light px-3 py-2 text-sm text-ink"
          value={slug}
          onChange={(event) => selectArticle(event.target.value)}
        >
          {MANUAL_ARTICLES.map((article) => (
            <option key={article.slug} value={article.slug}>
              {article.group}: {article.title}
            </option>
          ))}
        </select>
      </div>

      <div className="grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav className="hidden max-h-[70vh] overflow-y-auto border-b border-line p-3 lg:block lg:border-b-0 lg:border-r" aria-label="Índice do manual">
          {groups.map(({ group, items }) => (
            <div key={group} className="mb-3">
              <p className="px-2 pb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-ink-faint">{group}</p>
              <ul className="space-y-0.5">
                {items.map((article) => {
                  const active = article.slug === slug;
                  return (
                    <li key={article.slug}>
                      <button
                        type="button"
                        className={`w-full rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                          active
                            ? 'bg-brand-50 font-semibold text-brand-700'
                            : 'text-ink-soft hover:bg-surface-lighter'
                        }`}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => selectArticle(article.slug)}
                      >
                        {article.title}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <article className="max-h-[70vh] overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
          <p className="mb-3 text-sm text-ink-muted">{current.summary}</p>
          <div className="manual-wiki-prose">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => <h1 className="mb-3 text-xl font-bold text-ink">{children}</h1>,
                h2: ({ children }) => <h2 className="mb-2 mt-6 text-base font-semibold text-ink">{children}</h2>,
                h3: ({ children }) => <h3 className="mb-2 mt-4 text-sm font-semibold text-ink-soft">{children}</h3>,
                p: ({ children }) => <p className="mb-3 text-sm leading-relaxed text-ink-soft">{children}</p>,
                ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-ink-soft">{children}</ul>,
                ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-ink-soft">{children}</ol>,
                li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
                blockquote: ({ children }) => (
                  <blockquote className="mb-4 rounded-r-lg border-l-4 border-success bg-success-soft px-3 py-2 text-sm text-ink-soft">
                    {children}
                  </blockquote>
                ),
                table: ({ children }) => (
                  <div className="mb-4 overflow-x-auto rounded-lg border border-line">
                    <table className="min-w-full text-left text-sm">{children}</table>
                  </div>
                ),
                thead: ({ children }) => <thead className="bg-surface-lighter text-ink">{children}</thead>,
                th: ({ children }) => <th className="border-b border-line px-3 py-2 font-semibold">{children}</th>,
                td: ({ children }) => <td className="border-b border-line px-3 py-2 text-ink-soft">{children}</td>,
                img: ({ src, alt }) => (
                  <figure className="my-4">
                    <img
                      src={src}
                      alt={alt ?? ''}
                      className="mx-auto max-h-[28rem] w-auto max-w-full rounded-xl border border-line object-contain shadow-sm"
                      loading="lazy"
                    />
                    {alt ? <figcaption className="mt-2 text-center text-xs text-ink-muted">{alt}</figcaption> : null}
                  </figure>
                ),
              }}
            >
              {markdown}
            </ReactMarkdown>
          </div>
        </article>
      </div>
    </div>
  );
}
