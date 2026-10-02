/** The Rackrate mark: a stepped rate line that settles into a fixed point. Colours follow the theme tokens. */
export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path d="M4.4 34 H12 V12 H18 V31 H24 V19 H30 V24" fill="none" stroke="var(--accent)" strokeWidth="3.2" strokeLinejoin="miter" />
      <rect x="29" y="22.4" width="13" height="3.2" fill="var(--mint)" />
      <circle cx="42" cy="24" r="3.6" fill="var(--mint)" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-tight">Rackrate</span>
    </span>
  );
}
