import Link from "next/link";

/** Shared primitives. Radius rule: buttons pill, cards 16px (rounded-2xl), inputs and chips 12px (rounded-xl). */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost"; size?: "md" | "lg" };

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition duration-200 ease-out-expo active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50";
const variants = {
  primary: "bg-accent text-accent-ink hover:brightness-110 shadow-[0_8px_24px_-12px_var(--accent)]",
  secondary: "border border-line-strong bg-surface text-ink hover:border-accent/50",
  ghost: "text-ink-2 hover:text-ink hover:bg-surface-2",
};
const sizes = { md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-[15px]" };

export function Button({ variant = "primary", size = "md", className = "", ...props }: ButtonProps) {
  return <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props} />;
}

export function ButtonLink({ href, variant = "primary", size = "md", className = "", children }: { href: string; variant?: keyof typeof variants; size?: keyof typeof sizes; className?: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}>
      {children}
    </Link>
  );
}

export function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`rounded-2xl border border-line bg-surface shadow-card ${className}`}>{children}</div>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`skeleton block ${className}`} aria-hidden="true" />;
}

export function Pill({ tone = "neutral", children }: { tone?: "neutral" | "mint" | "rose" | "accent"; children: React.ReactNode }) {
  const tones = {
    neutral: "bg-surface-2 text-ink-2",
    mint: "bg-mint-soft text-mint",
    rose: "bg-rose-soft text-rose",
    accent: "bg-accent-soft text-accent",
  };
  return <span className={`inline-flex items-center gap-1 rounded-xl px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
