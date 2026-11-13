import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge, told Ward's @theme names (styles/index.css). Without the `text` list it reads
 * `text-ward-signpost` as a colour, so `cn("text-ward-signpost", "text-ward-text")` would drop one of the two. Keep
 * the lists in step with @theme.
 *
 * Every size carries a line height of its own, which a `leading-*` overrides, so a size must not remove a `leading-*`,
 * which tailwind-merge does by default: `cn("leading-6", "text-sm")` would lose the `leading-6`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["ward-signpost", "ward-mono"],
      radius: ["ward", "ward-card"],
      shadow: ["ward", "ward-lg"],
      container: ["ward", "ward-wide", "ward-account", "ward-pass"],
      font: ["ward", "ward-mono"],
      ease: ["ward"],
    },
    classGroups: {
      z: [{ z: ["overlay", "dialog"] }],
    },
  },
  override: {
    conflictingClassGroups: { "font-size": [] },
  },
});

/** Joins class names, and lets a later class win over an earlier one it conflicts with. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
