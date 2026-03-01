import { SkillTreeExplorer } from "@/components/skill-tree/skill-tree-explorer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getContext } from "@/lib/skill-tree-api";
import type { ContextResponse, SkillNode } from "@/lib/skill-tree-types";

export const dynamic = "force-dynamic";

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
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
        <header className="space-y-3">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Next.js + shadcn + Go API
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">skill-tree</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Browse your skill tree, see deck coverage at a glance, and jump into
            focused review sessions.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-4">
          <StatCard label="Skills" value={totalSkills} />
          <StatCard label="Decks" value={totalDecks} />
          <StatCard label="Cards" value={totalCards} />
          <StatCard label="Active Scenarios" value={activeScenarios} />
        </section>

        <section>
          <Card className="w-full">
            <CardHeader className="text-left">
              <div className="mx-auto w-full max-w-3xl">
                <CardTitle>Skill Tree</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="mx-auto w-full max-w-3xl">
                {context.skills.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No skills found yet.
                  </p>
                ) : (
                  <SkillTreeExplorer skills={context.skills} />
                )}
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="border-0 shadow-none">
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
