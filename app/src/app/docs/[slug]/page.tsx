import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsShell } from "@/components/docs-shell";
import { DOCS } from "@/content/docs";

export const dynamicParams = false;

export function generateStaticParams() {
  return DOCS.filter((d) => d.slug).map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = DOCS.find((d) => d.slug === slug);
  return page ? { title: page.title, description: page.description } : {};
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = DOCS.find((d) => d.slug === slug);
  if (!page) notFound();
  return <DocsShell page={page} />;
}
