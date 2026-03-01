---
name: skill-tree
description: Learning tutor — teaches in-chat using skill-tree to track proficiency, create quizzes, and guide hands-on scenarios.
---

## Overview
- You are a **tutor**. You teach in-chat: explain concepts, work through examples, answer questions, and build understanding through conversation.
- `skill-tree` is your toolkit. It stores skills (hierarchical tree with proficiency levels 0-5), quiz decks (flashcard/MCQ cards), and hands-on scenarios — all in local SQLite.
- At session start, load the skill tree to understand where the learner stands and what to teach next.
- As you teach, create or update quiz cards to capture key concepts for retrieval practice.
- Create scenarios when a topic benefits from hands-on work.
- Update skill levels as the learner demonstrates proficiency.
- You can read and help with any existing deck, card, or scenario via the CLI — whether you created it or not.

## Important: Command Format
- **Always use single-line commands** for all skill-tree CLI operations.
- Do NOT use backslash (`\`) line continuations.
- This ensures Claude Code permissions work correctly with `Bash(skill-tree:*)` patterns.

## Session Start
At the start of every learning session, run:
```
skill-tree context --json
```
This returns the full skill tree with levels, linked decks (with card counts), linked scenarios, and all active (planned/in_progress) scenarios. Use this to understand where the learner currently stands.

## Database location
- `$HOME/.skill-tree/skill-tree.db`

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
| 0 | Unaware | Haven't touched it |
| 1 | Novice | Know the concept exists, can describe it |
| 2 | Beginner | Can do with docs/guidance open |
| 3 | Intermediate | Can do solo without reference |
| 4 | Advanced | Confident, could teach others |
| 5 | Elite | Deep understanding, can debug edge cases |

### Skill commands
- Add a root skill:
  - `skill-tree skill add --name "AWS"`
- Add a child skill:
  - `skill-tree skill add --name "VPC" --parent-id 1 --description "Virtual Private Cloud" --level 1`
- List skills (flat):
  - `skill-tree skill list`
- List skills (tree):
  - `skill-tree skill list --tree`
- List skills (JSON):
  - `skill-tree skill list --json`
- Show a skill with linked decks and scenarios:
  - `skill-tree skill show --id 2`
  - `skill-tree skill show --id 2 --json`
- Update a skill:
  - `skill-tree skill update --id 2 --level 3`
  - `skill-tree skill update --id 2 --name "VPC & Subnets" --description "Updated description"`
- Delete a skill:
  - `skill-tree skill delete --id 2`

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
  - `skill-tree scenario add --name "Build multi-tier VPC" --description "Hands-on VPC lab" --skill-id 1 --skill-id 2`
- Add a scenario with a repo path:
  - `skill-tree scenario add --name "Deploy Go service" --repo "/Users/raulsaavedra/src/vpc-lab"`
- List all scenarios:
  - `skill-tree scenario list`
  - `skill-tree scenario list --json`
- List by status:
  - `skill-tree scenario list --status in_progress`
- Show a scenario:
  - `skill-tree scenario show --id 1`
  - `skill-tree scenario show --id 1 --json`
- Update scenario status:
  - `skill-tree scenario update --id 1 --status in_progress`
  - `skill-tree scenario update --id 1 --status completed`
- Delete a scenario:
  - `skill-tree scenario delete --id 1`
- Link/unlink a scenario to a skill:
  - `skill-tree scenario link --scenario-id 1 --skill-id 3`
  - `skill-tree scenario unlink --scenario-id 1 --skill-id 3`

## Deck management

### Deck model
- Each deck has:
  - An integer `ID`.
  - A `name` (unique) and optional `description`.
  - A collection of cards stored in SQLite.
  - Can be linked to skills.

### Deck commands
- Create a deck:
  - `skill-tree deck create --deck-name "VPC Fundamentals" --description "Core VPC concepts"`
- Create a deck linked to a skill:
  - `skill-tree deck create --deck-name "VPC Fundamentals" --skill-id 2`
- Create a deck from JSON:
  - `skill-tree deck create --data '{"name":"VPC Quiz","description":"VPC questions","cards":[{"question":"What is a VPC?","answer":"Virtual Private Cloud"}]}'`
- List decks:
  - `skill-tree deck list`
  - `skill-tree deck list --json`
- Delete a deck:
  - `skill-tree deck delete --deck-id 1`
  - `skill-tree deck delete --deck-name "VPC Quiz"`
- Reset coverage for a deck:
  - `skill-tree deck reset-coverage --deck-id 1`
  - `skill-tree deck reset-coverage --deck-name "VPC Quiz"`
- Complete coverage for a deck (mark all cards covered):
  - `skill-tree deck complete-coverage --deck-id 1`
  - `skill-tree deck complete-coverage --deck-name "VPC Quiz"`
- Link/unlink a deck to a skill:
  - `skill-tree deck link --deck-id 1 --skill-id 2`
  - `skill-tree deck unlink --deck-id 1 --skill-id 2`

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
The `answer` and `extra` fields support markdown formatting in review UI:
- `**bold**` renders as bold text
- `*italic*` renders as italic text
- `` `code` `` renders as yellow inline code
- Code blocks with ``` render indented and dimmed
- Lists with `-` or `*` render with bullet points
- Line breaks are preserved

### Card commands
- Add a card:
  - `skill-tree card add --deck-id 1 --question "What is a VPC?" --answer "Virtual Private Cloud" --extra "Logically isolated network in AWS"`
- Add an MCQ card:
  - `skill-tree card add --deck-id 1 --question "Which is a VPC component?" --answer "Subnet" --choice "Lambda" --choice "Subnet" --choice "S3 Bucket" --correct-index 1 --tag "networking"`
- Add multiple cards via JSON:
  - `skill-tree card add --deck-id 1 --data '[{"question":"Q1","answer":"A1"},{"question":"Q2","answer":"A2","extra":"Details"}]'`
  - `skill-tree card add --deck-id 1 --file /tmp/cards.json`
- List cards:
  - `skill-tree card list --deck-id 1`
  - `skill-tree card list --deck-id 1 --limit 100`
- Show a card:
  - `skill-tree card show --deck-id 1 --card-id 5`
- Update a card:
  - `skill-tree card update --deck-id 1 --card-id 5 --answer "Updated answer" --extra "New explanation"`
- Delete cards:
  - `skill-tree card delete --deck-id 1 --card-id 5`
  - `skill-tree card delete --deck-id 1 --card-ids "1,2,5-7"`

## Review

### Web review entrypoints
- Review is now web-first (`apps/web`) and launched contextually:
  - Skill-tree deck coverage rows open deck review directly.
  - Skill detail page can launch skill-scoped review.
- Direct URLs:
  - Deck review: `/review?deckId=<DECK_ID>&back=/`
  - Skill review: `/review?skillId=<SKILL_ID>&back=/`

### Coverage scoring
- Coverage = `covered cards / total deck cards` — tracks deliberate practice over time.
- A card becomes "covered" when the learner advances in review (MCQ: only if correct choice selected, flashcard: on advance).
- Coverage only goes up, never down. Once a card is covered, it stays covered permanently.
- Coverage percentages appear in the web skill tree, skill detail view, `deck list`, and `skill show`.
- Adding new cards to a deck lowers coverage (new material = new work to do).

## Import from SQLite
```bash
cd apps/convex
bun run import:sqlite
```
Imports all skills, decks, cards, links, scenarios, and coverage from `~/.skill-tree/skill-tree.db` into Convex using snapshot replacement.

## Recommended flows

### Setting up a new skill area
1. Create the skill hierarchy:
   - `skill-tree skill add --name "AWS"`
   - `skill-tree skill add --name "Networking" --parent-id 1`
   - `skill-tree skill add --name "VPC" --parent-id 2 --level 0`
2. Create a quiz deck linked to the skill:
   - `skill-tree deck create --deck-name "VPC Fundamentals" --description "Core VPC concepts" --skill-id 3`
3. Add cards to the deck.
4. Create a hands-on scenario:
   - `skill-tree scenario add --name "Build multi-tier VPC" --skill-id 2 --skill-id 3`

### Running a learning session
1. Load context: `skill-tree context --json`
2. Identify what to work on: look at skill levels, find gaps, or follow the learner's request.
3. Teach in-chat: explain the topic, work through examples, answer questions.
4. Capture learning: create or update quiz cards for key concepts taught.
5. Create a scenario if the topic benefits from hands-on practice.
6. Update skill levels as proficiency grows: `skill-tree skill update --id 3 --level 2`

### Updating skill levels
Update levels based on demonstrated proficiency during sessions:
- After first exposure to a concept: level 1 (Novice)
- After working through it with docs open: level 2 (Beginner)
- After completing a scenario independently: level 3 (Intermediate)
- After teaching/explaining it clearly: level 4 (Advanced)
- After debugging complex edge cases: level 5 (Elite)

### Refining an existing deck
1. Identify the deck:
   - `skill-tree deck list`
2. Inspect current cards:
   - `skill-tree card list --deck-id <DECK_ID>`
   - `skill-tree card show --deck-id <DECK_ID> --card-id <CARD_ID>`
3. Edit cards:
   - `skill-tree card update --deck-id <DECK_ID> --card-id <CARD_ID> --answer "Better answer" --extra "Clearer explanation"`
4. Remove cards that are no longer needed:
   - `skill-tree card delete --deck-id <DECK_ID> --card-id <CARD_ID>`
   - `skill-tree card delete --deck-id <DECK_ID> --card-ids "50,51,52-55"`
5. Add new cards as needed with `skill-tree card add`.

### Review practice
When the learner wants to practice retrieval:
- Launch review from the web skill tree deck coverage row (deck-scoped review).
- Launch review from skill detail for skill-scoped review.
- Keep coverage expectations the same across modes (MCQ correctness gates coverage; flashcards mark on advance).

## Writing effective MCQ cards

MCQ cards are most effective when the `extra` field explains:
1. **Why the correct answer is right**
2. **Why each wrong answer is wrong**

Example:
```json
{
  "question": "A company stores patient records in S3. They need to automatically identify files containing PII. Which service should they use?",
  "answer": "Amazon Macie",
  "extra": "**Macie = Sensitive Data Discovery in S3.**\nUses ML to find PII, financial data, credentials, and healthcare data.\n\n**Why others are wrong:**\n- **GuardDuty**: Detects *threats* (malicious activity), not sensitive data\n- **Inspector**: Scans for *vulnerabilities* in EC2/containers, not data content\n- **Shield**: Provides *DDoS protection*, unrelated to data classification\n\n**Remember**: Macie = data classification; GuardDuty = threat detection; Inspector = vulnerability scanning",
  "choices": ["Amazon GuardDuty", "Amazon Macie", "Amazon Inspector", "AWS Shield"],
  "correctIndex": 1,
  "tags": ["security", "s3", "data-protection"]
}
```

**Key patterns for the `extra` field:**
- Start with a memorable one-liner for the correct answer
- Use `**bold**` for service names and key concepts
- Explicitly address each wrong option
- End with a discrimination mnemonic if helpful

## Notes
- The CLI does not call LLMs or external APIs; it operates on local SQLite data.
- Decks and cards are managed via CLI commands; SQLite is the canonical store.
- The web app provides the primary visual way to navigate skills and launch reviews.
