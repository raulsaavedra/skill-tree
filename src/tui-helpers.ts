import { clampLevel } from "./store.ts";

export const LEVEL_LABELS = [
  "Unaware",
  "Novice",
  "Beginner",
  "Intermediate",
  "Advanced",
  "Elite",
];

export const LEVEL_DESCRIPTIONS = [
  "Haven't touched it",
  "Know the concept exists, can describe it",
  "Can do with docs/guidance open",
  "Can do solo without reference",
  "Confident, could teach others",
  "Deep understanding, can debug edge cases",
];

export const LEVEL_COLORS = [
  "gray",
  "white",
  "blue",
  "cyan",
  "green",
  "yellow",
];

export const STATUS_ICONS: Record<string, string> = {
  planned: "○",
  in_progress: "◉",
  completed: "✓",
  abandoned: "✗",
};

export function levelLabel(level: number): string {
  return LEVEL_LABELS[clampLevel(level)];
}

export function levelBar(level: number): string {
  const l = clampLevel(level);
  return "█".repeat(l) + "░".repeat(5 - l);
}
