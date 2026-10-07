"use client";

import { ArrowLeft, ArrowRight, Briefcase, CalendarBlank, ChartLineUp, CheckCircle, ClockCounterClockwise, Cpu, Drop, HandCoins, ShieldCheck, SignOut, Wallet, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * First-visit tour of the app. Opens automatically the first time someone lands on an app page (not the landing
 * page, which already explains the product) and can be reopened from the nav. Seen state is kept per browser.
 */
const SEEN_KEY = "rackrate-tour-v1";
const APP_PAGES = ["/trade", "/portfolio", "/oracle"];

const TourContext = createContext<{ open: () => void }>({ open: () => {} });
export const useTour = () => useContext(TourContext);

function Payoff() {
  // LONG and SHORT payouts across the $1 to $5 range: they always add up to the full $672.
  return (
    <svg viewBox="0 0 240 92" className="h-auto w-full" role="img" aria-label="LONG pays more as the average rises, SHORT pays more as it falls">
      <line x1="20" y1="76" x2="230" y2="76" stroke="var(--line-strong)" />
      <path d="M20 76 L230 12" stroke="var(--mint)" strokeWidth="2.5" fill="none" />
      <path d="M20 12 L230 76" stroke="var(--rose)" strokeWidth="2.5" fill="none" />
      <text x="232" y="14" textAnchor="end" className="fill-[var(--mint)] text-[10px]" dy="-4">LONG</text>
      <text x="22" y="14" className="fill-[var(--rose)] text-[10px]" dy="-4">SHORT</text>
      <text x="20" y="89" className="fill-[var(--muted)] font-mono text-[9px]">$1</text>
      <text x="125" y="89" textAnchor="middle" className="fill-[var(--muted)] font-mono text-[9px]">weekly average</text>
      <text x="230" y="89" textAnchor="end" className="fill-[var(--muted)] font-mono text-[9px]">$5</text>
    </svg>
  );
}


/** A worked example in the same terms the trade ticket shows. */
function Example({ rows, result }: { rows: [string, string][]; result: [string, string] }) {
  return (
    <div className="rounded-xl bg-surface-2 p-4 text-sm">
      <p className="mb-2 text-xs text-muted">Example, one GPU for one week</p>
      <dl className="space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <dt className="text-muted">{k}</dt>
            <dd className="font-mono tnum">{v}</dd>
          </div>
        ))}
        <div className="flex justify-between border-t border-line pt-1.5">
          <dt className="font-medium">{result[0]}</dt>
          <dd className="font-mono font-medium text-mint tnum">{result[1]}</dd>
        </div>
      </dl>
    </div>
  );
}

function Facts({ items }: { items: [React.ReactNode, string][] }) {
  return (
    <ul className="space-y-2">
      {items.map(([icon, text]) => (
        <li key={text} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5 text-sm text-ink-2">
          <span className="text-accent">{icon}</span>
          {text}
        </li>
      ))}
    </ul>
  );
}

interface Step {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
  visual?: React.ReactNode;
}

const STEPS: Step[] = [
  {
    icon: <ChartLineUp size={22} weight="duotone" />,
    title: "Lock in next week's GPU rate",
    body: (
      <>
        <p>H100 rental prices change every week. Rackrate lets GPU owners and AI teams agree on next week&apos;s price today.</p>
        <p>Everything here runs on Monad testnet with free test dollars. The H100 price follows what GPU clouds actually charge.</p>
      </>
    ),
    visual: (
      <Facts
        items={[
          [<CalendarBlank key="c" size={16} />, "One market per week, Monday to Monday"],
          [<ShieldCheck key="s" size={16} />, "Fully collateralized: no leverage, no liquidations"],
          [<ChartLineUp key="l" size={16} />, "Traded on Kuru, an onchain order book on Monad"],
        ]}
      />
    ),
  },
  {
    icon: <Cpu size={22} weight="duotone" />,
    title: "How a week works",
    body: (
      <>
        <p>Each week, Monday to Monday, is its own market. The price is recorded every hour, and the week settles on the average of all 168 hours.</p>
        <p>$672 creates a pair of tokens: <strong className="text-mint">LONG</strong> pays more if the average is high, <strong className="text-rose">SHORT</strong> pays more if it is low. Together they always pay back the full $672.</p>
      </>
    ),
    visual: <Payoff />,
  },
  {
    icon: <HandCoins size={22} weight="duotone" />,
    title: "Rent out GPUs? Hedge your revenue",
    body: (
      <>
        <p>
          Choose <strong>Hedge revenue</strong> on Trade, pick the weeks and how many GPUs. You keep SHORT plus cash from selling the LONG side.
        </p>
        <p>If prices fall, SHORT pays out and covers the lost rent, so your income per GPU-hour is fixed before the week starts.</p>
      </>
    ),
    visual: <Example rows={[["Collateral in", "$672.00"], ["Received now", "$466.00"], ["You hold", "1 SHORT"]]} result={["Locked revenue", "$3.77/hr"]} />,
  },
  {
    icon: <Briefcase size={22} weight="duotone" />,
    title: "Need compute? Lock your cost",
    body: (
      <>
        <p>
          Choose <strong>Lock compute cost</strong> and buy LONG for the weeks you will train.
        </p>
        <p>If prices rise, LONG pays out and covers the higher rent. The quote shows your locked rate per GPU-hour before you confirm.</p>
      </>
    ),
    visual: <Example rows={[["You spend", "$480.00"], ["You hold", "1 LONG"]]} result={["Locked cost", "$3.86/hr"]} />,
  },
  {
    icon: <Wallet size={22} weight="duotone" />,
    title: "Getting started",
    body: (
      <ol className="list-decimal space-y-1.5 pl-5">
        <li>
          Connect a browser wallet on Monad testnet. Get a little MON for gas from the{" "}
          <a href="https://faucet.monad.xyz" target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
            Monad faucet
          </a>
          .
        </li>
        <li>
          Press <strong>Get 10,000 test rrUSD</strong>, the free test dollar used for every trade.
        </li>
        <li>Approve rrUSD once, then confirm your hedge or purchase.</li>
      </ol>
    ),
    visual: (
      <div className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink-2">
        <Drop size={16} className="text-accent" /> Free test dollars, no real money
      </div>
    ),
  },
  {
    icon: <CheckCircle size={22} weight="duotone" />,
    title: "After you trade",
    body: (
      <>
        <p>
          <strong>Portfolio</strong> shows your positions and history. Use <strong>Close</strong> to exit before the week ends.
        </p>
        <p>
          When a week settles, press <strong>Claim</strong> to collect your payout in rrUSD. Read more in the{" "}
          <Link href="/docs" className="text-accent underline underline-offset-2">
            docs
          </Link>
          .
        </p>
      </>
    ),
    visual: (
      <Facts
        items={[
          [<SignOut key="o" size={16} />, "Close: exit a position before the week ends"],
          [<HandCoins key="h" size={16} />, "Claim: collect your payout once the week settles"],
          [<ClockCounterClockwise key="k" size={16} />, "History: every hedge, buy, close and claim"],
        ]}
      />
    ),
  },
];

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {}
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // First visit to an app page: open once, after the page has painted.
  useEffect(() => {
    if (!APP_PAGES.some((p) => path.startsWith(p))) return;
    let seen = true;
    try {
      seen = localStorage.getItem(SEEN_KEY) === "1";
    } catch {}
    if (seen) return;
    const t = setTimeout(() => {
      setStep(0);
      setOpen(true);
    }, 600);
    return () => clearTimeout(t);
  }, [path]);

  const show = useCallback(() => {
    setStep(0);
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    markSeen();
    setOpen(false);
  }, []);

  return (
    <TourContext.Provider value={{ open: show }}>
      {children}
      <AnimatePresence>{open && <TourDialog step={step} setStep={setStep} onClose={close} />}</AnimatePresence>
    </TourContext.Provider>
  );
}

function TourDialog({ step, setStep, onClose }: { step: number; setStep: (n: number) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const last = step === STEPS.length - 1;
  const s = STEPS[step];

  // Keyboard: arrows move between steps, Esc closes, Tab stays inside the dialog.
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setStep(Math.min(step + 1, STEPS.length - 1));
      else if (e.key === "ArrowLeft") setStep(Math.max(step - 1, 0));
      else if (e.key === "Tab" && dialog.current) {
        const items = dialog.current.querySelectorAll<HTMLElement>("button, a[href]");
        const first = items[0];
        const end = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          end.focus();
        } else if (!e.shiftKey && document.activeElement === end) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prevFocus?.focus?.();
    };
  }, [step, setStep, onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#0d0b12]/55 p-3 backdrop-blur-sm sm:items-center sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        className="relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-line-strong bg-surface p-6 shadow-card sm:p-7"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 360, damping: 32 }}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">
            {step + 1} of {STEPS.length}
          </span>
          <button onClick={onClose} aria-label="Close the tour" className="grid h-8 w-8 place-items-center rounded-full text-muted transition hover:bg-surface-2 hover:text-ink">
            <X size={16} />
          </button>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="mt-3 sm:min-h-[28rem]" // one height for every step, so Next and Back stay put
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent">{s.icon}</span>
            <h2 id="tour-title" className="mt-4 text-xl font-semibold tracking-tight">
              {s.title}
            </h2>
            <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-ink-2">{s.body}</div>
            {s.visual && <div className="mt-5">{s.visual}</div>}
          </motion.div>
        </AnimatePresence>

        <div className="mt-5 flex items-center justify-center" role="tablist" aria-label="Tour steps">
          {STEPS.map((x, i) => (
            <button
              key={x.title}
              role="tab"
              aria-selected={i === step}
              aria-label={`Step ${i + 1}: ${x.title}`}
              onClick={() => setStep(i)}
              className="group grid h-6 min-w-6 place-items-center" // 24px tap area around a small dot
            >
              <span className={`block h-1.5 rounded-full transition-all ${i === step ? "w-6 bg-accent" : "w-1.5 bg-line-strong group-hover:bg-muted"}`} />
            </button>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          {step === 0 ? (
            <button onClick={onClose} className="text-sm text-muted transition hover:text-ink">
              Skip tour
            </button>
          ) : (
            <button onClick={() => setStep(step - 1)} className="inline-flex items-center gap-1.5 text-sm text-ink-2 transition hover:text-ink">
              <ArrowLeft size={14} /> Back
            </button>
          )}
          <button
            data-autofocus
            onClick={() => (last ? onClose() : setStep(step + 1))}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-medium text-accent-ink transition active:translate-y-px hover:brightness-110"
          >
            {last ? "Start trading" : "Next"} {!last && <ArrowRight size={14} />}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
