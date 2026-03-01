"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { KeyboardEvent } from "react";
import { useState } from "react";

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
    glow: "hover:ring-muted-foreground/25",
  },
  {
    indicator: "bg-chart-3",
    rail: "bg-chart-3",
    text: "text-chart-3",
    glow: "hover:ring-chart-3/30",
  },
  {
    indicator: "bg-chart-2",
    rail: "bg-chart-2",
    text: "text-chart-2",
    glow: "hover:ring-chart-2/30",
  },
  {
    indicator: "bg-primary",
    rail: "bg-primary",
    text: "text-primary",
    glow: "hover:ring-primary/30",
  },
  {
    indicator: "bg-chart-1",
    rail: "bg-chart-1",
    text: "text-chart-1",
    glow: "hover:ring-chart-1/30",
  },
  {
    indicator: "bg-chart-4",
    rail: "bg-chart-4",
    text: "text-chart-4",
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
          ? "space-y-5 sm:space-y-6"
          : "mt-4 space-y-4 border-l border-border/70 pl-3 sm:mt-6 sm:ml-2 sm:space-y-6 sm:border-l-2 sm:border-border/80 sm:pl-11"
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
          <div key={skill.id} className="space-y-4 sm:space-y-6">
            <div
              aria-expanded={hasChildren ? isExpanded : undefined}
              className={cn(
                "group relative rounded-2xl border border-border/70 bg-card transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                depth === 0
                  ? "w-full p-5 shadow-md sm:p-6"
                  : "w-full p-5 shadow-sm sm:p-5",
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
                  "absolute inset-y-3 left-1.5 w-0.5 rounded-full sm:left-2 sm:w-1",
                  theme.rail,
                )}
              />
              <div className="pl-3 sm:pl-4">
                <div className="space-y-2 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-2 sm:space-y-0">
                  <p className="font-medium leading-snug">{skill.name}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
                    {hasChildren ? (
                      <span className="text-muted-foreground">
                        {isExpanded ? "Collapse" : "Expand"}
                      </span>
                    ) : null}
                    <span className={cn("font-medium", theme.text)}>
                      {skill.level}/5 {LEVEL_LABELS[skill.level]}
                    </span>
                  </div>
                </div>
                {skill.description ? (
                  <p className="mt-2.5 mb-1.5 text-sm text-muted-foreground sm:mt-1 sm:mb-0.5">
                    {skill.description}
                  </p>
                ) : null}
                <Progress
                  className="mt-4 mb-4 h-2 bg-muted/60"
                  indicatorClassName={theme.indicator}
                  value={skill.level * 20}
                />
                {(skill.decks?.length ?? 0) > 0 ? (
                  <div className="mt-5 space-y-2.5 sm:mt-4 sm:space-y-2">
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
  return (
    <Link
      className="block w-full rounded-lg bg-muted/40 p-3 text-xs transition hover:bg-muted/55"
      href={`/review?deckId=${deck.id}&back=/`}
      onClick={(event) => {
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate font-medium">{deck.name}</p>
        <span className="text-muted-foreground">
          {deck.covered_count}/{deck.card_count}
        </span>
      </div>
    </Link>
  );
}
