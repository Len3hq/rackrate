"use client";

import { ArrowRight } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { ThreadsBackground } from "../threads-bg";
import { ButtonLink } from "../ui";
import { LiveCurve } from "./live-curve";

// The headline and subtext stay fully opaque and only rise into place, so they paint (and count as the largest
// contentful paint) immediately; the rest of the hero fades in.
const lift = (delay: number) => ({
  initial: { y: 14 },
  animate: { y: 0 },
  transition: { duration: 0.8, delay, ease: [0.16, 1, 0.3, 1] as const },
});
const rise = (delay: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.8, delay, ease: [0.16, 1, 0.3, 1] as const },
});

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <ThreadsBackground className="absolute inset-x-0 top-[-6%] h-[115%] opacity-70 [mask-image:radial-gradient(70%_70%_at_30%_45%,black,transparent)] dark:opacity-80" />
      <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_85%_10%,var(--accent-soft),transparent)]" aria-hidden="true" />
      <div className="relative mx-auto grid max-w-[1280px] items-center gap-12 px-4 pb-16 pt-14 md:min-h-[calc(100dvh-4rem)] md:grid-cols-[1.05fr_0.95fr] md:px-6 md:pb-20 md:pt-20 lg:gap-16">
        <div>
          <motion.h1 {...lift(0)} className="text-[42px] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-6xl lg:text-[76px]">
            Lock in next week&apos;s <span className="text-accent">GPU rate</span>.
          </motion.h1>
          <motion.p {...lift(0.08)} className="mt-6 max-w-[46ch] text-lg leading-relaxed text-ink-2">
            Weekly H100 rental-rate forwards on Monad. Hedge GPU revenue or cap compute costs in one transaction.
          </motion.p>
          <motion.div {...rise(0.25)} className="mt-9 flex flex-wrap gap-3">
            <ButtonLink href="/trade" size="lg">
              Open the app <ArrowRight size={16} />
            </ButtonLink>
            <ButtonLink href="/docs" size="lg" variant="secondary">
              Read the docs
            </ButtonLink>
          </motion.div>
        </div>
        <motion.div {...rise(0.3)}>
          <LiveCurve />
        </motion.div>
      </div>
    </section>
  );
}
