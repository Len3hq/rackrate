import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { LogoMark } from "@/components/logo";
import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-xl flex-col items-center justify-center px-4 py-20 text-center">
      <LogoMark size={56} />
      <p className="mt-6 font-mono text-sm text-accent">404</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">This page is off the curve.</h1>
      <p className="mt-3 text-ink-2">The address may be mistyped, or the page has moved.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <ButtonLink href="/">
          <ArrowLeft size={16} /> Back home
        </ButtonLink>
        <ButtonLink href="/trade" variant="secondary">
          Open the app
        </ButtonLink>
      </div>
    </div>
  );
}
