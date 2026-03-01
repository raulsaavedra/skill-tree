import { SkillTreeExplorer } from "@/components/skill-tree/skill-tree-explorer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getContext } from "@/lib/skill-tree-api";
import type { ContextResponse } from "@/lib/skill-tree-types";

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
              GOWORK=off go run ./apps/api -addr :8080
            </pre>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!context) {
    return null;
  }

  return (
    <main className="min-h-screen bg-muted/20">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
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

        <section className="w-full">
          {context.skills.length === 0 ? (
            <p className="text-sm text-muted-foreground">No skills found yet.</p>
          ) : (
            <SkillTreeExplorer skills={context.skills} />
          )}
        </section>
      </div>
    </main>
  );
}
