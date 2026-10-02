import type { Metadata } from "next";
import { OracleView } from "@/components/oracle/view";

export const metadata: Metadata = { title: "Oracle", description: "The hourly H100 index: every print, gap and publisher submission." };

export default function OraclePage() {
  return <OracleView />;
}
