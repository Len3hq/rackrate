import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { Hero } from "@/components/landing/hero";
import { Audiences, Features, LaunchVideo, Lifecycle, OracleSection, PayoffExplorer, StatsBand } from "@/components/landing/sections";
import { ThreadsBackground } from "@/components/threads-bg";
import { ButtonLink } from "@/components/ui";

export default function Home() {
  return (
    <>
      <Hero />
      <StatsBand />
      <LaunchVideo />
      <Audiences />
      <PayoffExplorer />
      <Lifecycle />
      <OracleSection />
      <Features />
      <section className="mx-auto mt-28 max-w-[1280px] px-4 md:px-6">
        <div className="relative overflow-hidden rounded-2xl border border-line bg-surface px-6 py-16 text-center shadow-card md:py-24">
          <ThreadsBackground className="absolute inset-x-0 bottom-[-30%] h-[70%] opacity-50" />
          <div className="relative">
            <h2 className="mx-auto max-w-3xl text-3xl font-semibold tracking-tight md:text-5xl md:leading-[1.05]">Price next week&apos;s compute today.</h2>
            <p className="mx-auto mt-4 max-w-[52ch] text-ink-2">
              Testnet only. The H100 index follows real GPU cloud prices, and rrUSD is a free test dollar from the faucet.
            </p>
            <div className="mt-8 flex justify-center">
              <ButtonLink href="/trade" size="lg">
                Open the app <ArrowRight size={16} />
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
