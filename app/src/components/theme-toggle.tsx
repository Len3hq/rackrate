"use client";

import { Moon, Sun } from "@phosphor-icons/react";
import { useTheme } from "@/lib/theme";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="grid h-9 w-9 place-items-center rounded-full border border-line text-ink-2 transition hover:border-line-strong hover:text-ink active:scale-95"
    >
      {theme === null ? <span className="h-4 w-4" /> : dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
