import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getSkill } from "@/lib/skill-tree-api";
import type { DeckSummary, ScenarioSummary, SkillNode } from "@/lib/skill-tree-types";

export const dynamic = "force-dynamic";

const LEVEL_LABELS = [
  "Unaware",
  "Novice",
  "Beginner",
  "Intermediate",
  "Advanced",
  "Elite",
] as const;

function parsePositiveInt(raw: string): number | null {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

interface Section {
  skill: SkillNode;
  decks: DeckSummary[];
  scenarios: ScenarioSummary[];
}

export default async function SkillDetailPage({
  params,
}: {
  params: Promise<{ skillId: string }>;
}) {
  const resolved = await params;
  const skillID = parsePositiveInt(resolved.skillId);
  if (!skillID) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-8 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle>Invalid Skill ID</CardTitle>
          </CardHeader>
        </Card>
      </main>
    );
  }

  let skill: SkillNode | null = null;
  let loadError: string | null = null;
  try {
    skill = await getSkill(skillID);
  } catch (error) {
    loadError =
      error instanceof Error ? error.message : "Unable to load skill detail from Go API";
  }

  if (loadError || !skill) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-8 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle>Skill Detail Unavailable</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {loadError || "Skill not found"}
            </p>
            <Button asChild className="mt-4" variant="secondary">
              <Link href="/">Back to Dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const ownSection: Section = {
    skill,
    decks: skill.decks ?? [],
    scenarios: skill.scenarios ?? [],
  };
  const childSections: Section[] = (skill.children ?? [])
    .map((child) => ({
      skill: child,
      decks: child.decks ?? [],
      scenarios: child.scenarios ?? [],
    }))
    .filter((section) => section.decks.length > 0 || section.scenarios.length > 0);

  const sections: Section[] =
    skill.children && skill.children.length > 0
      ? [
          ...(ownSection.decks.length > 0 || ownSection.scenarios.length > 0
            ? [ownSection]
            : []),
          ...childSections,
        ]
      : [ownSection];

  return (
    <main className="min-h-screen bg-muted/20">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <header className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Skill Detail
              </p>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                {skill.name}
              </h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary">
                <Link href="/">Back</Link>
              </Button>
              <Button asChild>
                <Link href={`/review?skillId=${skill.id}&back=/skills/${skill.id}`}>
                  Start Skill Review
                </Link>
              </Button>
            </div>
          </div>
          <div className="rounded-xl border bg-background p-5 sm:p-6">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {skill.level}/5 {LEVEL_LABELS[skill.level]}
              </Badge>
              <Badge variant="outline">{skill.children?.length ?? 0} child skills</Badge>
            </div>
            {skill.description ? (
              <p className="text-sm text-muted-foreground">{skill.description}</p>
            ) : null}
            <Progress className="mt-4 h-2" value={skill.level * 20} />
          </div>
        </header>

        {sections.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No Linked Decks or Scenarios</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                This skill and its immediate children do not have linked decks or scenarios yet.
              </p>
            </CardContent>
          </Card>
        ) : (
          sections.map((section) => (
            <Card key={section.skill.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <span>{section.skill.name}</span>
                  <Badge variant="secondary">
                    {section.skill.level}/5 {LEVEL_LABELS[section.skill.level]}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {section.decks.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Decks
                    </p>
                    {section.decks.map((deck) => {
                      const percent =
                        deck.card_count > 0
                          ? Math.round((deck.covered_count / deck.card_count) * 100)
                          : 0;
                      return (
                        <div
                          className="w-full rounded-lg bg-background p-4 shadow-sm sm:p-5"
                          key={deck.id}
                        >
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="font-medium">{deck.name}</p>
                              {deck.description ? (
                                <p className="text-sm text-muted-foreground">
                                  {deck.description}
                                </p>
                              ) : null}
                            </div>
                            <Badge variant="outline">
                              {deck.covered_count}/{deck.card_count}
                            </Badge>
                          </div>
                          <Progress
                            className="h-1.5 bg-muted/70"
                            indicatorClassName="bg-chart-2"
                            value={percent}
                          />
                          <div className="mt-3">
                            <Button asChild size="sm" variant="secondary">
                              <Link
                                href={`/review?deckId=${deck.id}&back=/skills/${skill.id}`}
                              >
                                Review Deck
                              </Link>
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {section.scenarios.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Scenarios
                    </p>
                    {section.scenarios.map((scenario) => (
                      <div className="rounded-lg bg-background p-4 shadow-sm sm:p-5" key={scenario.id}>
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <p className="font-medium">{scenario.name}</p>
                          <Badge variant="secondary">{scenario.status}</Badge>
                        </div>
                        {scenario.description ? (
                          <p className="text-sm text-muted-foreground">{scenario.description}</p>
                        ) : null}
                        {scenario.repo_path ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Repo: {scenario.repo_path}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </main>
  );
}
