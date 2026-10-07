"use client";

/**
 * The landing page's argument: the problem (GPU prices differ and move), the market (exchanges are listing GPU
 * futures), why Rackrate brings it onchain, and how a week works. Outside claims carry a source link.
 */
import { ArrowDownRight, ArrowUpRight, Check, Minus } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { usd } from "@/lib/format";
import { providerName, useReference } from "@/lib/reference-data";
import { Reveal } from "../reveal";
import { Skeleton } from "../ui";
import { Section } from "./sections";

const EASE = [0.16, 1, 0.3, 1] as const;

function Kicker({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium uppercase tracking-[0.16em] text-accent">{children}</p>;
}

function SourceLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
      {children}
    </a>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// 1. The problem
// ---------------------------------------------------------------------------------------------------------------

/** Live: what each GPU cloud lists for the same H100 today, as horizontal bars with the median marked. */
function ProviderSpread() {
  const ref = useReference();
  const rows = ref.data?.providers ?? [];
  const latest = ref.data?.days.at(-1);
  const max = rows.length ? Math.max(...rows.map((r) => r.price)) : 1;
  const scale = (p: number) => `${Math.max(4, (p / max) * 100)}%`;

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-card md:p-7">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-medium">One H100, one hour, today</p>
        {latest && <p className="font-mono text-xs text-muted">{latest.date}</p>}
      </div>
      <p className="mt-1 text-sm text-muted">On-demand price listed by each GPU cloud, USD per GPU-hour.</p>

      <ul className="mt-5 space-y-2">
        {rows.length === 0 &&
          (ref.isError || ref.data ? (
            <li className="py-6 text-sm text-muted">Provider prices are unavailable right now.</li>
          ) : (
            Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-6 w-full" />)
          ))}
        {rows.map((r, i) => {
          const median = latest && Math.abs(r.price - latest.index) < 1e-9;
          return (
            <li key={r.provider} className="grid grid-cols-[7.5rem_1fr_4.5rem] items-center gap-3 text-sm">
              <span className="truncate text-ink-2">{providerName(r.provider)}</span>
              <span className="relative h-5 rounded-md bg-surface-2">
                <motion.span
                  className={`absolute inset-y-0 left-0 rounded-md ${median ? "bg-mint" : "bg-accent/70"}`}
                  initial={{ width: 0 }}
                  whileInView={{ width: scale(r.price) }}
                  viewport={{ once: true, amount: 0.4 }}
                  transition={{ duration: 0.9, delay: 0.05 * i, ease: EASE }}
                />
              </span>
              <span className={`text-right font-mono tnum ${median ? "text-mint" : ""}`}>{usd(r.price)}</span>
            </li>
          );
        })}
      </ul>

      {latest && rows.length > 0 && (
        <p className="mt-5 border-t border-line pt-4 text-xs leading-relaxed text-muted">
          Cheapest {usd(rows[0].price)}, most expensive {usd(rows.at(-1)?.price)}: a{" "}
          {((rows.at(-1)?.price ?? 0) / rows[0].price).toFixed(1)}x spread for the same chip. Median{" "}
          <span className="text-mint">{usd(latest.index)}</span> across {latest.providers} clouds. Data:{" "}
          <SourceLink href={ref.data?.source.url ?? "https://gpurentalprices.com"}>gpurentalprices.com</SourceLink>,{" "}
          <SourceLink href={ref.data?.source.licenseUrl ?? "https://creativecommons.org/licenses/by/4.0/"}>CC BY 4.0</SourceLink>.
        </p>
      )}
    </div>
  );
}

/** A small rate line falling or rising, for the two sides of the risk. */
function RiskLine({ rising }: { rising: boolean }) {
  const d = rising ? "M2 52 C 40 54, 60 40, 90 36 S 140 18, 178 8" : "M2 10 C 40 8, 60 22, 90 26 S 140 44, 178 54";
  return (
    <svg viewBox="0 0 180 60" className="h-14 w-full" aria-hidden="true">
      <motion.path
        d={d}
        fill="none"
        stroke="var(--rose)"
        strokeWidth={3}
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ duration: 1.2, ease: EASE }}
      />
    </svg>
  );
}

export function Problem() {
  return (
    <Section id="problem" className="mt-28">
      <Reveal>
        <Kicker>The problem</Kicker>
        <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight md:text-5xl md:leading-[1.05]">
          Same GPU. A different price at every cloud, and it moves.
        </h2>
        <p className="mt-4 max-w-[62ch] text-base leading-relaxed text-ink-2 md:text-lg">
          AI runs on rented GPUs, and the rental rate is set by supply and demand. Nobody can lock in next week&apos;s price, so both sides of every
          rental carry the risk.
        </p>
      </Reveal>

      <div className="mt-10 grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <Reveal>
          <ProviderSpread />
        </Reveal>

        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Reveal delay={0.06}>
              <div className="h-full rounded-2xl border border-line bg-surface p-5 shadow-card">
                <p className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.14em] text-rose">
                  <ArrowDownRight size={14} weight="bold" /> GPU owners
                </p>
                <p className="mt-3 text-lg font-semibold leading-snug tracking-tight">Rates fall, revenue falls.</p>
                <RiskLine rising={false} />
                <p className="text-sm leading-relaxed text-ink-2">Neoclouds and GPU hosts finance hardware against income they cannot fix in advance.</p>
              </div>
            </Reveal>
            <Reveal delay={0.12}>
              <div className="h-full rounded-2xl border border-line bg-surface p-5 shadow-card">
                <p className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.14em] text-rose">
                  <ArrowUpRight size={14} weight="bold" /> AI teams
                </p>
                <p className="mt-3 text-lg font-semibold leading-snug tracking-tight">Rates rise, budgets break.</p>
                <RiskLine rising />
                <p className="text-sm leading-relaxed text-ink-2">A training run planned at one price can cost far more by the time it starts.</p>
              </div>
            </Reveal>
          </div>

          <Reveal delay={0.16}>
            <div className="rounded-2xl border border-line bg-[linear-gradient(150deg,var(--accent),#2a1680)] p-6 text-[#f3f1f9] shadow-card">
              <p className="font-mono text-4xl font-medium tracking-tight tnum md:text-5xl">+48%</p>
              <p className="mt-2 max-w-[44ch] text-sm leading-relaxed text-[#e4defc]">
                Nvidia Blackwell rental prices in two months, from $2.75 to $4.08 per GPU-hour (mid-February to mid-April 2026).
              </p>
              <p className="mt-3 text-xs text-[#cfc8f5]">
                Ornn index, via <SourceLink href="https://thenextweb.com/news/ice-nyse-compute-futures-market-gpu-ai">The Next Web</SourceLink>
              </p>
            </div>
          </Reveal>

          <Reveal delay={0.2}>
            <figure className="relative overflow-hidden rounded-2xl border border-line bg-surface p-6 pl-8 shadow-card md:p-8 md:pl-10">
              <span className="absolute inset-y-6 left-0 w-1 rounded-r-full bg-accent md:inset-y-8" aria-hidden="true" />
              <span className="pointer-events-none absolute right-5 top-1 select-none font-serif text-[120px] leading-[0.8] text-accent/15" aria-hidden="true">
                &rdquo;
              </span>
              <blockquote className="relative text-xl font-medium italic leading-snug tracking-tight text-ink md:text-2xl">
                <span className="text-accent">&ldquo;</span>Businesses have often paid vastly different prices for the same computing capacity with no way
                to compare deals.<span className="text-accent">&rdquo;</span>
              </blockquote>
              <figcaption className="relative mt-5 flex items-center gap-3 text-sm">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft font-semibold text-accent" aria-hidden="true">
                  CL
                </span>
                <span>
                  <span className="block font-medium text-ink">Carmen Li</span>
                  <span className="text-muted">
                    CEO, Silicon Data, on{" "}
                    <SourceLink href="https://www.leaprate.com/financial-services/exchanges/cme-group-and-silicon-data-to-roll-out-compute-futures-this-october/">
                      CME&apos;s compute futures
                    </SourceLink>
                  </span>
                </span>
              </figcaption>
            </figure>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// 2. The market
// ---------------------------------------------------------------------------------------------------------------

const TIMELINE = [
  {
    date: "May 12, 2026",
    title: "CME Group and Silicon Data announce compute futures",
    body: "The world's largest derivatives exchange plans futures on H100 and B200 rental prices.",
    href: "https://www.cmegroup.com/media-room/press-releases/2026/8/11/cme_group_and_silicondatatolaunchcomputefuturesonoctober5tounloc.html",
  },
  {
    date: "May 19, 2026",
    title: "ICE and Ornn announce GPU compute futures",
    body: "The owner of the New York Stock Exchange plans cash-settled futures on Ornn's GPU price index.",
    href: "https://thenextweb.com/news/ice-nyse-compute-futures-market-gpu-ai",
  },
  {
    date: "Jun 24, 2026",
    title: "Ornn raises $33M led by a16z",
    body: "Venture money backs financial infrastructure for hedging GPU prices.",
    href: "https://aiweekly.co/alerts/ornn-raises-33m-led-by-a16z-to-build-gpu-compute-futures-market",
  },
  {
    date: "Oct 5, 2026",
    title: "CME lists H100 and B200 rental index futures",
    body: "Scheduled first listing on NYMEX: one contract is 730 GPU-hours, a month of one GPU, settled in cash.",
    href: "https://financefeeds.com/cme-is-about-to-list-futures-on-the-price-of-renting-a-gpu/",
  },
];

export function Market() {
  return (
    <Section id="market" className="mt-28">
      <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <Reveal>
          <Kicker>The market</Kicker>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-5xl md:leading-[1.05]">Wall Street has started trading GPU-hours.</h2>
          <p className="mt-4 max-w-[48ch] leading-relaxed text-ink-2">
            When a cost is large and volatile, markets build futures for it: oil, power, freight. GPU compute is next, and the biggest exchanges are
            already moving.
          </p>
          <div className="mt-8 rounded-2xl border border-line bg-surface p-6 shadow-card">
            <p className="font-mono text-4xl font-medium tracking-tight tnum md:text-5xl">
              $52B<span className="text-xl text-muted"> / year</span>
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">Estimated GPU rental spend in 2026, growing about 30% a year.</p>
            <p className="mt-3 text-xs text-muted">
              Estimate: <SourceLink href="https://www.mordorintelligence.com/industry-reports/gpu-rental-market">Mordor Intelligence</SourceLink>. Other
              estimates vary with how the market is defined.
            </p>
          </div>
        </Reveal>

        <ol className="relative">
          <motion.span
            className="absolute left-[7px] top-2 w-px origin-top bg-accent"
            style={{ bottom: "0.5rem" }}
            initial={{ scaleY: 0 }}
            whileInView={{ scaleY: 1 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 1.4, ease: EASE }}
            aria-hidden="true"
          />
          {TIMELINE.map((t, i) => (
            <Reveal key={t.date} as="li" delay={0.1 + i * 0.12} className="relative pb-8 pl-10 last:pb-0">
              <span
                className={`absolute left-0 top-1.5 h-[15px] w-[15px] rounded-full border-2 ${i === TIMELINE.length - 1 ? "border-mint bg-mint" : "border-accent bg-surface"}`}
                aria-hidden="true"
              />
              <p className="font-mono text-sm text-accent">{t.date}</p>
              <p className="mt-1 text-lg font-semibold leading-snug tracking-tight">{t.title}</p>
              <p className="mt-1 max-w-[56ch] text-sm leading-relaxed text-ink-2">
                {t.body}{" "}
                <a href={t.href} target="_blank" rel="noreferrer" className="text-muted underline decoration-line-strong underline-offset-2 hover:text-ink">
                  Source
                </a>
              </p>
            </Reveal>
          ))}
        </ol>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Why onchain
// ---------------------------------------------------------------------------------------------------------------

const COMPARE: { label: string; them: string; us: string }[] = [
  { label: "Who can trade", them: "Firms with a futures broker account", us: "Anyone with a wallet" },
  { label: "Contract", them: "One month (730 GPU-hours)", us: "One week (168 GPU-hours), so smaller and nearer" },
  { label: "Risk", them: "Margin, marked to market daily", us: "Fully collateralized: $672 per pair up front, nothing to liquidate" },
  { label: "Trading hours", them: "Exchange hours", us: "24/7 on Kuru's onchain order book" },
  { label: "Price data", them: "Licensed, proprietary indices", us: "Open data, every hourly print onchain and auditable" },
  { label: "What you hold", them: "A position at a clearing member", us: "LONG and SHORT tokens in your own wallet" },
];

export function WhyOnchain() {
  return (
    <Section id="why-onchain" className="mt-28">
      <Reveal>
        <Kicker>Why onchain</Kicker>
        <h2 className="mt-3 max-w-5xl text-3xl font-semibold tracking-tight md:text-5xl md:leading-[1.05]">
          Exchange futures serve institutions. Rackrate serves everyone who rents or rents out GPUs.
        </h2>
        <p className="mt-4 max-w-[62ch] text-base leading-relaxed text-ink-2 md:text-lg">
          Most GPU hosts and AI startups will never open a futures account. Rackrate brings the same hedge onchain, in weekly sizes, with no margin.
        </p>
      </Reveal>

      <Reveal delay={0.08}>
        <div className="mt-10 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          <div className="grid grid-cols-[1fr_1fr] border-b border-line text-sm md:grid-cols-[0.7fr_1fr_1fr]">
            <span className="hidden px-6 py-4 text-muted md:block" />
            <span className="px-4 py-4 font-medium text-muted md:px-6">CME / ICE compute futures</span>
            <span className="bg-accent-soft px-4 py-4 font-medium text-accent md:px-6">Rackrate</span>
          </div>
          {COMPARE.map((r, i) => (
            <motion.div
              key={r.label}
              className="grid grid-cols-[1fr_1fr] border-b border-line text-sm last:border-b-0 md:grid-cols-[0.7fr_1fr_1fr]"
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true, amount: 0.5 }}
              transition={{ duration: 0.5, delay: 0.06 * i }}
            >
              <span className="col-span-2 px-4 pt-4 text-xs font-medium uppercase tracking-[0.12em] text-muted md:col-span-1 md:px-6 md:py-4 md:text-sm md:normal-case md:tracking-normal">
                {r.label}
              </span>
              <span className="flex items-start gap-2 px-4 py-3 text-ink-2 md:px-6 md:py-4">
                <Minus size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
                {r.them}
              </span>
              <span className="flex items-start gap-2 bg-accent-soft px-4 py-3 md:px-6 md:py-4">
                <Check size={16} weight="bold" className="mt-0.5 shrink-0 text-mint" aria-hidden="true" />
                {r.us}
              </span>
            </motion.div>
          ))}
        </div>
        <p className="mt-4 max-w-[80ch] text-sm leading-relaxed text-muted">
          Why Monad: an onchain order book and an oracle that prints every hour need fast, cheap blocks. Rackrate trades on Kuru&apos;s order book and
          finalizes all 168 hourly prices of every week onchain. Testnet today.
        </p>
      </Reveal>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// 4. How a week works
// ---------------------------------------------------------------------------------------------------------------

function MintArt() {
  return (
    <svg viewBox="0 0 220 110" className="h-full w-full" aria-hidden="true">
      <rect x="12" y="35" width="72" height="40" rx="10" fill="var(--surface-2)" stroke="var(--line-strong)" />
      <text x="48" y="60" textAnchor="middle" className="fill-[var(--ink)] font-mono text-[14px]">$672</text>
      <motion.path d="M92 55 H124" stroke="var(--accent)" strokeWidth="2" markerEnd="url(#arr)" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.3 }} />
      <rect x="134" y="16" width="74" height="32" rx="16" fill="var(--mint-soft)" stroke="var(--mint)" />
      <text x="171" y="36" textAnchor="middle" className="fill-[var(--mint)] text-[12px] font-semibold">LONG</text>
      <rect x="134" y="62" width="74" height="32" rx="16" fill="var(--rose-soft)" stroke="var(--rose)" />
      <text x="171" y="82" textAnchor="middle" className="fill-[var(--rose)] text-[12px] font-semibold">SHORT</text>
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L10 5 L0 10z" fill="var(--accent)" />
        </marker>
      </defs>
    </svg>
  );
}

function TradeArt() {
  return (
    <svg viewBox="0 0 220 110" className="h-full w-full" aria-hidden="true">
      <text x="10" y="30" className="fill-[var(--muted)] text-[11px]">GPU owner</text>
      <text x="210" y="30" textAnchor="end" className="fill-[var(--muted)] text-[11px]">AI team</text>
      <rect x="76" y="40" width="68" height="44" rx="10" fill="var(--surface-2)" stroke="var(--line-strong)" />
      <text x="110" y="60" textAnchor="middle" className="fill-[var(--ink)] text-[11px] font-semibold">Kuru</text>
      <text x="110" y="75" textAnchor="middle" className="fill-[var(--muted)] text-[9px]">order book</text>
      <motion.path d="M14 62 H68" stroke="var(--mint)" strokeWidth="2" strokeDasharray="4 4" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 0.7, delay: 0.2 }} />
      <motion.path d="M152 62 H206" stroke="var(--mint)" strokeWidth="2" strokeDasharray="4 4" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 0.7, delay: 0.5 }} />
      <text x="40" y="54" textAnchor="middle" className="fill-[var(--mint)] text-[10px]">sells LONG</text>
      <text x="180" y="54" textAnchor="middle" className="fill-[var(--mint)] text-[10px]">buys LONG</text>
    </svg>
  );
}

function PrintArt() {
  const bars = Array.from({ length: 28 }, (_, i) => 26 + 10 * Math.sin(i / 2.2) + 6 * Math.sin(i * 1.7));
  return (
    <svg viewBox="0 0 220 110" className="h-full w-full" aria-hidden="true">
      {bars.map((h, i) => (
        <motion.rect
          key={i}
          x={10 + i * 7.2}
          width="4.4"
          rx="1.5"
          fill="var(--accent)"
          initial={{ height: 0, y: 92 }}
          whileInView={{ height: h, y: 92 - h }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.03 * i }}
        />
      ))}
      <motion.line x1="8" x2="212" y1="62" y2="62" stroke="var(--mint)" strokeWidth="2" strokeDasharray="5 4" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 0.8, delay: 1 }} />
      <text x="212" y="14" textAnchor="end" className="fill-[var(--mint)] text-[10px]">- - weekly average</text>
      <text x="10" y="106" className="fill-[var(--muted)] text-[9px]">168 hourly prints</text>
    </svg>
  );
}

function SettleArt() {
  return (
    <svg viewBox="0 0 220 110" className="h-full w-full" aria-hidden="true">
      <text x="10" y="22" className="fill-[var(--muted)] text-[10px]">$672 splits by the weekly average</text>
      <rect x="10" y="34" width="200" height="30" rx="8" fill="var(--surface-2)" />
      <motion.rect x="10" y="34" height="30" rx="8" fill="var(--mint)" initial={{ width: 0 }} whileInView={{ width: 108 }} viewport={{ once: true }} transition={{ duration: 0.8, delay: 0.2, ease: EASE }} />
      <motion.rect y="34" height="30" rx="8" fill="var(--rose)" initial={{ width: 0, x: 210 }} whileInView={{ width: 92, x: 118 }} viewport={{ once: true }} transition={{ duration: 0.8, delay: 0.2, ease: EASE }} />
      <text x="10" y="84" className="fill-[var(--mint)] font-mono text-[10px]">LONG (avg - $1) x 168</text>
      <text x="210" y="100" textAnchor="end" className="fill-[var(--rose)] font-mono text-[10px]">SHORT ($5 - avg) x 168</text>
    </svg>
  );
}

const FLOW = [
  {
    step: "1",
    name: "Mint",
    body: "Deposit $672 to mint one LONG and one SHORT: one GPU for one week, priced between $1 and $5 an hour.",
    art: <MintArt />,
  },
  {
    step: "2",
    name: "Trade",
    body: "GPU owners sell LONG and keep SHORT. AI teams buy LONG. The HedgeRouter does a multi-week hedge in one transaction.",
    art: <TradeArt />,
  },
  {
    step: "3",
    name: "Print",
    body: "Every hour, three publishers (two bots and a Chainlink CRE workflow) submit the real H100 price. The median is finalized onchain.",
    art: <PrintArt />,
  },
  {
    step: "4",
    name: "Settle",
    body: "After 168 hours the pair pays out the $672: LONG what the week averaged above $1, SHORT the rest.",
    art: <SettleArt />,
  },
];

export function HowItWorks() {
  return (
    <Section id="how" className="mt-28">
      <Reveal>
        <Kicker>How a week works</Kicker>
        <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight md:text-5xl md:leading-[1.05]">One GPU-week, from deposit to payout.</h2>
      </Reveal>
      <ol className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {FLOW.map((f, i) => (
          <Reveal key={f.name} as="li" delay={0.08 * i} className="h-full">
            <div className="flex h-full flex-col rounded-2xl border border-line bg-surface p-5 shadow-card">
              <div className="aspect-[2/1] w-full rounded-xl bg-bg/60 p-2">{f.art}</div>
              <p className="mt-5 flex items-center gap-2 font-mono text-sm text-accent">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-xs">{f.step}</span>
                {f.name}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">{f.body}</p>
            </div>
          </Reveal>
        ))}
      </ol>
    </Section>
  );
}
