"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS, docHref } from "@/content/docs";

export function DocsNav() {
  const path = usePathname();
  return (
    <nav aria-label="Documentation" className="min-w-0 md:sticky md:top-24 md:self-start">
      <ul className="flex gap-1 overflow-x-auto pb-2 md:flex-col md:overflow-visible md:pb-0">
        {DOCS.map((d) => {
          const href = docHref(d.slug);
          const active = path === href;
          return (
            <li key={d.slug} className="shrink-0">
              <Link href={href} className={`relative block rounded-xl px-3 py-2 text-sm transition ${active ? "text-ink" : "text-muted hover:text-ink"}`}>
                {active && <motion.span layoutId="docs-active" className="absolute inset-0 -z-10 rounded-xl bg-surface-2" transition={{ type: "spring", stiffness: 400, damping: 34 }} />}
                {d.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
