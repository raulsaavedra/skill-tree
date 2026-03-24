import { useState, useCallback } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import type { Store, Skill, Deck, Card } from "./store.ts";
import { clampLevel } from "./store.ts";
import {
  LEVEL_LABELS,
  LEVEL_DESCRIPTIONS,
  LEVEL_COLORS,
  STATUS_ICONS,
} from "./tui-helpers.ts";

// --- Shared helpers ---

function LevelBar({ level }: { level: number }) {
  const l = clampLevel(level);
  const color = LEVEL_COLORS[l];
  return (
    <Text>
      <Text color={color}>{"█".repeat(l)}</Text>
      <Text color="gray">{"░".repeat(5 - l)}</Text>
    </Text>
  );
}

function CoverageText({
  covered,
  total,
}: {
  covered: number;
  total: number;
}) {
  if (total === 0) return <Text dimColor>--</Text>;
  const pct = Math.floor((covered * 100) / total);
  let color: string = "gray";
  if (pct >= 100) color = "green";
  else if (pct >= 50) color = "cyan";
  else if (pct > 0) color = "yellow";
  return <Text color={color}>{pct}%</Text>;
}

function padRight(s: string, width: number): string {
  if (s.length >= width) return s;
  return s + " ".repeat(width - s.length);
}

function leafInfo(skill: Skill): string {
  const d = skill.decks.length;
  const s = skill.scenarios.length;
  if (d === 0 && s === 0) return "";
  const parts: string[] = [];
  if (d > 0) parts.push(`${d} ${d === 1 ? "deck" : "decks"}`);
  if (s > 0) parts.push(`${s} ${s === 1 ? "scenario" : "scenarios"}`);
  return `[${parts.join(" · ")}]`;
}

// --- Tree types ---

interface FlatNode {
  skill: Skill;
  depth: number;
}

interface DetailSection {
  name: string;
  level: number;
  deckStart: number;
  deckCount: number;
  scenarios: { name: string; status: string }[];
}

type AppStage = "tree" | "detail" | "levelHelp" | "review";

// --- Review Component ---

function ReviewView({
  decks,
  cardsByDeck,
  initialDeck,
  mode: initialMode,
  startInReview,
  store,
  onDone,
}: {
  decks: Deck[];
  cardsByDeck: Map<number, Card[]>;
  initialDeck: number;
  mode: string;
  startInReview: boolean;
  store: Store | null;
  onDone: () => void;
}) {
  const { exit } = useApp();
  type Stage = "deckSelect" | "review" | "done";

  const [deckCursor, setDeckCursor] = useState(
    Math.max(0, Math.min(initialDeck, decks.length - 1)),
  );
  const [cards, setCards] = useState<Card[]>(() => {
    if (startInReview && decks.length > 0) {
      const idx = Math.max(0, Math.min(initialDeck, decks.length - 1));
      return [...(cardsByDeck.get(decks[idx].id) ?? [])];
    }
    return [];
  });
  const [cardCursor, setCardCursor] = useState(0);
  const [choiceCursor, setChoiceCursor] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [mode, setMode] = useState(initialMode);
  const [stage, setStage] = useState<Stage>(() => {
    if (startInReview && decks.length > 0) {
      const idx = Math.max(0, Math.min(initialDeck, decks.length - 1));
      const c = cardsByDeck.get(decks[idx].id) ?? [];
      return c.length === 0 ? "done" : "review";
    }
    return "deckSelect";
  });
  const [coveredIds, setCoveredIds] = useState<Set<number>>(() => {
    if (startInReview && decks.length > 0 && store) {
      const idx = Math.max(0, Math.min(initialDeck, decks.length - 1));
      const c = cardsByDeck.get(decks[idx].id) ?? [];
      return store.coveredCardIds(c.map((x) => x.id));
    }
    return new Set();
  });
  const [fromTree] = useState(startInReview);

  const activateDeck = useCallback(
    (index: number) => {
      const deck = decks[index];
      const c = [...(cardsByDeck.get(deck.id) ?? [])];
      setCards(c);
      setCardCursor(0);
      setChoiceCursor(0);
      setShowAnswer(false);
      if (store && c.length > 0) {
        setCoveredIds(store.coveredCardIds(c.map((x) => x.id)));
      } else {
        setCoveredIds(new Set());
      }
      setStage(c.length === 0 ? "done" : "review");
    },
    [decks, cardsByDeck, store],
  );

  const currentCard = cards[cardCursor] ?? null;
  const hasChoices =
    currentCard &&
    currentCard.choices.length > 0 &&
    currentCard.correct_index !== null;
  const effectiveMode =
    mode === "flashcard"
      ? "flashcard"
      : mode === "mcq" && hasChoices
        ? "mcq"
        : hasChoices
          ? "mcq"
          : "flashcard";

  const refreshDeckCoverage = useCallback(() => {
    // Coverage is tracked in-memory for display; no-op for now
  }, []);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }

    if (stage === "deckSelect") {
      if (input === "q" || key.escape || input === "b") {
        onDone();
        return;
      }
      if (key.upArrow || input === "k") {
        setDeckCursor((c) => Math.max(0, c - 1));
      } else if (key.downArrow || input === "j") {
        setDeckCursor((c) => Math.min(decks.length - 1, c + 1));
      } else if (key.return || input === " ") {
        activateDeck(deckCursor);
      }
      return;
    }

    if (stage === "done") {
      if (input === "q" || key.escape) {
        onDone();
        return;
      }
      if (input === "b" || key.return || input === " ") {
        if (fromTree) {
          onDone();
        } else if (decks.length > 0) {
          refreshDeckCoverage();
          setStage("deckSelect");
        } else {
          onDone();
        }
        return;
      }
      return;
    }

    // Review stage
    if (input === "q" || key.escape) {
      onDone();
      return;
    }
    if (input === "b") {
      if (fromTree) {
        onDone();
      } else if (decks.length > 0) {
        refreshDeckCoverage();
        setStage("deckSelect");
      }
      return;
    }
    if (key.leftArrow || input === "h" || input === "p") {
      if (cardCursor > 0) {
        setCardCursor((c) => c - 1);
        setShowAnswer(false);
        setChoiceCursor(0);
      }
    } else if (key.rightArrow || input === "l" || input === "n") {
      if (cardCursor < cards.length - 1) {
        setCardCursor((c) => c + 1);
        setShowAnswer(false);
        setChoiceCursor(0);
      }
    } else if (input === "N") {
      const next = Math.min(cards.length - 1, cardCursor + 10);
      if (next !== cardCursor) {
        setCardCursor(next);
        setShowAnswer(false);
        setChoiceCursor(0);
      }
    } else if (input === "P") {
      const next = Math.max(0, cardCursor - 10);
      if (next !== cardCursor) {
        setCardCursor(next);
        setShowAnswer(false);
        setChoiceCursor(0);
      }
    } else if (key.upArrow || input === "k") {
      if (effectiveMode === "mcq" && currentCard && currentCard.choices.length > 0) {
        setChoiceCursor(
          (c) =>
            (c - 1 + currentCard.choices.length) % currentCard.choices.length,
        );
      }
    } else if (key.downArrow || input === "j") {
      if (effectiveMode === "mcq" && currentCard && currentCard.choices.length > 0) {
        setChoiceCursor((c) => (c + 1) % currentCard.choices.length);
      }
    } else if (input === "f") {
      setMode("flashcard");
    } else if (input === "m") {
      setMode("mcq");
    } else if (input === "a") {
      setMode("auto");
    } else if (key.return || input === " ") {
      if (showAnswer) {
        if (currentCard && store) {
          store.markCardCovered(currentCard.id);
          setCoveredIds((s) => new Set([...s, currentCard.id]));
        }
        if (cardCursor >= cards.length - 1) {
          setStage("done");
          return;
        }
        setCardCursor((c) => c + 1);
        setShowAnswer(false);
        setChoiceCursor(0);
      } else {
        setShowAnswer(true);
        if (
          effectiveMode === "mcq" &&
          currentCard &&
          currentCard.correct_index !== null &&
          choiceCursor === currentCard.correct_index
        ) {
          if (store) {
            store.markCardCovered(currentCard.id);
            setCoveredIds((s) => new Set([...s, currentCard.id]));
          }
        }
      }
    }
  });

  if (stage === "deckSelect") {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text bold color="cyan">
          Select a deck
        </Text>
        <Text dimColor>j/k Navigate enter Select b Back q Quit</Text>
        <Text> </Text>
        {decks.length === 0 ? (
          <>
            <Text>No decks found.</Text>
            <Text>Ask an agent to create a deck for you.</Text>
          </>
        ) : (
          decks.map((d, i) => (
            <Text key={d.id}>
              <Text
                color={i === deckCursor ? "magenta" : undefined}
                bold={i === deckCursor}
              >
                {i === deckCursor ? "> " : "  "}
                {d.name} ({d.card_count})
              </Text>{" "}
              <CoverageText covered={d.covered_count} total={d.card_count} />
            </Text>
          ))
        )}
      </Box>
    );
  }

  if (stage === "done") {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text bold color="green">
          review
        </Text>
        <Text> </Text>
        <Text>
          {cards.length === 0
            ? "No cards found for selected deck."
            : "Finished review."}
        </Text>
        <Text> </Text>
        <Text dimColor>
          {fromTree
            ? "enter/b: back | q: quit"
            : decks.length > 0
              ? "enter/b: back to decks | q: quit"
              : "q: quit"}
        </Text>
      </Box>
    );
  }

  // Review
  const modeLabel =
    mode === "flashcard" ? "Flashcard" : mode === "mcq" ? "MCQ" : "Auto";
  const deckName =
    deckCursor >= 0 && deckCursor < decks.length
      ? decks[deckCursor].name
      : "Review";
  const isCovered = currentCard && coveredIds.has(currentCard.id);

  // Pagination dots
  const maxDots = 40;
  const total = cards.length;
  let dotStart = 0;
  let dotEnd = total;
  let leftEllipsis = false;
  let rightEllipsis = false;
  if (total > maxDots) {
    const half = Math.floor(maxDots / 2);
    dotStart = cardCursor - half;
    dotEnd = dotStart + maxDots;
    if (dotStart < 0) {
      dotStart = 0;
      dotEnd = maxDots;
    }
    if (dotEnd > total) {
      dotEnd = total;
      dotStart = total - maxDots;
      if (dotStart < 0) dotStart = 0;
    }
    if (dotStart > 0) leftEllipsis = true;
    if (dotEnd < total) rightEllipsis = true;
  }

  const answerText = (): string => {
    if (!currentCard) return "";
    if (
      currentCard.correct_index !== null &&
      currentCard.correct_index >= 0 &&
      currentCard.correct_index < currentCard.choices.length
    ) {
      return currentCard.choices[currentCard.correct_index];
    }
    return currentCard.answer;
  };

  return (
    <Box flexDirection="column" paddingX={2}>
      <Text bold color="cyan">
        review
      </Text>
      {/* Pagination */}
      <Text>
        {leftEllipsis && <Text color="gray">…</Text>}
        {cards.slice(dotStart, dotEnd).map((c, i) => {
          const idx = dotStart + i;
          const cov = coveredIds.has(c.id);
          const isCur = idx === cardCursor;
          const color = isCur
            ? cov
              ? "green"
              : "white"
            : cov
              ? "greenBright"
              : "gray";
          return (
            <Text key={idx} color={color} bold={isCur}>
              •
            </Text>
          );
        })}
        {rightEllipsis && <Text color="gray">…</Text>}
      </Text>
      {/* Progress */}
      <Text>
        <Text color={isCovered ? "green" : undefined}>
          [{cardCursor + 1}/{cards.length}]
        </Text>{" "}
        [{modeLabel}] {deckName}
      </Text>
      <Text> </Text>
      {/* Question */}
      <Text bold>{currentCard?.question}</Text>

      {/* MCQ choices */}
      {effectiveMode === "mcq" && currentCard && currentCard.choices.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {currentCard.choices.map((choice, i) => {
            const selected = i === choiceCursor;
            let color: string | undefined = undefined;
            let bold = false;
            if (
              showAnswer &&
              currentCard.correct_index !== null &&
              currentCard.correct_index === i
            ) {
              color = "green";
              bold = true;
            } else if (showAnswer && selected) {
              color = "red";
              bold = true;
            } else if (selected) {
              color = "magenta";
              bold = true;
            }
            return (
              <Text key={i} color={color} bold={bold}>
                {selected ? "> " : "  "}
                {choice}
              </Text>
            );
          })}
        </Box>
      )}

      {/* Answer */}
      {showAnswer && currentCard && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="green">
            Answer
          </Text>
          <Text color="green">{answerText()}</Text>
          {currentCard.extra.trim() !== "" && (
            <>
              <Text> </Text>
              <Text>{currentCard.extra}</Text>
            </>
          )}
        </Box>
      )}

      <Text> </Text>
      <Text dimColor>
        {effectiveMode === "mcq"
          ? "enter/space: reveal→next | j/k: choice | n/p: next/prev | N/P: jump 10 | f/m/a: mode | q: quit"
          : "enter/space: reveal→next | n/p: next/prev | N/P: jump 10 | f/m/a: mode | q: quit"}
        {decks.length > 1 ? " | b: decks" : ""}
      </Text>
    </Box>
  );
}

// --- Tree Component ---

function TreeApp({
  initialSkills,
  allDecks,
  cardsByDeck,
  store,
}: {
  initialSkills: Skill[];
  allDecks: Deck[];
  cardsByDeck: Map<number, Card[]>;
  store: Store;
}) {
  const { exit } = useApp();
  const [skills] = useState(initialSkills);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [stage, setStage] = useState<AppStage>("tree");
  const [prevStage, setPrevStage] = useState<AppStage>("tree");
  const [selected, setSelected] = useState<Skill | null>(null);
  const [detailCursor, setDetailCursor] = useState(0);
  const [detailDecks, setDetailDecks] = useState<Deck[]>([]);
  const [detailSections, setDetailSections] = useState<DetailSection[]>([]);
  const [detailScenarios, setDetailScenarios] = useState<
    { name: string; status: string }[]
  >([]);

  // Search state
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchConfirmed, setSearchConfirmed] = useState(false);
  const [matchSet, setMatchSet] = useState<Set<number>>(new Set());
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [searchIdx, setSearchIdx] = useState(0);
  const [savedExpanded, setSavedExpanded] = useState<Set<number>>(new Set());

  // Build flat nodes
  const buildFlatNodes = useCallback(
    (exp: Set<number>) => {
      const nodes: FlatNode[] = [];
      const walk = (skillList: Skill[], depth: number) => {
        for (const skill of skillList) {
          nodes.push({ skill, depth });
          if (exp.has(skill.id)) {
            walk(skill.children, depth + 1);
          }
        }
      };
      walk(skills, 0);
      return nodes;
    },
    [skills],
  );

  const flatNodes = buildFlatNodes(expanded);

  // Review state
  const [reviewDecks, setReviewDecks] = useState<Deck[]>([]);
  const [reviewCards, setReviewCards] = useState<Map<number, Card[]>>(
    new Map(),
  );
  const [reviewDeckIdx, setReviewDeckIdx] = useState(0);
  const [reviewMode, setReviewMode] = useState("auto");
  const [reviewStartInReview, setReviewStartInReview] = useState(false);

  const loadDetailData = useCallback((skill: Skill) => {
    const dDecks: Deck[] = [];
    const sections: DetailSection[] = [];
    const dScenarios: { name: string; status: string }[] = [];

    if (skill.decks.length > 0 || skill.scenarios.length > 0) {
      sections.push({
        name: skill.name,
        level: skill.level,
        deckStart: dDecks.length,
        deckCount: skill.decks.length,
        scenarios: skill.scenarios.map((s) => ({
          name: s.name,
          status: s.status,
        })),
      });
      dDecks.push(...skill.decks);
      dScenarios.push(
        ...skill.scenarios.map((s) => ({ name: s.name, status: s.status })),
      );
    }

    for (const child of skill.children) {
      if (child.decks.length === 0 && child.scenarios.length === 0) continue;
      sections.push({
        name: child.name,
        level: child.level,
        deckStart: dDecks.length,
        deckCount: child.decks.length,
        scenarios: child.scenarios.map((s) => ({
          name: s.name,
          status: s.status,
        })),
      });
      dDecks.push(...child.decks);
      dScenarios.push(
        ...child.scenarios.map((s) => ({ name: s.name, status: s.status })),
      );
    }

    setDetailDecks(dDecks);
    setDetailSections(sections);
    setDetailScenarios(dScenarios);
    setDetailCursor(0);
  }, []);

  const collectSkillCards = useCallback(
    (skill: Skill): Card[] => {
      const cards: Card[] = [];
      for (const d of skill.decks) {
        cards.push(...(cardsByDeck.get(d.id) ?? []));
      }
      for (const child of skill.children) {
        for (const d of child.decks) {
          cards.push(...(cardsByDeck.get(d.id) ?? []));
        }
      }
      // Shuffle
      for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
      }
      return cards;
    },
    [cardsByDeck],
  );

  const applySearch = useCallback(
    (query: string, savedExp: Set<number>) => {
      const newExp = new Set(savedExp);
      const newMatchSet = new Set<number>();

      if (!query) {
        setExpanded(newExp);
        setMatchSet(new Set());
        setSearchMatches([]);
        return;
      }

      const q = query.toLowerCase();
      const walkForSearch = (skillList: Skill[], ancestors: number[]) => {
        for (const skill of skillList) {
          const path = [...ancestors, skill.id];
          if (skill.name.toLowerCase().includes(q)) {
            newMatchSet.add(skill.id);
            for (const aid of ancestors) newExp.add(aid);
          }
          if (skill.children.length > 0) {
            walkForSearch(skill.children, path);
          }
        }
      };
      walkForSearch(skills, []);

      setExpanded(newExp);
      setMatchSet(newMatchSet);

      // Rebuild flat nodes to find matches
      const nodes: FlatNode[] = [];
      const walk = (skillList: Skill[], depth: number) => {
        for (const skill of skillList) {
          nodes.push({ skill, depth });
          if (newExp.has(skill.id)) walk(skill.children, depth + 1);
        }
      };
      walk(skills, 0);

      const matches: number[] = [];
      for (let i = 0; i < nodes.length; i++) {
        if (newMatchSet.has(nodes[i].skill.id)) matches.push(i);
      }
      setSearchMatches(matches);
      setSearchIdx(0);
      if (matches.length > 0) setCursor(matches[0]);
    },
    [skills],
  );

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }

    if (stage === "review") return; // Review handles its own input

    if (stage === "levelHelp") {
      if (input === "q") {
        exit();
        return;
      }
      if (input === "b" || key.escape || input === "?") {
        setStage(prevStage);
      }
      return;
    }

    if (stage === "detail") {
      if (input === "q") {
        exit();
        return;
      }
      if (input === "b" || key.escape) {
        setStage("tree");
        setSelected(null);
        return;
      }
      if (key.upArrow || input === "k") {
        setDetailCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow || input === "j") {
        setDetailCursor((c) => Math.min(detailDecks.length - 1, c + 1));
        return;
      }
      if (input === "?") {
        setPrevStage("detail");
        setStage("levelHelp");
        return;
      }
      if (input === "t" && selected) {
        const cards = collectSkillCards(selected);
        if (cards.length > 0) {
          const deck: Deck = {
            id: -1,
            name: selected.name + " (test)",
            description: "",
            card_count: cards.length,
            covered_count: 0,
            updated_at: "",
          };
          setReviewDecks([deck]);
          setReviewCards(new Map([[-1, cards]]));
          setReviewDeckIdx(0);
          setReviewMode("auto");
          setReviewStartInReview(true);
          setPrevStage("detail");
          setStage("review");
        }
        return;
      }
      if ((key.return || input === " ") && detailDecks.length > 0) {
        const rCards = new Map<number, Card[]>();
        for (const d of detailDecks) {
          rCards.set(d.id, cardsByDeck.get(d.id) ?? []);
        }
        setReviewDecks(detailDecks);
        setReviewCards(rCards);
        setReviewDeckIdx(detailCursor);
        setReviewMode("auto");
        setReviewStartInReview(true);
        setPrevStage("detail");
        setStage("review");
      }
      return;
    }

    // Tree stage
    if (searching) {
      if (key.escape) {
        setExpanded(savedExpanded);
        setSearching(false);
        setSearchConfirmed(false);
        setSearchQuery("");
        setMatchSet(new Set());
        setSearchMatches([]);
        const nodes = buildFlatNodes(savedExpanded);
        if (cursor >= nodes.length) setCursor(Math.max(0, nodes.length - 1));
        return;
      }
      if (key.return) {
        if (searchMatches.length > 0) {
          setSearching(false);
          setSearchConfirmed(true);
          setSavedExpanded(new Set());
        } else {
          setExpanded(savedExpanded);
          setSearching(false);
          setSearchQuery("");
          setMatchSet(new Set());
          setSearchMatches([]);
          const nodes = buildFlatNodes(savedExpanded);
          if (cursor >= nodes.length)
            setCursor(Math.max(0, nodes.length - 1));
        }
        return;
      }
      if (key.backspace || key.delete) {
        const newQuery = searchQuery.slice(0, -1);
        setSearchQuery(newQuery);
        applySearch(newQuery, savedExpanded);
        return;
      }
      if (input.length === 1 && !key.ctrl && !key.meta) {
        const newQuery = searchQuery + input;
        setSearchQuery(newQuery);
        applySearch(newQuery, savedExpanded);
        return;
      }
      return;
    }

    if (input === "q") {
      exit();
      return;
    }
    if (input === "/") {
      setSearching(true);
      setSearchQuery("");
      setSearchConfirmed(false);
      setSavedExpanded(new Set(expanded));
      setMatchSet(new Set());
      setSearchMatches([]);
      return;
    }
    if (key.escape) {
      if (searchConfirmed) {
        setSearchConfirmed(false);
        setMatchSet(new Set());
        setSearchMatches([]);
        setSearchIdx(0);
      }
      return;
    }
    if (input === "n" && searchConfirmed && searchMatches.length > 0) {
      const next = (searchIdx + 1) % searchMatches.length;
      setSearchIdx(next);
      setCursor(searchMatches[next]);
      return;
    }
    if (input === "N" && searchConfirmed && searchMatches.length > 0) {
      const prev =
        (searchIdx - 1 + searchMatches.length) % searchMatches.length;
      setSearchIdx(prev);
      setCursor(searchMatches[prev]);
      return;
    }
    if (key.upArrow || input === "k") {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setCursor((c) => Math.min(flatNodes.length - 1, c + 1));
      return;
    }
    if (input === "?") {
      setPrevStage("tree");
      setStage("levelHelp");
      return;
    }
    if (input === "d") {
      if (cursor >= 0 && cursor < flatNodes.length) {
        const skill = flatNodes[cursor].skill;
        setSelected(skill);
        setStage("detail");
        loadDetailData(skill);
      }
      return;
    }
    if (input === "t") {
      if (cursor >= 0 && cursor < flatNodes.length) {
        const skill = flatNodes[cursor].skill;
        const cards = collectSkillCards(skill);
        if (cards.length > 0) {
          const deck: Deck = {
            id: -1,
            name: skill.name + " (test)",
            description: "",
            card_count: cards.length,
            covered_count: 0,
            updated_at: "",
          };
          setReviewDecks([deck]);
          setReviewCards(new Map([[-1, cards]]));
          setReviewDeckIdx(0);
          setReviewMode("auto");
          setReviewStartInReview(true);
          setPrevStage("tree");
          setStage("review");
        }
      }
      return;
    }
    if (key.return || input === " ") {
      if (cursor >= 0 && cursor < flatNodes.length) {
        const node = flatNodes[cursor];
        if (node.skill.children.length > 0) {
          setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(node.skill.id)) next.delete(node.skill.id);
            else next.add(node.skill.id);
            return next;
          });
        } else {
          setSelected(node.skill);
          setStage("detail");
          loadDetailData(node.skill);
        }
      }
    }
  });

  if (stage === "review") {
    return (
      <ReviewView
        decks={reviewDecks}
        cardsByDeck={reviewCards}
        initialDeck={reviewDeckIdx}
        mode={reviewMode}
        startInReview={reviewStartInReview}
        store={store}
        onDone={() => setStage(prevStage === "review" ? "tree" : prevStage)}
      />
    );
  }

  if (stage === "levelHelp") {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text bold color="cyan">
          Skill Levels
        </Text>
        <Text> </Text>
        {LEVEL_LABELS.map((label, i) => (
          <Text key={i}>
            {"  "}
            {i} <LevelBar level={i} />{" "}
            <Text color={LEVEL_COLORS[i]} bold>
              {label.padEnd(12)}
            </Text>{" "}
            <Text dimColor>{LEVEL_DESCRIPTIONS[i]}</Text>
          </Text>
        ))}
        <Text> </Text>
        <Text dimColor>b Back q Quit</Text>
      </Box>
    );
  }

  if (stage === "detail") {
    const skill = selected;
    if (!skill)
      return (
        <Box paddingX={2}>
          <Text>No skill selected.</Text>
        </Box>
      );
    const level = clampLevel(skill.level);
    const hasChildren = skill.children.length > 0;

    return (
      <Box flexDirection="column" paddingX={2}>
        {/* Header */}
        <Text>
          <Text bold color="cyan">
            {skill.name}
          </Text>
          {"    "}
          <LevelBar level={level} />{" "}
          <Text color={LEVEL_COLORS[level]}>
            {level}/5 {LEVEL_LABELS[level]}
          </Text>
        </Text>
        {skill.description && <Text dimColor>{skill.description}</Text>}

        {detailDecks.length === 0 && detailScenarios.length === 0 ? (
          <>
            <Text> </Text>
            <Text>{"  "}No decks or scenarios linked.</Text>
          </>
        ) : !hasChildren ? (
          <>
            <Text> </Text>
            {detailDecks.length > 0 && (
              <>
                <Text bold>Decks</Text>
                {detailDecks.map((d, i) => (
                  <Text key={d.id}>
                    <Text
                      color={i === detailCursor ? "magenta" : undefined}
                      bold={i === detailCursor}
                    >
                      {i === detailCursor ? "  > " : "    "}
                      {d.name}
                    </Text>
                    {"  "}
                    <Text dimColor>{d.card_count} cards</Text>{" "}
                    <CoverageText
                      covered={d.covered_count}
                      total={d.card_count}
                    />
                  </Text>
                ))}
              </>
            )}
            {detailScenarios.length > 0 && (
              <>
                <Text> </Text>
                <Text bold>Scenarios</Text>
                {detailScenarios.map((s, i) => (
                  <Text key={i}>
                    {"  "}
                    {STATUS_ICONS[s.status] ?? "○"} {s.name}
                  </Text>
                ))}
              </>
            )}
          </>
        ) : (
          detailSections.map((sec, si) => {
            const secLevel = clampLevel(sec.level);
            return (
              <Box key={si} flexDirection="column" marginTop={1}>
                <Text>
                  <Text bold color="cyan">
                    {sec.name}
                  </Text>
                  {"  "}
                  <LevelBar level={secLevel} />{" "}
                  <Text color={LEVEL_COLORS[secLevel]}>
                    {secLevel}/5 {LEVEL_LABELS[secLevel]}
                  </Text>
                </Text>
                {sec.deckCount > 0 && (
                  <>
                    <Text dimColor>{"  "}Decks:</Text>
                    {detailDecks
                      .slice(sec.deckStart, sec.deckStart + sec.deckCount)
                      .map((d, di) => {
                        const idx = sec.deckStart + di;
                        return (
                          <Text key={d.id}>
                            <Text
                              color={idx === detailCursor ? "magenta" : undefined}
                              bold={idx === detailCursor}
                            >
                              {idx === detailCursor ? "    > " : "      "}
                              {d.name}
                            </Text>
                            {"  "}
                            <Text dimColor>{d.card_count} cards</Text>{" "}
                            <CoverageText
                              covered={d.covered_count}
                              total={d.card_count}
                            />
                          </Text>
                        );
                      })}
                  </>
                )}
                {sec.scenarios.length > 0 && (
                  <>
                    <Text dimColor>{"  "}Scenarios:</Text>
                    {sec.scenarios.map((s, i) => (
                      <Text key={i}>
                        {"    "}
                        {STATUS_ICONS[s.status] ?? "○"} {s.name}
                      </Text>
                    ))}
                  </>
                )}
              </Box>
            );
          })
        )}

        <Text> </Text>
        <Text dimColor>
          j/k Navigate enter Review t Test ? Levels b Back q Quit
        </Text>
      </Box>
    );
  }

  // Tree view
  return (
    <Box flexDirection="column" paddingX={2}>
      <Text bold color="cyan">
        Skill Tree
      </Text>
      <Text> </Text>
      {flatNodes.length === 0 ? (
        <>
          <Text>No skills found.</Text>
          <Text>Use the CLI to add skills to your tree.</Text>
          <Text> </Text>
          <Text dimColor>q Quit</Text>
        </>
      ) : (
        <>
          {flatNodes.map((node, i) => {
            const indent = "  ".repeat(node.depth);
            let prefix = "─ ";
            if (node.skill.children.length > 0) {
              prefix = expanded.has(node.skill.id) ? "▼ " : "▶ ";
            }
            const cursorStr = i === cursor ? "> " : "  ";
            const level = clampLevel(node.skill.level);
            const isMatch = matchSet.has(node.skill.id);
            const info = leafInfo(node.skill);

            let nameColor: string | undefined = undefined;
            let nameBold = false;
            let nameUnderline = false;
            if (i === cursor) {
              nameColor = "magenta";
              nameBold = true;
              if (isMatch) nameUnderline = true;
            } else if (isMatch) {
              nameColor = "yellow";
              nameBold = true;
            }

            const nameStr = `${cursorStr}${indent}${prefix}${node.skill.name}`;
            const padded = padRight(nameStr, 40);

            return (
              <Text key={`${node.skill.id}-${i}`}>
                <Text
                  color={nameColor}
                  bold={nameBold}
                  underline={nameUnderline}
                >
                  {padded}
                </Text>
                {"  "}
                <LevelBar level={level} />{" "}
                <Text color={LEVEL_COLORS[level]}>
                  {level}/5 {LEVEL_LABELS[level]}
                </Text>
                {info && (
                  <>
                    {"   "}
                    <Text dimColor>{info}</Text>
                  </>
                )}
              </Text>
            );
          })}
          <Text> </Text>
          {searching ? (
            <Text>
              <Text bold>/</Text>
              {searchQuery}
              <Text dimColor>_</Text>
              {searchQuery &&
                (searchMatches.length === 0 ? (
                  <Text color="red">{"  "}no matches</Text>
                ) : (
                  <Text dimColor>
                    {"  "}
                    {searchIdx + 1}/{searchMatches.length}
                  </Text>
                ))}
            </Text>
          ) : searchConfirmed ? (
            <Text dimColor>
              j/k Navigate n/N Next/Prev match / Search enter Expand d Detail t
              Test esc Clear q Quit
            </Text>
          ) : (
            <Text dimColor>
              j/k Navigate enter Expand/Collapse d Detail t Test / Search ?
              Levels q Quit
            </Text>
          )}
        </>
      )}
    </Box>
  );
}

// --- Exports ---

export async function runTreeApp(
  skills: Skill[],
  allDecks: Deck[],
  cardsByDeck: Map<number, Card[]>,
  store: Store,
): Promise<void> {
  const { waitUntilExit } = render(
    <TreeApp
      initialSkills={skills}
      allDecks={allDecks}
      cardsByDeck={cardsByDeck}
      store={store}
    />,
  );
  await waitUntilExit();
}

export async function runReviewApp(
  decks: Deck[],
  cardsByDeck: Map<number, Card[]>,
  selectedDeck: number,
  mode: string,
  startInReview: boolean,
  store: Store | null,
): Promise<void> {
  const App = () => {
    const { exit } = useApp();
    return (
      <ReviewView
        decks={decks}
        cardsByDeck={cardsByDeck}
        initialDeck={selectedDeck}
        mode={mode}
        startInReview={startInReview}
        store={store}
        onDone={() => exit()}
      />
    );
  };
  const { waitUntilExit } = render(<App />);
  await waitUntilExit();
}
