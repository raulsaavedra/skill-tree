---
name: skill-builder
description: Unified learning CLI — skill tree, quiz decks, and hands-on scenarios in one tool. Use at session start to load learning context.
---

## Overview
- `skill-builder` is a unified learning CLI that tracks skills (hierarchical tree with levels), quiz decks (flashcard/MCQ review), and hands-on scenarios.
- All data is stored in a local SQLite database. The CLI does not call LLMs or external APIs.
- Skills, decks, cards, and scenarios are managed via CLI commands; SQLite is the canonical store.
- Review is TUI-only and supports flashcard, MCQ, and auto modes.
- Decks and scenarios can be linked to skills to show learning activities per skill.

## Important: Command Format
- **Always use single-line commands** for all skill-builder CLI operations.
- Do NOT use backslash (`\`) line continuations.
- This ensures Claude Code permissions work correctly with `Bash(skill-builder:*)` patterns.

## Session Start
At the start of every learning session, run:
```
skill-builder context --json
```
This returns the full skill tree with levels, linked decks (with card counts), linked scenarios, and all active (planned/in_progress) scenarios. Use this to understand where the learner currently stands.

## Database location
- `$HOME/.skill-builder/skill-builder.db`

## Skill management

### Skill model
- Each skill has:
  - An integer `ID` (primary identifier).
  - An optional `parent_id` forming a hierarchy (tree structure).
  - A `name` and optional `description`.
  - A `level` (0-5) indicating proficiency.
  - Linked decks and scenarios (via junction tables).
  - Timestamps (`created_at`, `updated_at`).

### Level scale (0-5)

| Level | Label | When to assign |
|-------|-------|----------------|
| 0 | Unexplored | Haven't touched it |
| 1 | Awareness | Know the concept exists, can describe it |
| 2 | Guided | Can do with docs/guidance open |
| 3 | Independent | Can do solo without reference |
| 4 | Proficient | Confident, could teach others |
| 5 | Expert | Deep understanding, can debug edge cases |

### Skill commands
- Add a root skill:
  - `skill-builder skill add --name "AWS"`
- Add a child skill:
  - `skill-builder skill add --name "VPC" --parent-id 1 --description "Virtual Private Cloud" --level 1`
- List skills (flat):
  - `skill-builder skill list`
- List skills (tree):
  - `skill-builder skill list --tree`
- List skills (JSON):
  - `skill-builder skill list --json`
- Show a skill with linked decks and scenarios:
  - `skill-builder skill show --id 2`
  - `skill-builder skill show --id 2 --json`
- Update a skill:
  - `skill-builder skill update --id 2 --level 3`
  - `skill-builder skill update --id 2 --name "VPC & Subnets" --description "Updated description"`
- Delete a skill:
  - `skill-builder skill delete --id 2`

## Scenario management

### Scenario model
- Each scenario has:
  - An integer `ID`.
  - A `name` and optional `description`.
  - An optional `repo_path` pointing to a project directory.
  - A `status`: `planned`, `in_progress`, `completed`, or `abandoned`.
  - Linked skills (many-to-many via junction table).
  - Timestamps (`created_at`, `updated_at`, `completed_at`).

### Scenario commands
- Add a scenario linked to skills:
  - `skill-builder scenario add --name "Build multi-tier VPC" --description "Hands-on VPC lab" --skill-id 1 --skill-id 2`
- Add a scenario with a repo path:
  - `skill-builder scenario add --name "Deploy Go service" --repo "/Users/raulsaavedra/src/vpc-lab"`
- List all scenarios:
  - `skill-builder scenario list`
  - `skill-builder scenario list --json`
- List by status:
  - `skill-builder scenario list --status in_progress`
- Show a scenario:
  - `skill-builder scenario show --id 1`
  - `skill-builder scenario show --id 1 --json`
- Update scenario status:
  - `skill-builder scenario update --id 1 --status in_progress`
  - `skill-builder scenario update --id 1 --status completed`
- Delete a scenario:
  - `skill-builder scenario delete --id 1`
- Link/unlink a scenario to a skill:
  - `skill-builder scenario link --scenario-id 1 --skill-id 3`
  - `skill-builder scenario unlink --scenario-id 1 --skill-id 3`

## Deck management

### Deck model
- Each deck has:
  - An integer `ID`.
  - A `name` (unique) and optional `description`.
  - A collection of cards stored in SQLite.
  - Can be linked to skills.

### Deck commands
- Create a deck:
  - `skill-builder deck create --deck-name "VPC Fundamentals" --description "Core VPC concepts"`
- Create a deck linked to a skill:
  - `skill-builder deck create --deck-name "VPC Fundamentals" --skill-id 2`
- Create a deck from JSON:
  - `skill-builder deck create --data '{"name":"VPC Quiz","description":"VPC questions","cards":[{"question":"What is a VPC?","answer":"Virtual Private Cloud"}]}'`
- List decks:
  - `skill-builder deck list`
  - `skill-builder deck list --json`
- Delete a deck:
  - `skill-builder deck delete --deck-id 1`
  - `skill-builder deck delete --deck-name "VPC Quiz"`
- Link/unlink a deck to a skill:
  - `skill-builder deck link --deck-id 1 --skill-id 2`
  - `skill-builder deck unlink --deck-id 1 --skill-id 2`

## Card management

### Card model
- Each card belongs to a deck and has:
  - `question`: required.
  - `answer`: required short canonical answer.
  - `extra`: optional explanation or rationale.
  - `choices`: optional list of choices for MCQ-capable cards.
  - `correct_index`: optional index into `choices` for MCQ.
  - `tags`: optional set of tags.

### Markdown support
The `answer` and `extra` fields support markdown formatting in the TUI:
- `**bold**` renders as bold text
- `*italic*` renders as italic text
- `` `code` `` renders as yellow inline code
- Code blocks with ``` render indented and dimmed
- Lists with `-` or `*` render with bullet points
- Line breaks are preserved

### Card commands
- Add a card:
  - `skill-builder card add --deck-id 1 --question "What is a VPC?" --answer "Virtual Private Cloud" --extra "Logically isolated network in AWS"`
- Add an MCQ card:
  - `skill-builder card add --deck-id 1 --question "Which is a VPC component?" --answer "Subnet" --choice "Lambda" --choice "Subnet" --choice "S3 Bucket" --correct-index 1 --tag "networking"`
- Add multiple cards via JSON:
  - `skill-builder card add --deck-id 1 --data '[{"question":"Q1","answer":"A1"},{"question":"Q2","answer":"A2","extra":"Details"}]'`
  - `skill-builder card add --deck-id 1 --file /tmp/cards.json`
- List cards:
  - `skill-builder card list --deck-id 1`
  - `skill-builder card list --deck-id 1 --limit 100`
- Show a card:
  - `skill-builder card show --deck-id 1 --card-id 5`
- Update a card:
  - `skill-builder card update --deck-id 1 --card-id 5 --answer "Updated answer" --extra "New explanation"`
- Delete cards:
  - `skill-builder card delete --deck-id 1 --card-id 5`
  - `skill-builder card delete --deck-id 1 --card-ids "1,2,5-7"`

## Review

### Review entrypoints
- Review all decks (with TUI deck selector):
  - `skill-builder review`
- Review a specific deck:
  - `skill-builder review --deck "VPC Fundamentals"`
  - `skill-builder review "VPC Fundamentals"`
- Review all cards linked to a skill (includes child skills):
  - `skill-builder review --skill "VPC"`

### Review mode (`--mode`)
- `--mode flashcard`: show question, reveal answer + extra.
- `--mode mcq`: show MCQ UI for cards with choices. Falls back to flashcard for cards without.
- `--mode auto`: use MCQ when choices exist, otherwise flashcard.

### Keyboard controls (TUI)
- `enter`/`space`: reveal answer, then advance to next card
- `n`/`p`: next/previous card
- `f`/`m`/`a`: switch to flashcard/mcq/auto mode
- `j`/`k` or `up`/`down`: navigate MCQ choices
- `q` or `ctrl+c`: quit

## Tree TUI
```
skill-builder tree
```
Interactive skill tree navigator. Navigate with `j`/`k`, expand/collapse with `enter`, press `d` for skill detail (shows linked decks and scenarios), `r` to start a review from detail view, `b` to go back, `q` to quit.

## Import from quiz CLI
```
skill-builder import --from-quiz
```
Imports all decks and cards from `~/.quiz/quiz.db` into skill-builder. Skips decks whose name already exists (idempotent). Does not delete the quiz database.

## Recommended flows

### Setting up a new skill area
1. Create the skill hierarchy:
   - `skill-builder skill add --name "AWS"`
   - `skill-builder skill add --name "Networking" --parent-id 1`
   - `skill-builder skill add --name "VPC" --parent-id 2 --level 0`
2. Create a quiz deck linked to the skill:
   - `skill-builder deck create --deck-name "VPC Fundamentals" --description "Core VPC concepts" --skill-id 3`
3. Add cards to the deck.
4. Create a hands-on scenario:
   - `skill-builder scenario add --name "Build multi-tier VPC" --skill-id 2 --skill-id 3`

### Running a learning session
1. Load context: `skill-builder context --json`
2. Pick an active scenario or create one.
3. Start scenario: `skill-builder scenario update --id 1 --status in_progress`
4. Work through the scenario hands-on with Claude as tutor.
5. Create/update quiz cards based on what was learned.
6. Update skill levels as proficiency grows: `skill-builder skill update --id 3 --level 2`
7. Complete scenario: `skill-builder scenario update --id 1 --status completed`
8. Review cards: `skill-builder review --skill "VPC"`

### Updating skill levels
Update levels based on demonstrated proficiency during sessions:
- After first exposure to a concept: level 1 (Awareness)
- After working through it with docs open: level 2 (Guided)
- After completing a scenario independently: level 3 (Independent)
- After teaching/explaining it clearly: level 4 (Proficient)
- After debugging complex edge cases: level 5 (Expert)

## Writing effective MCQ cards

MCQ cards are most effective when the `extra` field explains:
1. **Why the correct answer is right**
2. **Why each wrong answer is wrong**

Example:
```json
{
  "question": "Which AWS service discovers PII in S3?",
  "answer": "Amazon Macie",
  "extra": "**Macie = Sensitive Data Discovery in S3.**\n\n**Why others are wrong:**\n- **GuardDuty**: Detects threats, not data\n- **Inspector**: Scans for vulnerabilities\n- **Shield**: DDoS protection",
  "choices": ["GuardDuty", "Macie", "Inspector", "Shield"],
  "correctIndex": 1,
  "tags": ["security", "s3"]
}
```

## Notes
- The CLI does not call LLMs or external APIs; it operates on local SQLite data.
- Decks and cards are managed via CLI commands; SQLite is the canonical store.
- The tree TUI provides a visual way to navigate skills and launch reviews.
