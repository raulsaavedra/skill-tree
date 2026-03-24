#!/usr/bin/env bun
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { json, success, errorf, resolveSkillsDir, install, dbPath } from "cli-core";
import {
  Store,
  validateLevel,
  validateStatus,
  clampLevel,
  type Card,
  type Skill,
  type Deck,
  type Scenario,
} from "./store.ts";
import { levelLabel, levelBar } from "./tui-helpers.ts";

const program = new Command();

program
  .name("skill-tree")
  .description("Unified learning CLI: skill tree + quiz decks + scenarios")
  .action(async () => {
    await runTree();
  });

// --- context ---

program
  .command("context")
  .description("Full context dump (skill tree + scenarios)")
  .option("--json", "JSON output (default, always enabled)")
  .action(() => {
    const st = Store.open();
    try {
      const ctx = st.fullContext();
      json(ctx);
    } finally {
      st.close();
    }
  });

// --- skill ---

const skillCmd = program.command("skill").description("Manage skills");

skillCmd
  .command("add")
  .description("Add skill")
  .requiredOption("--name <name>", "Skill name")
  .option("--description <desc>", "Skill description", "")
  .option("--parent-id <id>", "Parent skill ID", "0")
  .option("--level <n>", "Initial level (0-5)", "0")
  .action((opts) => {
    const level = Number(opts.level);
    validateLevel(level);
    const parentId = Number(opts.parentId);
    const st = Store.open();
    try {
      const pid = parentId > 0 ? parentId : null;
      const id = st.createSkill(opts.name, opts.description, pid, level);
      console.log(`Created skill ${id}: ${opts.name}`);
    } finally {
      st.close();
    }
  });

skillCmd
  .command("list")
  .description("List skills")
  .option("--tree", "Show as tree")
  .option("--parent-id <id>", "Filter by parent", "0")
  .option("--json", "JSON output")
  .action((opts) => {
    const st = Store.open();
    try {
      if (opts.tree || opts.json) {
        const skills = st.skillTree();
        if (opts.json) {
          json(skills);
          return;
        }
        printSkillTree(skills, 0);
        return;
      }
      const parentId = Number(opts.parentId);
      const pid = parentId > 0 ? parentId : null;
      const skills = st.listSkills(pid);
      for (const s of skills) {
        console.log(`${s.id}\t${s.name}\t${s.level}/5`);
      }
    } finally {
      st.close();
    }
  });

skillCmd
  .command("show")
  .description("Show skill")
  .requiredOption("--id <id>", "Skill ID")
  .option("--json", "JSON output")
  .action((opts) => {
    const id = Number(opts.id);
    const st = Store.open();
    try {
      const skill = st.getSkill(id);
      if (opts.json) {
        json(skill);
        return;
      }
      console.log(
        `ID: ${skill.id}\nName: ${skill.name}\nLevel: ${skill.level}/5 ${levelLabel(skill.level)}\nDescription: ${skill.description}`,
      );
      printSkillLinks(skill.decks, skill.scenarios, "");
      for (const child of skill.children) {
        console.log(
          `\n${child.name} (${child.level}/5 ${levelLabel(child.level)})`,
        );
        printSkillLinks(child.decks, child.scenarios, "  ");
      }
    } finally {
      st.close();
    }
  });

skillCmd
  .command("update")
  .description("Update skill")
  .requiredOption("--id <id>", "Skill ID")
  .option("--name <name>", "New name")
  .option("--description <desc>", "New description")
  .option("--level <n>", "New level (0-5)")
  .action((opts) => {
    const id = Number(opts.id);
    const update: any = {};
    if (opts.name !== undefined) update.name = opts.name;
    if (opts.description !== undefined) update.description = opts.description;
    if (opts.level !== undefined) {
      const level = Number(opts.level);
      validateLevel(level);
      update.level = level;
    }
    const st = Store.open();
    try {
      st.updateSkill(id, update);
      console.log(`Updated skill ${id}`);
    } finally {
      st.close();
    }
  });

skillCmd
  .command("delete")
  .description("Delete skill")
  .requiredOption("--id <id>", "Skill ID")
  .action((opts) => {
    const id = Number(opts.id);
    const st = Store.open();
    try {
      st.deleteSkill(id);
      console.log(`Deleted skill ${id}`);
    } finally {
      st.close();
    }
  });

skillCmd
  .command("install")
  .description("Install skill")
  .option("--dest <dir>", "Destination skills directory")
  .option("--force", "Overwrite destination")
  .option("--link", "Symlink instead of copy")
  .action(async (opts) => {
    const destDir = await resolveSkillsDir(opts.dest);
    const path = await install({
      srcDir: "skills/skill-tree",
      destDir,
      name: "skill-tree",
      overwrite: opts.force ?? false,
      link: opts.link ?? false,
    });
    success("Installed skill to %s", path);
  });

// --- scenario ---

const scenarioCmd = program.command("scenario").description("Manage scenarios");

scenarioCmd
  .command("add")
  .description("Add scenario")
  .requiredOption("--name <name>", "Scenario name")
  .option("--description <desc>", "Scenario description", "")
  .option("--repo <path>", "Repository path", "")
  .option("--skill-id <ids...>", "Linked skill IDs")
  .action((opts) => {
    const skillIds = (opts.skillId ?? []).map(Number);
    const st = Store.open();
    try {
      const id = st.createScenario(
        opts.name,
        opts.description,
        opts.repo,
        skillIds,
      );
      console.log(`Created scenario ${id}: ${opts.name}`);
    } finally {
      st.close();
    }
  });

scenarioCmd
  .command("list")
  .description("List scenarios")
  .option("--status <status>", "Filter by status")
  .option("--json", "JSON output")
  .action((opts) => {
    const st = Store.open();
    try {
      const scenarios = st.listScenarios(opts.status ?? "");
      if (opts.json) {
        json(scenarios);
        return;
      }
      for (const sc of scenarios) {
        console.log(`${sc.id}\t${sc.name}\t${sc.status}`);
      }
    } finally {
      st.close();
    }
  });

scenarioCmd
  .command("show")
  .description("Show scenario")
  .requiredOption("--id <id>", "Scenario ID")
  .option("--json", "JSON output")
  .action((opts) => {
    const id = Number(opts.id);
    const st = Store.open();
    try {
      const sc = st.getScenario(id);
      if (opts.json) {
        json(sc);
        return;
      }
      console.log(
        `ID: ${sc.id}\nName: ${sc.name}\nStatus: ${sc.status}\nDescription: ${sc.description}`,
      );
      if (sc.repo_path) console.log(`Repo: ${sc.repo_path}`);
      if (sc.skills.length > 0) {
        console.log("Skills:");
        for (const s of sc.skills) {
          console.log(`  ${s.id}: ${s.name}`);
        }
      }
    } finally {
      st.close();
    }
  });

scenarioCmd
  .command("update")
  .description("Update scenario")
  .requiredOption("--id <id>", "Scenario ID")
  .option("--name <name>", "New name")
  .option("--description <desc>", "New description")
  .option("--repo <path>", "New repo path")
  .option(
    "--status <status>",
    "New status (planned, in_progress, completed, abandoned)",
  )
  .action((opts) => {
    const id = Number(opts.id);
    const update: any = {};
    if (opts.name !== undefined) update.name = opts.name;
    if (opts.description !== undefined) update.description = opts.description;
    if (opts.repo !== undefined) update.repo_path = opts.repo;
    if (opts.status !== undefined) {
      validateStatus(opts.status);
      update.status = opts.status;
    }
    const st = Store.open();
    try {
      st.updateScenario(id, update);
      console.log(`Updated scenario ${id}`);
    } finally {
      st.close();
    }
  });

scenarioCmd
  .command("delete")
  .description("Delete scenario")
  .requiredOption("--id <id>", "Scenario ID")
  .action((opts) => {
    const id = Number(opts.id);
    const st = Store.open();
    try {
      st.deleteScenario(id);
      console.log(`Deleted scenario ${id}`);
    } finally {
      st.close();
    }
  });

scenarioCmd
  .command("link")
  .description("Link scenario to skill")
  .requiredOption("--scenario-id <id>", "Scenario ID")
  .requiredOption("--skill-id <id>", "Skill ID")
  .action((opts) => {
    const scenarioId = Number(opts.scenarioId);
    const skillId = Number(opts.skillId);
    const st = Store.open();
    try {
      st.linkScenarioSkill(scenarioId, skillId);
      console.log(`Linked scenario ${scenarioId} to skill ${skillId}`);
    } finally {
      st.close();
    }
  });

scenarioCmd
  .command("unlink")
  .description("Unlink scenario from skill")
  .requiredOption("--scenario-id <id>", "Scenario ID")
  .requiredOption("--skill-id <id>", "Skill ID")
  .action((opts) => {
    const scenarioId = Number(opts.scenarioId);
    const skillId = Number(opts.skillId);
    const st = Store.open();
    try {
      st.unlinkScenarioSkill(scenarioId, skillId);
      console.log(`Unlinked scenario ${scenarioId} from skill ${skillId}`);
    } finally {
      st.close();
    }
  });

// --- deck ---

const deckCmd = program.command("deck").description("Manage decks");

deckCmd
  .command("create")
  .description("Create deck")
  .option("--deck-name <name>", "Deck name")
  .option("--description <desc>", "Deck description", "")
  .option("--data <json>", "Deck JSON payload")
  .option("--file <path>", "Path to JSON payload")
  .option("--skill-id <ids...>", "Link to skill IDs")
  .action((opts) => {
    const skillIds = (opts.skillId ?? []).map(Number);
    const st = Store.open();
    try {
      if (!opts.data && !opts.file) {
        if (!opts.deckName) throw new Error("--deck-name is required");
        st.createDeckWithContents(
          opts.deckName,
          opts.description,
          skillIds,
          [],
        );
        console.log(`Created deck: ${opts.deckName}`);
        return;
      }
      if ((opts.data || opts.file) && (opts.deckName || opts.description)) {
        throw new Error(
          "--deck-name/--description cannot be used with --data/--file",
        );
      }
      const payload = readPayload(opts.data, opts.file);
      const deckInput = JSON.parse(payload) as {
        name: string;
        description?: string;
        cards?: RawCardInput[];
      };
      if (!deckInput.name) throw new Error("deck payload requires name");
      const cards = (deckInput.cards ?? []).map((raw, idx) => {
        try {
          return normalizeCard(raw);
        } catch (e: any) {
          throw new Error(`card ${idx + 1}: ${e.message}`);
        }
      });
      st.createDeckWithContents(
        deckInput.name,
        deckInput.description ?? "",
        skillIds,
        cards,
      );
      if (cards.length > 0) {
        console.log(
          `Created deck: ${deckInput.name} with ${cards.length} cards`,
        );
      } else {
        console.log(`Created deck: ${deckInput.name}`);
      }
    } finally {
      st.close();
    }
  });

deckCmd
  .command("list")
  .description("List decks")
  .option("--json", "JSON output")
  .action((opts) => {
    const st = Store.open();
    try {
      const decks = st.listDecks();
      if (opts.json) {
        json(decks);
        return;
      }
      for (const d of decks) {
        const cov = coverageText(d.covered_count, d.card_count);
        console.log(
          `${d.id}\t${d.name}\t${d.card_count}\t${cov}\t${formatUpdatedAt(d.updated_at)}\t${d.description}`,
        );
      }
    } finally {
      st.close();
    }
  });

deckCmd
  .command("delete")
  .description("Delete deck")
  .option("--deck-id <id>", "Deck id")
  .option("--deck-name <name>", "Deck name")
  .action((opts) => {
    const st = Store.open();
    try {
      let deckId = Number(opts.deckId || 0);
      if (deckId === 0 && !opts.deckName)
        throw new Error("either --deck-id or --deck-name is required");
      if (deckId === 0) {
        const deck = st.getDeckByName(opts.deckName);
        deckId = deck.id;
      }
      st.deleteDeckById(deckId);
      console.log(`Deleted deck id: ${deckId}`);
    } finally {
      st.close();
    }
  });

deckCmd
  .command("link")
  .description("Link deck to skill")
  .requiredOption("--deck-id <id>", "Deck ID")
  .requiredOption("--skill-id <id>", "Skill ID")
  .action((opts) => {
    const deckId = Number(opts.deckId);
    const skillId = Number(opts.skillId);
    const st = Store.open();
    try {
      st.linkDeckSkill(deckId, skillId);
      console.log(`Linked deck ${deckId} to skill ${skillId}`);
    } finally {
      st.close();
    }
  });

deckCmd
  .command("unlink")
  .description("Unlink deck from skill")
  .requiredOption("--deck-id <id>", "Deck ID")
  .requiredOption("--skill-id <id>", "Skill ID")
  .action((opts) => {
    const deckId = Number(opts.deckId);
    const skillId = Number(opts.skillId);
    const st = Store.open();
    try {
      st.unlinkDeckSkill(deckId, skillId);
      console.log(`Unlinked deck ${deckId} from skill ${skillId}`);
    } finally {
      st.close();
    }
  });

deckCmd
  .command("reset-coverage")
  .description("Reset coverage for a deck")
  .option("--deck-id <id>", "Deck ID")
  .option("--deck-name <name>", "Deck name")
  .action((opts) => {
    const st = Store.open();
    try {
      let deckId = Number(opts.deckId || 0);
      if (deckId === 0 && !opts.deckName)
        throw new Error("either --deck-id or --deck-name is required");
      if (deckId === 0) {
        const deck = st.getDeckByName(opts.deckName);
        deckId = deck.id;
      }
      st.resetDeckCoverage(deckId);
      console.log(`Reset coverage for deck ${deckId}`);
    } finally {
      st.close();
    }
  });

deckCmd
  .command("complete-coverage")
  .description("Mark all cards in a deck as covered")
  .option("--deck-id <id>", "Deck ID")
  .option("--deck-name <name>", "Deck name")
  .action((opts) => {
    const st = Store.open();
    try {
      let deckId = Number(opts.deckId || 0);
      if (deckId === 0 && !opts.deckName)
        throw new Error("either --deck-id or --deck-name is required");
      if (deckId === 0) {
        const deck = st.getDeckByName(opts.deckName);
        deckId = deck.id;
      }
      st.completeDeckCoverage(deckId);
      console.log(`Completed coverage for deck ${deckId}`);
    } finally {
      st.close();
    }
  });

// --- card ---

const cardCmd = program.command("card").description("Manage cards");

cardCmd
  .command("list")
  .description("List cards in a deck")
  .option("--deck-id <id>", "Deck id")
  .option("--deck-name <name>", "Deck name")
  .option("--limit <n>", "Limit", "50")
  .action((opts) => {
    const deckId = resolveDeckId(opts);
    const limit = Number(opts.limit);
    const st = Store.open();
    try {
      const cards = st.listCards(deckId, limit);
      for (const c of cards) {
        console.log(`${c.id}\t${c.question}`);
      }
    } finally {
      st.close();
    }
  });

cardCmd
  .command("add")
  .description("Add card")
  .option("--deck-id <id>", "Deck id")
  .option("--deck-name <name>", "Deck name")
  .option("--question <q>", "Question")
  .option("--answer <a>", "Answer")
  .option("--extra <e>", "Extra explanation")
  .option("--choice <choices...>", "Choice (repeatable)")
  .option("--correct-index <n>", "Correct choice index", "0")
  .option("--tag <tags...>", "Tag (repeatable)")
  .option("--data <json>", "JSON array of cards")
  .option("--file <path>", "Path to JSON array")
  .action((opts) => {
    const deckId = resolveDeckId(opts);
    const st = Store.open();
    try {
      if (opts.data || opts.file) {
        if (opts.question || opts.answer)
          throw new Error(
            "--data/--file cannot be used with --question or --answer",
          );
        const payload = readPayload(opts.data, opts.file);
        const raw = JSON.parse(payload) as RawCardInput[];
        const cards = raw.map((item, idx) => {
          try {
            return normalizeCard(item);
          } catch (e: any) {
            throw new Error(`card ${idx + 1}: ${e.message}`);
          }
        });
        st.insertCards(deckId, cards);
        console.log(`Added ${cards.length} cards to deck id ${deckId}`);
        return;
      }
      if (!opts.question || !opts.answer)
        throw new Error("--question and --answer are required");
      const choices: string[] = opts.choice ?? [];
      const tags: string[] = opts.tag ?? [];
      const correct = Number(opts.correctIndex);
      let correctPtr: number | null = null;
      if (choices.length > 0) {
        if (correct < 0 || correct >= choices.length)
          throw new Error(
            `--correct-index must be between 0 and ${choices.length - 1}`,
          );
        correctPtr = correct;
      }
      const id = st.insertCard(deckId, {
        id: 0,
        deck_id: deckId,
        question: opts.question,
        answer: opts.answer,
        extra: opts.extra ?? "",
        choices,
        correct_index: correctPtr,
        tags,
      });
      console.log(`Added card ${id} to deck id ${deckId}`);
    } finally {
      st.close();
    }
  });

cardCmd
  .command("show")
  .description("Show card")
  .option("--deck-id <id>", "Deck id")
  .option("--deck-name <name>", "Deck name")
  .requiredOption("--card-id <id>", "Card id")
  .action((opts) => {
    const deckId = resolveDeckId(opts);
    const cardId = Number(opts.cardId);
    const st = Store.open();
    try {
      const card = st.getCard(deckId, cardId);
      console.log(
        `ID: ${card.id}\nQuestion: ${card.question}\nAnswer: ${card.answer}\nExtra: ${card.extra}`,
      );
      if (card.choices.length > 0) {
        console.log("Choices:");
        for (let i = 0; i < card.choices.length; i++) {
          const marker =
            card.correct_index !== null && card.correct_index === i ? "*" : " ";
          console.log(`  ${marker} ${i + 1}) ${card.choices[i]}`);
        }
      }
      if (card.tags.length > 0) {
        console.log(`Tags: ${card.tags.join(", ")}`);
      }
    } finally {
      st.close();
    }
  });

cardCmd
  .command("delete")
  .description("Delete card(s)")
  .option("--deck-id <id>", "Deck id")
  .option("--deck-name <name>", "Deck name")
  .option("--card-id <id>", "Card id")
  .option("--card-ids <ids>", "Comma-separated card ids or ranges")
  .action((opts) => {
    const deckId = resolveDeckId(opts);
    const cardId = Number(opts.cardId || 0);
    const cardIdsRaw = (opts.cardIds ?? "").trim();
    if (cardId === 0 && !cardIdsRaw)
      throw new Error("either --card-id or --card-ids is required");
    if (cardId !== 0 && cardIdsRaw)
      throw new Error("specify only one of --card-id or --card-ids");
    const ids = cardId !== 0 ? [cardId] : parseCardIds(cardIdsRaw);
    const st = Store.open();
    try {
      for (const id of ids) {
        st.deleteCard(deckId, id);
        console.log(`Deleted card ${id} from deck id ${deckId}`);
      }
    } finally {
      st.close();
    }
  });

cardCmd
  .command("update")
  .description("Update card")
  .option("--deck-id <id>", "Deck id")
  .option("--deck-name <name>", "Deck name")
  .requiredOption("--card-id <id>", "Card id")
  .option("--question <q>", "Question")
  .option("--answer <a>", "Answer")
  .option("--extra <e>", "Extra")
  .option("--choice <choices...>", "Choices")
  .option("--correct-index <n>", "Correct index")
  .option("--tag <tags...>", "Tags")
  .action((opts) => {
    const deckId = resolveDeckId(opts);
    const cardId = Number(opts.cardId);
    const update: any = {};
    if (opts.question !== undefined) update.question = opts.question;
    if (opts.answer !== undefined) update.answer = opts.answer;
    if (opts.extra !== undefined) update.extra = opts.extra;
    if (opts.correctIndex !== undefined)
      update.correct_index = Number(opts.correctIndex);
    if (opts.choice !== undefined) update.choices = opts.choice;
    if (opts.tag !== undefined) update.tags = opts.tag;
    const st = Store.open();
    try {
      st.updateCard(deckId, cardId, update);
      console.log(`Updated card ${cardId}`);
    } finally {
      st.close();
    }
  });

// --- review ---

program
  .command("review [deck]")
  .description("Start review session")
  .option("-m, --mode <mode>", "Review mode (flashcard, mcq, auto)", "auto")
  .option("-l, --limit <n>", "Max cards", "200")
  .option("--deck <name>", "Deck name to review")
  .option("--skill <name>", "Review all cards for a skill")
  .action(async (positionalDeck, opts) => {
    if (opts.skill) {
      await runSkillReview(opts.skill, opts.mode, Number(opts.limit));
      return;
    }
    let deckQuery = (opts.deck ?? "").trim();
    if (positionalDeck) {
      if (deckQuery)
        throw new Error("specify either positional [deck] or --deck, not both");
      deckQuery = positionalDeck.trim();
    }
    await runReviewSession(deckQuery, opts.mode, Number(opts.limit));
  });

// --- tree ---

program
  .command("tree")
  .description("Interactive skill tree TUI")
  .action(async () => {
    await runTree();
  });

// --- import ---

program
  .command("import")
  .description("Import data from quiz CLI")
  .option("--from-quiz", "Import from quiz CLI database")
  .action((opts) => {
    if (!opts.fromQuiz) throw new Error("--from-quiz is required");
    const quizDBPath = dbPath("quiz", "quiz.db");
    const st = Store.open();
    try {
      const { decks, cards } = st.importFromQuiz(quizDBPath);
      console.log(
        `Imported ${decks} decks with ${cards} cards from ${quizDBPath}`,
      );
    } finally {
      st.close();
    }
  });

// --- TUI launchers ---

async function runTree(): Promise<void> {
  const { runTreeApp } = await import("./tui-app.tsx");
  const st = Store.open();
  try {
    const ctx = st.fullContext();
    const allDecks = st.listDecks();
    const cardsByDeck = new Map<number, Card[]>();
    for (const deck of allDecks) {
      cardsByDeck.set(deck.id, st.listCards(deck.id, 200));
    }
    await runTreeApp(ctx.skills, allDecks, cardsByDeck, st);
  } finally {
    st.close();
  }
}

async function runSkillReview(
  skillName: string,
  modeRaw: string,
  limit: number,
): Promise<void> {
  const { runReviewApp } = await import("./tui-app.tsx");
  const mode = parseModeWithFallback(modeRaw);
  const st = Store.open();
  try {
    const tree = st.skillTree();
    const skill = findSkillByName(tree, skillName);
    if (!skill) throw new Error(`skill "${skillName}" not found`);
    const cards = st.cardsForSkill(skill.id, limit);
    if (cards.length === 0) {
      console.log("No cards found for skill.");
      return;
    }
    const deck: Deck = {
      id: -1,
      name: skillName + " (all)",
      description: "",
      card_count: cards.length,
      covered_count: 0,
      updated_at: "",
    };
    await runReviewApp([deck], new Map([[-1, cards]]), 0, mode, true, st);
  } finally {
    st.close();
  }
}

async function runReviewSession(
  deckQuery: string,
  modeRaw: string,
  limit: number,
): Promise<void> {
  const { runReviewApp } = await import("./tui-app.tsx");
  const mode = parseModeWithFallback(modeRaw);
  const st = Store.open();
  try {
    const decks = st.listDecks();
    const cardsByDeck = new Map<number, Card[]>();
    for (const deck of decks) {
      cardsByDeck.set(deck.id, st.listCards(deck.id, limit));
    }
    let selectedIndex = 0;
    let startInReview = false;
    if (deckQuery) {
      for (let i = 0; i < decks.length; i++) {
        if (decks[i].name.toLowerCase() === deckQuery.toLowerCase()) {
          selectedIndex = i;
          startInReview = true;
          break;
        }
      }
    }
    await runReviewApp(
      decks,
      cardsByDeck,
      selectedIndex,
      mode,
      startInReview,
      st,
    );
  } finally {
    st.close();
  }
}

// --- helpers ---

function resolveDeckId(opts: any): number {
  const deckId = Number(opts.deckId || 0);
  if (deckId > 0) return deckId;
  const deckName = opts.deckName;
  if (!deckName) throw new Error("either --deck-id or --deck-name is required");
  const st = Store.open();
  try {
    const deck = st.getDeckByName(deckName);
    return deck.id;
  } finally {
    st.close();
  }
}

function readPayload(data?: string, file?: string): string {
  if (data && file) throw new Error("specify only one of --data or --file");
  if (data) return data;
  if (!file) throw new Error("missing input payload");
  return readFileSync(file, "utf-8");
}

interface RawCardInput {
  question: string;
  answer: string;
  extra?: string;
  choices?: string[];
  correct_index?: number;
  correctIndex?: number;
  tags?: string[];
}

function normalizeCard(input: RawCardInput): Card {
  if (!input.question?.trim()) throw new Error("question is required");
  if (!input.answer?.trim()) throw new Error("answer is required");
  let correct: number | null =
    input.correct_index ?? input.correctIndex ?? null;
  const choices = input.choices ?? [];
  if (choices.length === 0) correct = null;
  if (correct !== null) {
    if (correct < 0 || correct >= choices.length)
      throw new Error("correct index out of range");
  }
  if (correct === null && choices.length > 0) correct = 0;
  return {
    id: 0,
    deck_id: 0,
    question: input.question,
    answer: input.answer,
    extra: input.extra ?? "",
    choices,
    correct_index: correct,
    tags: input.tags ?? [],
  };
}

function parseCardIds(raw: string): number[] {
  const out: number[] = [];
  for (let part of raw.split(",")) {
    part = part.trim();
    if (!part) continue;
    if (part.includes("-")) {
      const [startStr, endStr] = part.split("-", 2);
      const start = parseInt(startStr.trim(), 10);
      const end = parseInt(endStr.trim(), 10);
      if (isNaN(start) || isNaN(end) || end < start)
        throw new Error(`invalid card id range "${part}"`);
      for (let i = start; i <= end; i++) out.push(i);
      continue;
    }
    const id = parseInt(part, 10);
    if (isNaN(id)) throw new Error(`invalid card id "${part}"`);
    out.push(id);
  }
  return out;
}

function parseModeWithFallback(raw: string): string {
  const mode = raw.trim().toLowerCase();
  if (["flashcard", "mcq", "auto", ""].includes(mode))
    return mode || "auto";
  return "auto";
}

function coverageText(covered: number, total: number): string {
  if (total === 0) return "--";
  return `${Math.floor((covered * 100) / total)}%`;
}

function formatUpdatedAt(raw: string): string {
  const value = raw.trim();
  if (!value) return value;
  const d = new Date(value);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
  if (value.length >= 16) {
    return value.replace("T", " ").slice(0, 16);
  }
  return value;
}

function printSkillLinks(
  decks: Deck[],
  scenarios: Scenario[],
  indent: string,
): void {
  if (decks.length > 0) {
    console.log(`${indent}Decks:`);
    for (const d of decks) {
      console.log(
        `${indent}  ${d.name} (${d.card_count} cards, ${coverageText(d.covered_count, d.card_count)})`,
      );
    }
  }
  if (scenarios.length > 0) {
    console.log(`${indent}Scenarios:`);
    for (const sc of scenarios) {
      console.log(`${indent}  ${sc.name} [${sc.status}]`);
    }
  }
  if (decks.length === 0 && scenarios.length === 0) {
    console.log(`${indent}No decks or scenarios linked.`);
  }
}

function printSkillTree(skills: Skill[], depth: number): void {
  for (const s of skills) {
    const indent = "  ".repeat(depth);
    console.log(
      `${indent}${s.name} ${levelBar(s.level)} ${s.level}/5 ${levelLabel(s.level)}`,
    );
    if (s.children.length > 0) printSkillTree(s.children, depth + 1);
  }
}

function findSkillByName(skills: Skill[], name: string): Skill | null {
  for (const s of skills) {
    if (s.name.toLowerCase() === name.toLowerCase()) return s;
    const found = findSkillByName(s.children, name);
    if (found) return found;
  }
  return null;
}

// --- Run ---

program.parseAsync(process.argv).catch((err) => {
  errorf("%s", err.message ?? err);
  process.exit(1);
});
