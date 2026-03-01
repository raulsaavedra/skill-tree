#!/usr/bin/env bun

import { ConvexHttpClient } from "convex/browser";

type JsonObject = Record<string, unknown>;

function usage(): string {
  return `
Usage:
  skill-tree context
  skill-tree skill tree
  skill-tree skill show --id <skill-id>
  skill-tree skill cards --id <skill-id> [--limit <n>]
  skill-tree deck list
  skill-tree deck cards --deck-id <deck-id> [--limit <n>]
  skill-tree card covered --ids <id1,id2,...>
  skill-tree card cover --card-id <card-id>
`;
}

function readFlag(args: string[], flag: string): string | undefined {
  const target = `--${flag}`;
  const index = args.findIndex((value) => value === target);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${target}`);
  }
  return value;
}

function requirePositiveInt(
  args: string[],
  flag: string,
  label: string,
): number {
  const raw = readFlag(args, flag);
  if (!raw) {
    throw new Error(`--${flag} is required`);
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}`);
  }
  return parsed;
}

function optionalPositiveInt(
  args: string[],
  flag: string,
  fallback: number,
  label: string,
): number {
  const raw = readFlag(args, flag);
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}`);
  }
  return parsed;
}

function parseIDList(args: string[]): number[] {
  const raw = readFlag(args, "ids");
  if (!raw) {
    throw new Error("--ids is required");
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => {
      const value = Number(item);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid card id: ${item}`);
      }
      return value;
    });
}

function convexUrl(): string {
  const raw = process.env.CONVEX_URL?.trim();
  if (!raw) {
    throw new Error("Missing CONVEX_URL env var");
  }
  return raw;
}

function printJSON(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function query<T>(
  client: ConvexHttpClient,
  functionName: string,
  args: JsonObject,
): Promise<T> {
  return (await client.query(functionName as never, args as never)) as T;
}

async function mutate(
  client: ConvexHttpClient,
  functionName: string,
  args: JsonObject,
): Promise<void> {
  await client.mutation(functionName as never, args as never);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help") {
    console.log(usage().trim());
    return;
  }

  const client = new ConvexHttpClient(convexUrl());
  const [entity, command, ...rest] = argv;

  if (entity === "context") {
    const context = await query<unknown>(client, "context:get", {});
    printJSON(context);
    return;
  }

  if (entity === "skill") {
    if (command === "tree") {
      const tree = await query<unknown>(client, "skills:tree", {});
      printJSON(tree);
      return;
    }

    if (command === "show") {
      const skillID = requirePositiveInt(rest, "id", "skill id");
      const skill = await query<unknown>(client, "skills:get", {
        skill_id: skillID,
      });
      printJSON(skill);
      return;
    }

    if (command === "cards") {
      const skillID = requirePositiveInt(rest, "id", "skill id");
      const limit = optionalPositiveInt(rest, "limit", 200, "limit");
      const cards = await query<unknown>(client, "skills:cards", {
        skill_id: skillID,
        limit,
      });
      printJSON(cards);
      return;
    }
  }

  if (entity === "deck") {
    if (command === "list") {
      const decks = await query<unknown>(client, "decks:list", {});
      printJSON(decks);
      return;
    }

    if (command === "cards") {
      const deckID = requirePositiveInt(rest, "deck-id", "deck id");
      const limit = optionalPositiveInt(rest, "limit", 200, "limit");
      const cards = await query<unknown>(client, "decks:cards", {
        deck_id: deckID,
        limit,
      });
      printJSON(cards);
      return;
    }
  }

  if (entity === "card") {
    if (command === "covered") {
      const ids = parseIDList(rest);
      const covered = await query<unknown>(client, "coverage:coveredIds", {
        card_ids: ids,
      });
      printJSON({ covered_ids: covered });
      return;
    }

    if (command === "cover") {
      const cardID = requirePositiveInt(rest, "card-id", "card id");
      await mutate(client, "coverage:markCovered", { card_id: cardID });
      console.log(`Covered card ${cardID}`);
      return;
    }
  }

  throw new Error(`Unknown command: ${argv.join(" ")}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  console.error(usage().trim());
  process.exit(1);
});
