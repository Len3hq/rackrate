import Link from "next/link";
import { deployment } from "@/lib/generated";
import { LogoMark } from "./logo";

const EXPLORER = "https://testnet.monadvision.com/address/";

export function Footer() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto grid max-w-[1280px] gap-10 px-4 py-12 md:grid-cols-[1.4fr_1fr_1fr] md:px-6">
        <div className="max-w-sm">
          <div className="flex items-center gap-2">
            <LogoMark size={24} />
            <span className="font-semibold">Rackrate</span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Weekly GPU rental-rate forwards on Monad testnet. The H100 index follows real GPU cloud prices (gpurentalprices.com, CC BY 4.0); every token is a test asset with no monetary value.
          </p>
        </div>
        <div>
          <p className="text-sm font-medium">Product</p>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li><Link className="hover:text-ink" href="/trade">Trade</Link></li>
            <li><Link className="hover:text-ink" href="/portfolio">Portfolio</Link></li>
            <li><Link className="hover:text-ink" href="/oracle">Oracle</Link></li>
            <li><Link className="hover:text-ink" href="/docs">Docs</Link></li>
            <li><a className="hover:text-ink" href="https://github.com/Len3hq/rackrate" target="_blank" rel="noreferrer">GitHub</a></li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-medium">Contracts</p>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            {(["RackOracle", "SeriesFactory", "HedgeRouter", "MarketRegistry", "rrUSD"] as const).map((k) => (
              <li key={k}>
                <a className="hover:text-ink" href={`${EXPLORER}${deployment[k]}`} target="_blank" rel="noreferrer">{k}</a>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mx-auto max-w-[1280px] px-4 pb-8 text-xs text-muted md:px-6">
        Photos via Wikimedia Commons: CSIRO (CC BY 3.0), Carl Lender (CC BY 2.0), Derrick Coetzee (CC0). Toned and cropped.
      </p>
    </footer>
  );
}
