# skill-tree

`skill-tree` is a local-first learning system for ongoing tutoring and practice with an agent.

A good way to think about it is as a tutoring system. The agent is the tutor. The learner brings the topic, asks questions, and refines their understanding in conversation. The tutor then uses `skill-tree` to keep track of what is being learned, create material to review, assign practice through the TUI, and carry the progress forward across sessions.

`skill-tree` keeps track of skills, quiz decks, hands-on scenarios, and proficiency levels. Those are the pieces the agent uses to understand what the learner is working on, and they are also what the learner sees in the TUI when reviewing progress or practicing retrieval.

## How It Works In Practice

The normal workflow is a person learning through an agent that uses `skill-tree` behind the scenes.

A typical session looks like this:

1. **The learner brings a topic, problem, or goal.** That might be something broad like networking or something narrow like "help me understand NAT and gateways."
2. **The agent loads the current learning context.** At the start of the session, the agent reads the skill tree, linked decks, linked scenarios, and active work.
3. **The agent teaches in conversation.** The learner asks questions, works through examples, and builds understanding through back-and-forth tutoring.
4. **The agent updates the learning system.** As the session progresses, the agent can create or refine skills, cards, scenarios, and proficiency levels so the important parts carry forward.
5. **The learner practices in the TUI.** The learner can browse the skill tree, inspect linked decks and scenarios, and review the material through the built-in TUI.
6. **Later sessions continue from the same foundation.** Because the context is stored locally, the tutoring and practice can pick up where they left off and get sharper over time.

Each session can extend the ones that came before it.

During that process, the agent is usually the one organizing the skill tree, writing or refining cards, creating scenarios, and updating levels as the learner makes progress. The learner then uses the TUI to exercise on that material, which is why the agent workflow and the TUI belong to the same system rather than being separate features.

## Installation

Build and install from the repo:

```bash
./install.sh
```

This compiles a release binary and installs it to `~/.local/bin/skill-tree`.

Then install the bundled `skill-tree` skill so your agent can use the stored data as tutoring context:

```bash
skill-tree skill install
```

By default this installs into the default skill directories for your local agent setup.

Use `--link` to install the skill as a symlink to the source directory:

```bash
skill-tree skill install --link
```

The skill definition lives at [`skills/skill-tree/SKILL.md`](./skills/skill-tree/SKILL.md).

## Data

`skill-tree` stores its data locally in:

```text
$HOME/.skill-tree/skill-tree.db
```

The core workflow runs entirely on local data.

## Development

```bash
cargo build          # compile
cargo run -- --help  # run directly
./install.sh         # compile standalone binary
```

The project uses Rust with Ratatui for the TUI, Clap for the CLI, and rusqlite for storage.

## License

MIT. See [`LICENSE.md`](./LICENSE.md).
