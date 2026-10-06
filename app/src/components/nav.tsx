"use client";

import { List, Question, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ConnectButton } from "./connect";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { useTour } from "./tour";

const LINKS = [
  { href: "/trade", label: "Trade" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/oracle", label: "Oracle" },
  { href: "/docs", label: "Docs" },
];

export function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const tour = useTour();
  useEffect(() => setOpen(false), [path]);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/75 backdrop-blur-xl supports-[not(backdrop-filter:blur(1px))]:bg-bg">
      <nav className="mx-auto flex h-16 max-w-[1280px] items-center gap-6 px-4 md:px-6">
        <Link href="/" aria-label="Rackrate home" className="shrink-0">
          <Logo />
        </Link>
        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => {
            const active = path === l.href || path.startsWith(`${l.href}/`);
            return (
              <Link key={l.href} href={l.href} className={`relative rounded-full px-3 py-1.5 text-sm transition ${active ? "text-ink" : "text-muted hover:text-ink"}`}>
                {active && <motion.span layoutId="nav-active" className="absolute inset-0 -z-10 rounded-full bg-surface-2" transition={{ type: "spring", stiffness: 400, damping: 34 }} />}
                {l.label}
              </Link>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={tour.open}
            aria-label="How Rackrate works"
            title="How Rackrate works"
            className="grid h-9 w-9 place-items-center rounded-full border border-line text-ink-2 transition hover:border-line-strong hover:text-ink active:scale-95"
          >
            <Question size={16} />
          </button>
          <ThemeToggle />
          <ConnectButton className="hidden sm:block" />
          <button className="grid h-9 w-9 place-items-center rounded-full border border-line md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>
            {open ? <X size={16} /> : <List size={16} />}
          </button>
        </div>
      </nav>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-line md:hidden">
            <div className="flex flex-col gap-1 px-4 py-3">
              {LINKS.map((l) => (
                <Link key={l.href} href={l.href} className="rounded-xl px-3 py-2.5 text-[15px] hover:bg-surface-2">
                  {l.label}
                </Link>
              ))}
              <ConnectButton className="mt-2 sm:hidden" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
