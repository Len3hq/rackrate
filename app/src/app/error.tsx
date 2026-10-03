"use client";

import { ArrowClockwise } from "@phosphor-icons/react";
import { useEffect } from "react";
import { LogoMark } from "@/components/logo";
import { Button, ButtonLink } from "@/components/ui";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-xl flex-col items-center justify-center px-4 py-20 text-center">
      <LogoMark size={56} />
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">Something went wrong.</h1>
      <p className="mt-3 text-ink-2">This is usually a slow or unreachable Monad testnet RPC. Your funds are not affected.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button onClick={() => retry()}>
          <ArrowClockwise size={16} /> Try again
        </Button>
        <ButtonLink href="/" variant="secondary">
          Back home
        </ButtonLink>
      </div>
    </div>
  );
}
