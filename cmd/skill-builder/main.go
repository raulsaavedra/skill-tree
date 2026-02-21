package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/raulsaavedra/cli-core/pkg/output"
	"github.com/raulsaavedra/cli-core/pkg/skills"
	"github.com/raulsaavedra/cli-core/pkg/sqliteutil"
	"github.com/spf13/cobra"

	"github.com/raulsaavedra/skill-builder/internal/store"
	"github.com/raulsaavedra/skill-builder/internal/tui"
)

func main() {
	root := &cobra.Command{
		Use:   "skill-builder",
		Short: "Unified learning CLI: skill tree + quiz decks + scenarios",
	}

	root.AddCommand(
		contextCmd(),
		skillCmd(),
		scenarioCmd(),
		deckCmd(),
		cardCmd(),
		reviewCmd(),
		treeCmd(),
		importCmd(),
	)

	if err := root.Execute(); err != nil {
		output.Errorf("%v", err)
		os.Exit(1)
	}
}

// --- context ---

func contextCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "context",
		Short: "Full context dump (skill tree + scenarios)",
		RunE: func(cmd *cobra.Command, args []string) error {
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()
			ctx, err := st.FullContext()
			if err != nil {
				return err
			}
			return output.JSON(ctx)
		},
	}
	cmd.Flags().Bool("json", false, "JSON output (default, always enabled)")
	return cmd
}

// --- skill ---

func skillCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "skill", Short: "Manage skills"}

	add := &cobra.Command{
		Use:   "add",
		Short: "Add skill",
		RunE: func(cmd *cobra.Command, args []string) error {
			name, _ := cmd.Flags().GetString("name")
			description, _ := cmd.Flags().GetString("description")
			parentID, _ := cmd.Flags().GetInt64("parent-id")
			level, _ := cmd.Flags().GetInt("level")
			if name == "" {
				return fmt.Errorf("--name is required")
			}
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()
			var pid *int64
			if parentID > 0 {
				pid = &parentID
			}
			id, err := st.CreateSkill(name, description, pid, level)
			if err != nil {
				return err
			}
			fmt.Printf("Created skill %d: %s\n", id, name)
			return nil
		},
	}
	add.Flags().String("name", "", "Skill name")
	add.Flags().String("description", "", "Skill description")
	add.Flags().Int64("parent-id", 0, "Parent skill ID")
	add.Flags().Int("level", 0, "Initial level (0-5)")

	list := &cobra.Command{
		Use:   "list",
		Short: "List skills",
		RunE: func(cmd *cobra.Command, args []string) error {
			tree, _ := cmd.Flags().GetBool("tree")
			parentID, _ := cmd.Flags().GetInt64("parent-id")
			jsonFlag, _ := cmd.Flags().GetBool("json")
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()

			if tree || jsonFlag {
				skills, err := st.SkillTree()
				if err != nil {
					return err
				}
				if jsonFlag {
					return output.JSON(skills)
				}
				printSkillTree(skills, 0)
				return nil
			}

			var pid *int64
			if parentID > 0 {
				pid = &parentID
			}
			skills, err := st.ListSkills(pid)
			if err != nil {
				return err
			}
			for _, s := range skills {
				fmt.Printf("%d\t%s\t%d/5\n", s.ID, s.Name, s.Level)
			}
			return nil
		},
	}
	list.Flags().Bool("tree", false, "Show as tree")
	list.Flags().Int64("parent-id", 0, "Filter by parent")
	list.Flags().Bool("json", false, "JSON output")

	show := &cobra.Command{
		Use:   "show",
		Short: "Show skill",
		RunE: func(cmd *cobra.Command, args []string) error {
			id, _ := cmd.Flags().GetInt64("id")
			jsonFlag, _ := cmd.Flags().GetBool("json")
			if id == 0 {
				return fmt.Errorf("--id is required")
			}
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()
			skill, err := st.GetSkill(id)
			if err != nil {
				return err
			}
			if jsonFlag {
				return output.JSON(skill)
			}
			fmt.Printf("ID: %d\nName: %s\nLevel: %d/5\nDescription: %s\n", skill.ID, skill.Name, skill.Level, skill.Description)
			if len(skill.Decks) > 0 {
				fmt.Println("Decks:")
				for _, d := range skill.Decks {
					fmt.Printf("  %d: %s (%d cards)\n", d.ID, d.Name, d.CardCount)
				}
			}
			if len(skill.Scenarios) > 0 {
				fmt.Println("Scenarios:")
				for _, sc := range skill.Scenarios {
					fmt.Printf("  %d: %s [%s]\n", sc.ID, sc.Name, sc.Status)
				}
			}
			return nil
		},
	}
	show.Flags().Int64("id", 0, "Skill ID")
	show.Flags().Bool("json", false, "JSON output")

	update := &cobra.Command{
		Use:   "update",
		Short: "Update skill",
		RunE: func(cmd *cobra.Command, args []string) error {
			id, _ := cmd.Flags().GetInt64("id")
			if id == 0 {
				return fmt.Errorf("--id is required")
			}
			name, _ := cmd.Flags().GetString("name")
			description, _ := cmd.Flags().GetString("description")
			level, _ := cmd.Flags().GetInt("level")
			u := store.SkillUpdate{}
			if cmd.Flags().Changed("name") {
				u.Name = &name
			}
			if cmd.Flags().Changed("description") {
				u.Description = &description
			}
			if cmd.Flags().Changed("level") {
				u.Level = &level
			}
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()
			if err := st.UpdateSkill(id, u); err != nil {
				return err
			}
			fmt.Printf("Updated skill %d\n", id)
			return nil
		},
	}
	update.Flags().Int64("id", 0, "Skill ID")
	update.Flags().String("name", "", "New name")
	update.Flags().String("description", "", "New description")
	update.Flags().Int("level", 0, "New level (0-5)")

	del := &cobra.Command{
		Use:   "delete",
		Short: "Delete skill",
		RunE: func(cmd *cobra.Command, args []string) error {
			id, _ := cmd.Flags().GetInt64("id")
			if id == 0 {
				return fmt.Errorf("--id is required")
			}
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()
			if err := st.DeleteSkill(id); err != nil {
				return err
			}
			fmt.Printf("Deleted skill %d\n", id)
			return nil
		},
	}
	del.Flags().Int64("id", 0, "Skill ID")

	install := &cobra.Command{
		Use:   "install",
		Short: "Install skill",
		RunE: func(cmd *cobra.Command, args []string) error {
			dest, _ := cmd.Flags().GetString("dest")
			force, _ := cmd.Flags().GetBool("force")
			link, _ := cmd.Flags().GetBool("link")
			destDir, err := skills.ResolveSkillsDir(dest)
			if err != nil {
				return err
			}
			path, err := skills.Install(skills.InstallOptions{
				SrcDir:    "skills/skill-builder",
				DestDir:   destDir,
				Name:      "skill-builder",
				Overwrite: force,
				Link:      link,
			})
			if err != nil {
				return err
			}
			output.Success("Installed skill to %s", path)
			return nil
		},
	}
	install.Flags().String("dest", "", "Destination skills directory")
	install.Flags().Bool("force", false, "Overwrite destination")
	install.Flags().Bool("link", false, "Symlink instead of copy")

	cmd.AddCommand(add, list, show, update, del, install)
	return cmd
}

// --- scenario ---

func scenarioCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "scenario", Short: "Manage scenarios"}

	add := &cobra.Command{
		Use:   "add",
		Short: "Add scenario",
		RunE: func(cmd *cobra.Command, args []string) error {
			name, _ := cmd.Flags().GetString("name")
			description, _ := cmd.Flags().GetString("description")
			repo, _ := cmd.Flags().GetString("repo")
			skillIDs, _ := cmd.Flags().GetInt64Slice("skill-id")
			if name == "" {
				return fmt.Errorf("--name is required")
			}
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()
			id, err := st.CreateScenario(name, description, repo, skillIDs)
			if err != nil {
				return err
			}
			fmt.Printf("Created scenario %d: %s\n", id, name)
			return nil
		},
	}
	add.Flags().String("name", "", "Scenario name")
	add.Flags().String("description", "", "Scenario description")
	add.Flags().String("repo", "", "Repository path")
	add.Flags().Int64Slice("skill-id", nil, "Linked skill IDs")

	list := &cobra.Command{
		Use:   "list",
		Short: "List scenarios",
		RunE: func(cmd *cobra.Command, args []string) error {
			status, _ := cmd.Flags().GetString("status")
			jsonFlag, _ := cmd.Flags().GetBool("json")
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()
			scenarios, err := st.ListScenarios(status)
			if err != nil {
				return err
			}
			if jsonFlag {
				return output.JSON(scenarios)
			}
			for _, sc := range scenarios {
				fmt.Printf("%d\t%s\t%s\n", sc.ID, sc.Name, sc.Status)
			}
			return nil
		},
	}
	list.Flags().String("status", "", "Filter by status")
	list.Flags().Bool("json", false, "JSON output")

	show := &cobra.Command{
		Use:   "show",
		Short: "Show scenario",
		RunE: func(cmd *cobra.Command, args []string) error {
			id, _ := cmd.Flags().GetInt64("id")
			jsonFlag, _ := cmd.Flags().GetBool("json")
			if id == 0 {
				return fmt.Errorf("--id is required")
			}
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()
			sc, err := st.GetScenario(id)
			if err != nil {
				return err
			}
			if jsonFlag {
				return output.JSON(sc)
			}
			fmt.Printf("ID: %d\nName: %s\nStatus: %s\nDescription: %s\n", sc.ID, sc.Name, sc.Status, sc.Description)
			if sc.RepoPath != "" {
				fmt.Printf("Repo: %s\n", sc.RepoPath)
			}
			if len(sc.Skills) > 0 {
				fmt.Println("Skills:")
				for _, s := range sc.Skills {
					fmt.Printf("  %d: %s\n", s.ID, s.Name)
				}
			}
			return nil
		},
	}
	show.Flags().Int64("id", 0, "Scenario ID")
	show.Flags().Bool("json", false, "JSON output")

	update := &cobra.Command{
		Use:   "update",
		Short: "Update scenario",
		RunE: func(cmd *cobra.Command, args []string) error {
			id, _ := cmd.Flags().GetInt64("id")
			if id == 0 {
				return fmt.Errorf("--id is required")
			}
			name, _ := cmd.Flags().GetString("name")
			description, _ := cmd.Flags().GetString("description")
			repo, _ := cmd.Flags().GetString("repo")
			status, _ := cmd.Flags().GetString("status")
			u := store.ScenarioUpdate{}
			if cmd.Flags().Changed("name") {
				u.Name = &name
			}
			if cmd.Flags().Changed("description") {
				u.Description = &description
			}
			if cmd.Flags().Changed("repo") {
				u.RepoPath = &repo
			}
			if cmd.Flags().Changed("status") {
				u.Status = &status
			}
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()
			if err := st.UpdateScenario(id, u); err != nil {
				return err
			}
			fmt.Printf("Updated scenario %d\n", id)
			return nil
		},
	}
	update.Flags().Int64("id", 0, "Scenario ID")
	update.Flags().String("name", "", "New name")
	update.Flags().String("description", "", "New description")
	update.Flags().String("repo", "", "New repo path")
	update.Flags().String("status", "", "New status (planned, in_progress, completed, abandoned)")

	del := &cobra.Command{
		Use:   "delete",
		Short: "Delete scenario",
		RunE: func(cmd *cobra.Command, args []string) error {
			id, _ := cmd.Flags().GetInt64("id")
			if id == 0 {
				return fmt.Errorf("--id is required")
			}
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()
			if err := st.DeleteScenario(id); err != nil {
				return err
			}
			fmt.Printf("Deleted scenario %d\n", id)
			return nil
		},
	}
	del.Flags().Int64("id", 0, "Scenario ID")

	link := &cobra.Command{
		Use:   "link",
		Short: "Link scenario to skill",
		RunE: func(cmd *cobra.Command, args []string) error {
			scenarioID, _ := cmd.Flags().GetInt64("scenario-id")
			skillID, _ := cmd.Flags().GetInt64("skill-id")
			if scenarioID == 0 || skillID == 0 {
				return fmt.Errorf("--scenario-id and --skill-id are required")
			}
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()
			if err := st.LinkScenarioSkill(scenarioID, skillID); err != nil {
				return err
			}
			fmt.Printf("Linked scenario %d to skill %d\n", scenarioID, skillID)
			return nil
		},
	}
	link.Flags().Int64("scenario-id", 0, "Scenario ID")
	link.Flags().Int64("skill-id", 0, "Skill ID")

	unlink := &cobra.Command{
		Use:   "unlink",
		Short: "Unlink scenario from skill",
		RunE: func(cmd *cobra.Command, args []string) error {
			scenarioID, _ := cmd.Flags().GetInt64("scenario-id")
			skillID, _ := cmd.Flags().GetInt64("skill-id")
			if scenarioID == 0 || skillID == 0 {
				return fmt.Errorf("--scenario-id and --skill-id are required")
			}
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()
			if err := st.UnlinkScenarioSkill(scenarioID, skillID); err != nil {
				return err
			}
			fmt.Printf("Unlinked scenario %d from skill %d\n", scenarioID, skillID)
			return nil
		},
	}
	unlink.Flags().Int64("scenario-id", 0, "Scenario ID")
	unlink.Flags().Int64("skill-id", 0, "Skill ID")

	cmd.AddCommand(add, list, show, update, del, link, unlink)
	return cmd
}

// --- deck ---

func deckCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "deck", Short: "Manage decks"}

	create := &cobra.Command{
		Use:   "create",
		Short: "Create deck",
		RunE: func(cmd *cobra.Command, args []string) error {
			deckName, _ := cmd.Flags().GetString("deck-name")
			description, _ := cmd.Flags().GetString("description")
			data, _ := cmd.Flags().GetString("data")
			file, _ := cmd.Flags().GetString("file")
			skillIDs, _ := cmd.Flags().GetInt64Slice("skill-id")
			if (data != "" || file != "") && (deckName != "" || description != "") {
				return fmt.Errorf("--deck-name/--description cannot be used with --data/--file")
			}
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()

			if data == "" && file == "" {
				if deckName == "" {
					return fmt.Errorf("--deck-name is required")
				}
				deckID, err := st.CreateDeck(deckName, description)
				if err != nil {
					return err
				}
				for _, sid := range skillIDs {
					_ = st.LinkDeckSkill(deckID, sid)
				}
				fmt.Printf("Created deck: %s\n", deckName)
				return nil
			}

			payload, err := readPayload(data, file)
			if err != nil {
				return err
			}
			deckInput, err := parseDeckPayload(payload)
			if err != nil {
				return err
			}
			if deckInput.Name == "" {
				return fmt.Errorf("deck payload requires name")
			}
			deckID, err := st.CreateDeck(deckInput.Name, deckInput.Description)
			if err != nil {
				return err
			}
			for _, sid := range skillIDs {
				_ = st.LinkDeckSkill(deckID, sid)
			}
			for idx, rawCard := range deckInput.Cards {
				card, err := normalizeCard(rawCard)
				if err != nil {
					return fmt.Errorf("card %d: %w", idx+1, err)
				}
				if _, err := st.InsertCard(deckID, card); err != nil {
					return err
				}
			}
			if len(deckInput.Cards) > 0 {
				fmt.Printf("Created deck: %s with %d cards\n", deckInput.Name, len(deckInput.Cards))
			} else {
				fmt.Printf("Created deck: %s\n", deckInput.Name)
			}
			return nil
		},
	}
	create.Flags().String("deck-name", "", "Deck name")
	create.Flags().String("description", "", "Deck description")
	create.Flags().String("data", "", "Deck JSON payload")
	create.Flags().String("file", "", "Path to JSON payload")
	create.Flags().Int64Slice("skill-id", nil, "Link to skill IDs")

	list := &cobra.Command{
		Use:   "list",
		Short: "List decks",
		RunE: func(cmd *cobra.Command, args []string) error {
			jsonFlag, _ := cmd.Flags().GetBool("json")
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()
			decks, err := st.ListDecks()
			if err != nil {
				return err
			}
			if jsonFlag {
				return output.JSON(decks)
			}
			for _, d := range decks {
				fmt.Printf("%d\t%s\t%d\t%s\t%s\n", d.ID, d.Name, d.CardCount, formatUpdatedAt(d.UpdatedAt), d.Description)
			}
			return nil
		},
	}
	list.Flags().Bool("json", false, "JSON output")

	del := &cobra.Command{
		Use:   "delete",
		Short: "Delete deck",
		RunE: func(cmd *cobra.Command, args []string) error {
			deckID, _ := cmd.Flags().GetInt64("deck-id")
			deckName, _ := cmd.Flags().GetString("deck-name")
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()
			if deckID == 0 && deckName == "" {
				return fmt.Errorf("either --deck-id or --deck-name is required")
			}
			if deckID == 0 {
				deck, err := st.GetDeckByName(deckName)
				if err != nil {
					return err
				}
				deckID = deck.ID
			}
			if err := st.DeleteDeckByID(deckID); err != nil {
				return err
			}
			fmt.Printf("Deleted deck id: %d\n", deckID)
			return nil
		},
	}
	del.Flags().Int64("deck-id", 0, "Deck id")
	del.Flags().String("deck-name", "", "Deck name")

	link := &cobra.Command{
		Use:   "link",
		Short: "Link deck to skill",
		RunE: func(cmd *cobra.Command, args []string) error {
			deckID, _ := cmd.Flags().GetInt64("deck-id")
			skillID, _ := cmd.Flags().GetInt64("skill-id")
			if deckID == 0 || skillID == 0 {
				return fmt.Errorf("--deck-id and --skill-id are required")
			}
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()
			if err := st.LinkDeckSkill(deckID, skillID); err != nil {
				return err
			}
			fmt.Printf("Linked deck %d to skill %d\n", deckID, skillID)
			return nil
		},
	}
	link.Flags().Int64("deck-id", 0, "Deck ID")
	link.Flags().Int64("skill-id", 0, "Skill ID")

	unlink := &cobra.Command{
		Use:   "unlink",
		Short: "Unlink deck from skill",
		RunE: func(cmd *cobra.Command, args []string) error {
			deckID, _ := cmd.Flags().GetInt64("deck-id")
			skillID, _ := cmd.Flags().GetInt64("skill-id")
			if deckID == 0 || skillID == 0 {
				return fmt.Errorf("--deck-id and --skill-id are required")
			}
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()
			if err := st.UnlinkDeckSkill(deckID, skillID); err != nil {
				return err
			}
			fmt.Printf("Unlinked deck %d from skill %d\n", deckID, skillID)
			return nil
		},
	}
	unlink.Flags().Int64("deck-id", 0, "Deck ID")
	unlink.Flags().Int64("skill-id", 0, "Skill ID")

	cmd.AddCommand(create, list, del, link, unlink)
	return cmd
}

// --- card ---

func cardCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "card", Short: "Manage cards"}

	list := &cobra.Command{
		Use:   "list",
		Short: "List cards in a deck",
		RunE: func(cmd *cobra.Command, args []string) error {
			deckID, err := resolveDeckID(cmd)
			if err != nil {
				return err
			}
			limit, _ := cmd.Flags().GetInt("limit")
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()
			cards, err := st.ListCards(deckID, limit)
			if err != nil {
				return err
			}
			for _, c := range cards {
				fmt.Printf("%d\t%s\n", c.ID, c.Question)
			}
			return nil
		},
	}
	list.Flags().Int("limit", 50, "Limit")
	addDeckFlags(list)

	add := &cobra.Command{
		Use:   "add",
		Short: "Add card",
		RunE: func(cmd *cobra.Command, args []string) error {
			deckID, err := resolveDeckID(cmd)
			if err != nil {
				return err
			}
			data, _ := cmd.Flags().GetString("data")
			file, _ := cmd.Flags().GetString("file")
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()

			if data != "" || file != "" {
				if cmd.Flags().Changed("question") || cmd.Flags().Changed("answer") {
					return fmt.Errorf("--data/--file cannot be used with --question or --answer")
				}
				payload, err := readPayload(data, file)
				if err != nil {
					return err
				}
				cards, err := parseCardsPayload(payload)
				if err != nil {
					return err
				}
				for _, card := range cards {
					if _, err := st.InsertCard(deckID, card); err != nil {
						return err
					}
				}
				fmt.Printf("Added %d cards to deck id %d\n", len(cards), deckID)
				return nil
			}

			question, _ := cmd.Flags().GetString("question")
			answer, _ := cmd.Flags().GetString("answer")
			extra, _ := cmd.Flags().GetString("extra")
			choices, _ := cmd.Flags().GetStringSlice("choice")
			tags, _ := cmd.Flags().GetStringSlice("tag")
			correct, _ := cmd.Flags().GetInt("correct-index")
			if question == "" || answer == "" {
				return fmt.Errorf("--question and --answer are required")
			}
			var correctPtr *int
			if len(choices) > 0 {
				if correct < 0 || correct >= len(choices) {
					return fmt.Errorf("--correct-index must be between 0 and %d", len(choices)-1)
				}
				correctPtr = &correct
			}
			id, err := st.InsertCard(deckID, store.Card{
				Question:     question,
				Answer:       answer,
				Extra:        extra,
				Choices:      choices,
				CorrectIndex: correctPtr,
				Tags:         tags,
			})
			if err != nil {
				return err
			}
			fmt.Printf("Added card %d to deck id %d\n", id, deckID)
			return nil
		},
	}
	addDeckFlags(add)
	add.Flags().String("question", "", "Question")
	add.Flags().String("answer", "", "Answer")
	add.Flags().String("extra", "", "Extra explanation")
	add.Flags().StringSlice("choice", nil, "Choice (repeatable)")
	add.Flags().Int("correct-index", 0, "Correct choice index")
	add.Flags().StringSlice("tag", nil, "Tag (repeatable)")
	add.Flags().String("data", "", "JSON array of cards")
	add.Flags().String("file", "", "Path to JSON array")

	show := &cobra.Command{
		Use:   "show",
		Short: "Show card",
		RunE: func(cmd *cobra.Command, args []string) error {
			deckID, err := resolveDeckID(cmd)
			if err != nil {
				return err
			}
			cardID, _ := cmd.Flags().GetInt64("card-id")
			if cardID == 0 {
				return fmt.Errorf("--card-id is required")
			}
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()
			card, err := st.GetCard(deckID, cardID)
			if err != nil {
				return err
			}
			fmt.Printf("ID: %d\nQuestion: %s\nAnswer: %s\nExtra: %s\n", card.ID, card.Question, card.Answer, card.Extra)
			if len(card.Choices) > 0 {
				fmt.Println("Choices:")
				for i, choice := range card.Choices {
					marker := " "
					if card.CorrectIndex != nil && *card.CorrectIndex == i {
						marker = "*"
					}
					fmt.Printf("  %s %d) %s\n", marker, i+1, choice)
				}
			}
			if len(card.Tags) > 0 {
				fmt.Printf("Tags: %s\n", strings.Join(card.Tags, ", "))
			}
			return nil
		},
	}
	addDeckFlags(show)
	show.Flags().Int64("card-id", 0, "Card id")

	del := &cobra.Command{
		Use:   "delete",
		Short: "Delete card(s)",
		RunE: func(cmd *cobra.Command, args []string) error {
			deckID, err := resolveDeckID(cmd)
			if err != nil {
				return err
			}
			cardID, _ := cmd.Flags().GetInt64("card-id")
			cardIDs, _ := cmd.Flags().GetString("card-ids")
			if cardID == 0 && strings.TrimSpace(cardIDs) == "" {
				return fmt.Errorf("either --card-id or --card-ids is required")
			}
			if cardID != 0 && cardIDs != "" {
				return fmt.Errorf("specify only one of --card-id or --card-ids")
			}
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()
			ids := []int64{}
			if cardID != 0 {
				ids = append(ids, cardID)
			} else {
				parsed, err := parseCardIDs(cardIDs)
				if err != nil {
					return err
				}
				ids = parsed
			}
			for _, id := range ids {
				if err := st.DeleteCard(deckID, id); err != nil {
					return err
				}
				fmt.Printf("Deleted card %d from deck id %d\n", id, deckID)
			}
			return nil
		},
	}
	addDeckFlags(del)
	del.Flags().Int64("card-id", 0, "Card id")
	del.Flags().String("card-ids", "", "Comma-separated card ids or ranges")

	update := &cobra.Command{
		Use:   "update",
		Short: "Update card",
		RunE: func(cmd *cobra.Command, args []string) error {
			deckID, err := resolveDeckID(cmd)
			if err != nil {
				return err
			}
			cardID, _ := cmd.Flags().GetInt64("card-id")
			if cardID == 0 {
				return fmt.Errorf("--card-id is required")
			}
			question, _ := cmd.Flags().GetString("question")
			answer, _ := cmd.Flags().GetString("answer")
			extra, _ := cmd.Flags().GetString("extra")
			choices, _ := cmd.Flags().GetStringSlice("choice")
			correct, _ := cmd.Flags().GetInt("correct-index")
			tags, _ := cmd.Flags().GetStringSlice("tag")
			u := store.CardUpdate{}
			if cmd.Flags().Changed("question") {
				u.Question = &question
			}
			if cmd.Flags().Changed("answer") {
				u.Answer = &answer
			}
			if cmd.Flags().Changed("extra") {
				u.Extra = &extra
			}
			if cmd.Flags().Changed("correct-index") {
				u.CorrectIndex = &correct
			}
			if cmd.Flags().Changed("choice") {
				u.Choices = &choices
			}
			if cmd.Flags().Changed("tag") {
				u.Tags = &tags
			}
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()
			if err := st.UpdateCard(deckID, cardID, u); err != nil {
				return err
			}
			fmt.Printf("Updated card %d\n", cardID)
			return nil
		},
	}
	addDeckFlags(update)
	update.Flags().Int64("card-id", 0, "Card id")
	update.Flags().String("question", "", "Question")
	update.Flags().String("answer", "", "Answer")
	update.Flags().String("extra", "", "Extra")
	update.Flags().StringSlice("choice", nil, "Choices")
	update.Flags().Int("correct-index", 0, "Correct index")
	update.Flags().StringSlice("tag", nil, "Tags")

	cmd.AddCommand(list, add, show, del, update)
	return cmd
}

// --- review ---

func reviewCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "review [deck]",
		Short: "Start review session",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			skillName, _ := cmd.Flags().GetString("skill")
			if skillName != "" {
				return runSkillReview(cmd, skillName)
			}
			return runReviewSession(cmd, args)
		},
	}
	cmd.Flags().StringP("mode", "m", "auto", "Review mode (flashcard, mcq, auto)")
	cmd.Flags().IntP("limit", "l", 200, "Max cards")
	cmd.Flags().String("deck", "", "Deck name to review")
	cmd.Flags().String("skill", "", "Review all cards for a skill")
	return cmd
}

func runSkillReview(cmd *cobra.Command, skillName string) error {
	limit, _ := cmd.Flags().GetInt("limit")
	modeRaw, _ := cmd.Flags().GetString("mode")
	mode := parseModeWithFallback(modeRaw)

	st, err := openStore()
	if err != nil {
		return err
	}
	defer st.Close()

	// Find skill by name
	tree, err := st.SkillTree()
	if err != nil {
		return err
	}
	skill := findSkillByName(tree, skillName)
	if skill == nil {
		return fmt.Errorf("skill %q not found", skillName)
	}

	cards, err := st.CardsForSkill(skill.ID, limit)
	if err != nil {
		return err
	}
	if len(cards) == 0 {
		fmt.Println("No cards found for skill.")
		return nil
	}

	deck := store.Deck{ID: -1, Name: skillName + " (all)", CardCount: len(cards)}
	decks := []store.Deck{deck}
	cardsByDeck := map[int64][]store.Card{-1: cards}

	model := tui.NewReviewModel(decks, cardsByDeck, 0, mode, true)
	_, err = tea.NewProgram(model, tea.WithAltScreen()).Run()
	return err
}

func runReviewSession(cmd *cobra.Command, args []string) error {
	limit, _ := cmd.Flags().GetInt("limit")
	modeRaw, _ := cmd.Flags().GetString("mode")
	mode := parseModeWithFallback(modeRaw)

	deckQuery := ""
	flagDeck, _ := cmd.Flags().GetString("deck")
	deckQuery = strings.TrimSpace(flagDeck)
	if len(args) > 0 {
		if deckQuery != "" {
			return fmt.Errorf("specify either positional [deck] or --deck, not both")
		}
		deckQuery = strings.TrimSpace(args[0])
	}

	st, err := openStore()
	if err != nil {
		return err
	}
	defer st.Close()

	decks, err := st.ListDecks()
	if err != nil {
		return err
	}

	cardsByDeck := make(map[int64][]store.Card, len(decks))
	for _, deck := range decks {
		cards, err := st.ListCards(deck.ID, limit)
		if err != nil {
			return err
		}
		cardsByDeck[deck.ID] = cards
	}

	selectedIndex := 0
	startInReview := false
	if deckQuery != "" {
		for i, deck := range decks {
			if strings.EqualFold(deck.Name, deckQuery) {
				selectedIndex = i
				startInReview = true
				break
			}
		}
	}

	model := tui.NewReviewModel(decks, cardsByDeck, selectedIndex, mode, startInReview)
	_, err = tea.NewProgram(model, tea.WithAltScreen()).Run()
	return err
}

// --- tree ---

func treeCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "tree",
		Short: "Interactive skill tree TUI",
		RunE: func(cmd *cobra.Command, args []string) error {
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()

			skills, err := st.SkillTree()
			if err != nil {
				return err
			}

			allDecks, err := st.ListDecks()
			if err != nil {
				return err
			}

			cardsByDeck := make(map[int64][]store.Card, len(allDecks))
			for _, deck := range allDecks {
				cards, err := st.ListCards(deck.ID, 200)
				if err != nil {
					return err
				}
				cardsByDeck[deck.ID] = cards
			}

			model := tui.NewAppModel(skills, allDecks, cardsByDeck)
			_, err = tea.NewProgram(model, tea.WithAltScreen()).Run()
			return err
		},
	}
}

// --- import ---

func importCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "import",
		Short: "Import data from quiz CLI",
		RunE: func(cmd *cobra.Command, args []string) error {
			fromQuiz, _ := cmd.Flags().GetBool("from-quiz")
			if !fromQuiz {
				return fmt.Errorf("--from-quiz is required")
			}
			quizDBPath, err := sqliteutil.DBPath("quiz", "quiz.db")
			if err != nil {
				return err
			}
			st, err := openStore()
			if err != nil {
				return err
			}
			defer st.Close()
			decks, cards, err := st.ImportFromQuiz(quizDBPath)
			if err != nil {
				return err
			}
			fmt.Printf("Imported %d decks with %d cards from %s\n", decks, cards, quizDBPath)
			return nil
		},
	}
	cmd.Flags().Bool("from-quiz", false, "Import from quiz CLI database")
	return cmd
}

// --- helpers ---

func openStore() (*store.Store, error) {
	st, _, err := store.Open()
	return st, err
}

func addDeckFlags(cmd *cobra.Command) {
	cmd.Flags().Int64("deck-id", 0, "Deck id")
	cmd.Flags().String("deck-name", "", "Deck name")
}

func resolveDeckID(cmd *cobra.Command) (int64, error) {
	deckID, _ := cmd.Flags().GetInt64("deck-id")
	deckName, _ := cmd.Flags().GetString("deck-name")
	if deckID != 0 {
		return deckID, nil
	}
	if deckName == "" {
		return 0, fmt.Errorf("either --deck-id or --deck-name is required")
	}
	st, err := openStore()
	if err != nil {
		return 0, err
	}
	defer st.Close()
	deck, err := st.GetDeckByName(deckName)
	if err != nil {
		return 0, err
	}
	return deck.ID, nil
}

func readPayload(data, file string) ([]byte, error) {
	if data != "" && file != "" {
		return nil, fmt.Errorf("specify only one of --data or --file")
	}
	if data != "" {
		return []byte(data), nil
	}
	if file == "" {
		return nil, fmt.Errorf("missing input payload")
	}
	payload, err := os.ReadFile(file)
	if err != nil {
		return nil, fmt.Errorf("unable to read file: %w", err)
	}
	return payload, nil
}

func parseCardIDs(raw string) ([]int64, error) {
	out := []int64{}
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if strings.Contains(part, "-") {
			bounds := strings.SplitN(part, "-", 2)
			start, err := strconv.Atoi(strings.TrimSpace(bounds[0]))
			if err != nil {
				return nil, fmt.Errorf("invalid card id range %q", part)
			}
			end, err := strconv.Atoi(strings.TrimSpace(bounds[1]))
			if err != nil {
				return nil, fmt.Errorf("invalid card id range %q", part)
			}
			if end < start {
				return nil, fmt.Errorf("invalid card id range %q", part)
			}
			for i := start; i <= end; i++ {
				out = append(out, int64(i))
			}
			continue
		}
		id, err := strconv.Atoi(part)
		if err != nil {
			return nil, fmt.Errorf("invalid card id %q", part)
		}
		out = append(out, int64(id))
	}
	return out, nil
}

type rawCardInput struct {
	Question          string   `json:"question"`
	Answer            string   `json:"answer"`
	Extra             string   `json:"extra"`
	Choices           []string `json:"choices"`
	CorrectIndexSnake *int     `json:"correct_index"`
	CorrectIndexCamel *int     `json:"correctIndex"`
	Tags              []string `json:"tags"`
}

type deckPayload struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Cards       []rawCardInput `json:"cards"`
}

func parseDeckPayload(payload []byte) (*deckPayload, error) {
	var in deckPayload
	if err := json.Unmarshal(payload, &in); err != nil {
		return nil, err
	}
	return &in, nil
}

func parseCardsPayload(payload []byte) ([]store.Card, error) {
	var raw []rawCardInput
	if err := json.Unmarshal(payload, &raw); err != nil {
		return nil, err
	}
	cards := make([]store.Card, 0, len(raw))
	for idx, item := range raw {
		card, err := normalizeCard(item)
		if err != nil {
			return nil, fmt.Errorf("card %d: %w", idx+1, err)
		}
		cards = append(cards, card)
	}
	return cards, nil
}

func normalizeCard(in rawCardInput) (store.Card, error) {
	if strings.TrimSpace(in.Question) == "" {
		return store.Card{}, fmt.Errorf("question is required")
	}
	if strings.TrimSpace(in.Answer) == "" {
		return store.Card{}, fmt.Errorf("answer is required")
	}
	correct := in.CorrectIndexSnake
	if in.CorrectIndexCamel != nil {
		correct = in.CorrectIndexCamel
	}
	if len(in.Choices) == 0 {
		correct = nil
	}
	if correct != nil {
		if *correct < 0 || *correct >= len(in.Choices) {
			return store.Card{}, fmt.Errorf("correct index out of range")
		}
	}
	if correct == nil && len(in.Choices) > 0 {
		def := 0
		correct = &def
	}
	return store.Card{
		Question:     in.Question,
		Answer:       in.Answer,
		Extra:        in.Extra,
		Choices:      in.Choices,
		CorrectIndex: correct,
		Tags:         in.Tags,
	}, nil
}

func parseModeWithFallback(raw string) tui.ReviewMode {
	mode, err := tui.ParseMode(raw)
	if err != nil {
		return tui.ModeAuto
	}
	return mode
}

func formatUpdatedAt(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return value
	}
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05",
		"2006-01-02 15:04:05Z07:00",
		"2006-01-02T15:04:05",
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, value); err == nil {
			return t.UTC().Format("2006-01-02 15:04")
		}
	}
	if len(value) >= 16 {
		value = strings.Replace(value, "T", " ", 1)
		return value[:16]
	}
	return value
}

func printSkillTree(skills []store.Skill, depth int) {
	for _, s := range skills {
		indent := strings.Repeat("  ", depth)
		bar := levelBar(s.Level)
		fmt.Printf("%s%s %s %d/5 %s\n", indent, s.Name, bar, s.Level, levelLabel(s.Level))
		if len(s.Children) > 0 {
			printSkillTree(s.Children, depth+1)
		}
	}
}

func levelBar(level int) string {
	filled := level
	empty := 5 - level
	return strings.Repeat("█", filled) + strings.Repeat("░", empty)
}

func levelLabel(level int) string {
	labels := []string{"Unexplored", "Awareness", "Guided", "Independent", "Proficient", "Expert"}
	if level < 0 || level >= len(labels) {
		return ""
	}
	return labels[level]
}

func findSkillByName(skills []store.Skill, name string) *store.Skill {
	for i := range skills {
		if strings.EqualFold(skills[i].Name, name) {
			return &skills[i]
		}
		if found := findSkillByName(skills[i].Children, name); found != nil {
			return found
		}
	}
	return nil
}
