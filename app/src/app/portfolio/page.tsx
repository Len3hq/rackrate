import type { Metadata } from "next";
import { PortfolioView } from "@/components/portfolio/view";

export const metadata: Metadata = { title: "Portfolio", description: "Your rrUSD, Rackrate positions and payouts." };

export default function PortfolioPage() {
  return <PortfolioView />;
}
