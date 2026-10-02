import type { Metadata } from "next";
import { DocsShell } from "@/components/docs-shell";
import { DOCS } from "@/content/docs";

export const metadata: Metadata = { title: "Docs", description: DOCS[0].description };

export default function DocsIndex() {
  return <DocsShell page={DOCS[0]} />;
}
