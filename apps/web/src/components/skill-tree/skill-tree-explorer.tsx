"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { KeyboardEvent } from "react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { DeckSummary, SkillNode } from "@/lib/skill-tree-types";
import { cn } from "@/lib/utils";

const LEVEL_LABELS = [
  "Unaware",
  "Novice",
  "Beginner",
  "Intermediate",
  "Advanced",
  "Elite",
] as const;

const LEVEL_THEMES = [
  {
    indicator: "bg-muted-foreground",
    rail: "bg-muted-foreground/70",
    text: "text-muted-foreground",
    badge: "border-muted-foreground/40 bg-muted/40 text-muted-foreground",
    glow: "hover:ring-muted-foreground/25",
  },
  {
    indicator: "bg-chart-3",
    rail: "bg-chart-3",
    text: "text-chart-3",
    badge: "border-chart-3/40 bg-chart-3/10 text-chart-3",
    glow: "hover:ring-chart-3/30",
  },
  {
    indicator: "bg-chart-2",
    rail: "bg-chart-2",
    text: "text-chart-2",
    badge: "border-chart-2/40 bg-chart-2/10 text-chart-2",
    glow: "hover:ring-chart-2/30",
  },
  {
    indicator: "bg-primary",
    rail: "bg-primary",
    text: "text-primary",
    badge: "border-primary/40 bg-primary/10 text-primary",
    glow: "hover:ring-primary/30",
  },
  {
    indicator: "bg-chart-1",
    rail: "bg-chart-1",
    text: "text-chart-1",
    badge: "border-chart-1/40 bg-chart-1/10 text-chart-1",
    glow: "hover:ring-chart-1/30",
  },
  {
    indicator: "bg-chart-4",
    rail: "bg-chart-4",
    text: "text-chart-4",
    badge: "border-chart-4/40 bg-chart-4/10 text-chart-4",
    glow: "hover:ring-chart-4/30",
  },
] as const;

interface SkillTreeListProps {
  skills: SkillNode[];
  depth: number;
  expandedSkillIDs: Set<number>;
  onToggleSkill: (skillID: number) => void;
}

export function SkillTreeExplorer({ skills }: { skills: SkillNode[] }) {
  const [expandedSkillIDs, setExpandedSkillIDs] = useState<Set<number>>(
    () => new Set(),
  );

  const toggleSkill = (skillID: number) => {
    setExpandedSkillIDs((previous) => {
      const next = new Set(previous);
      if (next.has(skillID)) {
        next.delete(skillID);
      } else {
        next.add(skillID);
      }
      return next;
    });
  };

  return (
    <SkillTreeList
      depth={0}
      expandedSkillIDs={expandedSkillIDs}
      onToggleSkill={toggleSkill}
      skills={skills}
    />
  );
}

function SkillTreeList({
  skills,
  depth,
  expandedSkillIDs,
  onToggleSkill,
}: SkillTreeListProps) {
  return (
    <div
      className={
        depth === 0
          ? "space-y-6"
          : "mt-6 ml-2 space-y-6 border-l-2 border-border/80 pl-7 sm:pl-11"
      }
    >
      {skills.map((skill) => {
        const theme = LEVEL_THEMES[skill.level];
        const childCount = skill.children?.length ?? 0;
        const hasChildren = childCount > 0;
        const isExpanded = hasChildren && expandedSkillIDs.has(skill.id);

        const handleToggle = () => {
          if (!hasChildren) {
            return;
          }
          onToggleSkill(skill.id);
        };

        const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
          if (!hasChildren) {
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggleSkill(skill.id);
          }
        };

        return (
          <div key={skill.id} className="space-y-6">
            <div
              aria-expanded={hasChildren ? isExpanded : undefined}
              className={cn(
                "group relative rounded-2xl border border-border/70 bg-card transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                depth === 0
                  ? "w-full p-5 shadow-md sm:p-6"
                  : "w-full p-4 shadow-sm sm:p-5",
                hasChildren ? "cursor-pointer" : "cursor-default",
                hasChildren ? "hover:-translate-y-0.5 hover:bg-accent/40" : "",
                hasChildren ? theme.glow : "",
              )}
              onClick={handleToggle}
              onKeyDown={handleKeyDown}
              role={hasChildren ? "button" : undefined}
              tabIndex={hasChildren ? 0 : undefined}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute inset-y-3 left-2 w-1 rounded-full",
                  theme.rail,
                )}
              />
              <div className="pl-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{skill.name}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {hasChildren ? (
                      <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground/80">
                        {isExpanded ? "Collapse" : "Expand"}
                      </span>
                    ) : null}
                    <Badge
                      className={cn("font-medium", theme.badge)}
                      variant="outline"
                    >
                      {skill.level}/5 {LEVEL_LABELS[skill.level]}
                    </Badge>
                  </div>
                </div>
                {skill.description ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {skill.description}
                  </p>
                ) : null}
                <Progress
                  className="mt-4 mb-4 h-2 bg-muted/60"
                  indicatorClassName={theme.indicator}
                  value={skill.level * 20}
                />
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-zinc-700/80 px-2 py-0.5 text-zinc-200">
                    {skill.decks?.length ?? 0} decks
                  </span>
                  <span className="rounded-full bg-zinc-700/80 px-2 py-0.5 text-zinc-200">
                    {skill.scenarios?.length ?? 0} scenarios
                  </span>
                  <span className="rounded-full bg-zinc-700/80 px-2 py-0.5 text-zinc-200">
                    {childCount} children
                  </span>
                </div>
                {(skill.decks?.length ?? 0) > 0 ? (
                  <div className="mt-4 space-y-2">
                    {(skill.decks ?? []).slice(0, 3).map((deck) => (
                      <DeckCoverage deck={deck} key={deck.id} />
                    ))}
                    {(skill.decks?.length ?? 0) > 3 ? (
                      <p className="text-xs text-muted-foreground">
                        +{(skill.decks?.length ?? 0) - 3} more decks
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <AnimatePresence initial={false}>
              {isExpanded ? (
                <motion.div
                  animate={{ height: "auto", opacity: 1 }}
                  className="overflow-hidden"
                  exit={{ height: 0, opacity: 0 }}
                  initial={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: "easeInOut" }}
                >
                  <SkillTreeList
                    depth={depth + 1}
                    expandedSkillIDs={expandedSkillIDs}
                    onToggleSkill={onToggleSkill}
                    skills={skill.children ?? []}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

function DeckCoverage({ deck }: { deck: DeckSummary }) {
  const percent =
    deck.card_count > 0
      ? Math.round((deck.covered_count / deck.card_count) * 100)
      : 0;

  return (
    <Link
      className="block w-full rounded-md bg-muted/40 p-2 text-xs transition hover:bg-muted/55"
      href={`/review?deckId=${deck.id}&back=/`}
      onClick={(event) => {
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
      }}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="truncate font-medium">{deck.name}</p>
        <span className="text-muted-foreground">
          {deck.covered_count}/{deck.card_count}
        </span>
      </div>
      <Progress
        className="h-1.5 bg-muted/70"
        indicatorClassName="bg-chart-2/85"
        value={percent}
      />
    </Link>
  );
}
