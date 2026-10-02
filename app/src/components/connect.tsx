"use client";

import { CaretDown, Copy, SignOut, Wallet } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { shortAddr } from "@/lib/format";
import { chain, explorer } from "@/lib/wagmi";
import { Button } from "./ui";

export function ConnectButton({ className = "" }: { className?: string }) {
  const { address, chainId, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!mounted) return <Button className={className} disabled>Connect wallet</Button>;

  if (isConnected && chainId !== chain.id) {
    return (
      <Button className={className} onClick={() => switchChain({ chainId: chain.id })}>
        Switch to Monad testnet
      </Button>
    );
  }

  // Distinct wallets discovered via EIP-6963, with the generic injected fallback last.
  const wallets = connectors.filter((c, i, all) => c.id !== "injected" || all.length === 1);

  return (
    <div ref={ref} className={`relative ${className}`}>
      {isConnected ? (
        <Button variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="h-2 w-2 rounded-full bg-mint" aria-hidden="true" />
          <span className="font-mono text-[13px]">{shortAddr(address)}</span>
          <CaretDown size={12} />
        </Button>
      ) : (
        <Button onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={isPending}>
          <Wallet size={16} /> {isPending ? "Connecting" : "Connect wallet"}
        </Button>
      )}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="absolute right-0 top-12 z-40 w-64 origin-top-right rounded-2xl border border-line-strong bg-surface p-2 shadow-card"
          >
            {isConnected ? (
              <>
                <button onClick={() => { navigator.clipboard.writeText(address ?? ""); setOpen(false); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-surface-2">
                  <Copy size={15} /> Copy address
                </button>
                <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer" className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-surface-2">
                  <Wallet size={15} /> View on explorer
                </a>
                <button onClick={() => { disconnect(); setOpen(false); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-rose hover:bg-rose-soft">
                  <SignOut size={15} /> Disconnect
                </button>
              </>
            ) : wallets.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted">No browser wallet found. Install Rabby or MetaMask, then reload.</p>
            ) : (
              wallets.map((c) => (
                <button key={c.uid} onClick={() => { connect({ connector: c, chainId: chain.id }); setOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm hover:bg-surface-2">
                  {c.icon ? <img src={c.icon} alt="" className="h-5 w-5 rounded" /> : <Wallet size={18} />}
                  {c.name === "Injected" ? "Browser wallet" : c.name}
                </button>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
