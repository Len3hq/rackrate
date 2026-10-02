import type { Metadata } from "next";
import { TradeView } from "@/components/trade/view";

export const metadata: Metadata = { title: "Trade", description: "Hedge GPU revenue or lock compute costs on weekly H100 forwards." };

export default function TradePage() {
  return <TradeView />;
}
