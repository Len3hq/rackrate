"use client";

import { ArrowUpRight, CheckCircle, CircleNotch, WarningCircle, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type Kind = "pending" | "success" | "error";
interface Toast {
  id: number;
  kind: Kind;
  title: string;
  body?: string;
  href?: string;
}

interface ToastApi {
  show: (t: Omit<Toast, "id">) => number;
  update: (id: number, t: Omit<Toast, "id">) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("ToastProvider missing");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const schedule = useCallback(
    (id: number, kind: Kind) => {
      clearTimeout(timers.current.get(id));
      if (kind !== "pending") timers.current.set(id, setTimeout(() => dismiss(id), kind === "error" ? 9000 : 6000));
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show: (t) => {
        const id = next.current++;
        setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
        schedule(id, t.kind);
        return id;
      },
      update: (id, t) => {
        setToasts((ts) => ts.map((x) => (x.id === id ? { ...t, id } : x)));
        schedule(id, t.kind);
      },
    }),
    [schedule],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
              className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-line-strong bg-surface p-4 shadow-card"
            >
              <span className="mt-0.5 shrink-0">
                {t.kind === "pending" && <CircleNotch size={18} className="animate-spin text-accent" />}
                {t.kind === "success" && <CheckCircle size={18} weight="fill" className="text-mint" />}
                {t.kind === "error" && <WarningCircle size={18} weight="fill" className="text-rose" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t.title}</p>
                {t.body && <p className="mt-0.5 text-sm text-muted break-words">{t.body}</p>}
                {t.href && (
                  <a href={t.href} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm text-accent hover:underline">
                    View on explorer <ArrowUpRight size={12} />
                  </a>
                )}
              </div>
              <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-muted hover:text-ink">
                <X size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
