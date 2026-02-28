import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getContext } from "@/lib/skill-tree-api";
import type {
  ContextResponse,
  DeckSummary,
  ScenarioSummary,
  SkillNode,
} from "@/lib/skill-tree-types";

export const dynamic = "force-dynamic";

const LEVEL_LABELS = [
  "Unaware",
  "Novice",
  "Beginner",
  "Intermediate",
  "Advanced",
  "Elite",
] as const;

export default async function Home() {
  let context: ContextResponse | null = null;
  let loadError: string | null = null;

  try {
    context = await getContext();
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Unknown error";
  }

  if (loadError) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center px-6 py-12">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>skill-tree web</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Could not reach the Go backend.
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
              {loadError}
            </pre>
            <p className="text-sm text-muted-foreground">
              Start the API server:
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
              GOWORK=off go run ./cmd/skill-tree-api -addr :8080
            </pre>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!context) {
    return null;
  }

  const totalSkills = countSkills(context.skills);
  const totalDecks = countDecks(context.skills);
  const totalCards = countCards(context.skills);
  const activeScenarios = context.active_scenarios.length;

  return (
    <main className="min-h-screen bg-muted/20">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <header className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Next.js + shadcn + Go API
              </p>
              <h1 className="text-3xl font-semibold tracking-tight">skill-tree</h1>
            </div>
            <Button asChild>
              <Link href="/review">Start Review</Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Initial web port backed by <code>/v1/context</code>. This keeps Go
            as the source of truth while Next.js provides UI/BFF.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-4">
          <StatCard label="Skills" value={totalSkills} />
          <StatCard label="Decks" value={totalDecks} />
          <StatCard label="Cards" value={totalCards} />
          <StatCard label="Active Scenarios" value={activeScenarios} />
        </section>

        <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Skill Tree</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {context.skills.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No skills found yet.
                </p>
              ) : (
                <SkillTree skills={context.skills} depth={0} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Active Scenarios</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {context.active_scenarios.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No planned or in-progress scenarios.
                </p>
              ) : (
                context.active_scenarios.map((scenario) => (
                  <ScenarioRow key={scenario.id} scenario={scenario} />
                ))
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function SkillTree({ skills, depth }: { skills: SkillNode[]; depth: number }) {
  return (
    <div className="space-y-2">
      {skills.map((skill) => (
        <div key={skill.id} className="space-y-2">
          <div
            className="rounded-lg border bg-background p-3"
            style={{ marginLeft: `${depth * 16}px` }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{skill.name}</p>
              <Badge variant="secondary">
                {skill.level}/5 {LEVEL_LABELS[skill.level]}
              </Badge>
            </div>
            {skill.description ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {skill.description}
              </p>
            ) : null}
            <Progress className="mt-3 h-2" value={skill.level * 20} />
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{skill.decks?.length ?? 0} decks</span>
              <span>{skill.scenarios?.length ?? 0} scenarios</span>
            </div>
            {(skill.decks?.length ?? 0) > 0 ? (
              <div className="mt-3 space-y-1">
                {(skill.decks ?? []).slice(0, 3).map((deck) => (
                  <DeckCoverage key={deck.id} deck={deck} />
                ))}
                {(skill.decks?.length ?? 0) > 3 ? (
                  <p className="text-xs text-muted-foreground">
                    +{(skill.decks?.length ?? 0) - 3} more decks
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {(skill.children?.length ?? 0) > 0 ? (
            <SkillTree skills={skill.children ?? []} depth={depth + 1} />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function DeckCoverage({ deck }: { deck: DeckSummary }) {
  const percent =
    deck.card_count > 0 ? Math.round((deck.covered_count / deck.card_count) * 100) : 0;

  return (
    <div className="rounded-md bg-muted/40 p-2 text-xs">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="truncate font-medium">{deck.name}</p>
        <span className="text-muted-foreground">
          {deck.covered_count}/{deck.card_count}
        </span>
      </div>
      <Progress className="h-1.5" value={percent} />
    </div>
  );
}

function ScenarioRow({ scenario }: { scenario: ScenarioSummary }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="mb-1 flex items-center gap-2">
        <p className="font-medium">{scenario.name}</p>
        <Badge variant={scenario.status === "in_progress" ? "default" : "secondary"}>
          {scenario.status}
        </Badge>
      </div>
      {scenario.description ? (
        <p className="text-xs text-muted-foreground">{scenario.description}</p>
      ) : null}
    </div>
  );
}

function countSkills(skills: SkillNode[]): number {
  let total = 0;
  for (const skill of skills) {
    total += 1;
    if (skill.children && skill.children.length > 0) {
      total += countSkills(skill.children);
    }
  }
  return total;
}

function countDecks(skills: SkillNode[]): number {
  let total = 0;
  for (const skill of skills) {
    total += skill.decks?.length ?? 0;
    if (skill.children && skill.children.length > 0) {
      total += countDecks(skill.children);
    }
  }
  return total;
}

function countCards(skills: SkillNode[]): number {
  let total = 0;
  for (const skill of skills) {
    for (const deck of skill.decks ?? []) {
      total += deck.card_count;
    }
    if (skill.children && skill.children.length > 0) {
      total += countCards(skill.children);
    }
  }
  return total;
}
