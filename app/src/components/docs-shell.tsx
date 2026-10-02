import Link from "next/link";
import { DOCS, type DocPage, docHref } from "@/content/docs";
import { DocsNav } from "./docs-nav";

export function DocsShell({ page }: { page: DocPage }) {
  const i = DOCS.findIndex((d) => d.slug === page.slug);
  const prev = DOCS[i - 1];
  const next = DOCS[i + 1];
  return (
    <div className="mx-auto grid max-w-[1280px] gap-10 px-4 py-10 md:grid-cols-[220px_1fr] md:px-6 md:py-14">
      <DocsNav />
      <article className="min-w-0">
        <p className="text-sm text-accent">Docs</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">{page.title}</h1>
        <p className="mt-3 text-lg text-ink-2">{page.description}</p>
        <div className="doc mt-6">{page.body}</div>
        <nav className="mt-14 grid gap-3 border-t border-line pt-6 sm:grid-cols-2" aria-label="Pagination">
          {prev ? (
            <Link href={docHref(prev.slug)} className="rounded-2xl border border-line p-4 transition hover:border-accent/50">
              <span className="text-xs text-muted">Previous</span>
              <span className="mt-1 block font-medium">{prev.title}</span>
            </Link>
          ) : <span />}
          {next && (
            <Link href={docHref(next.slug)} className="rounded-2xl border border-line p-4 text-right transition hover:border-accent/50">
              <span className="text-xs text-muted">Next</span>
              <span className="mt-1 block font-medium">{next.title}</span>
            </Link>
          )}
        </nav>
      </article>
    </div>
  );
}
