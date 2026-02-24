package tui

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/raulsaavedra/skill-builder/internal/store"
)

// LevelLabel returns the human-readable label for a skill level (0-5).
func LevelLabel(level int) string {
	level = store.ClampLevel(level)
	return levelLabels[level]
}

// LevelBar returns the 5-char visual bar for a skill level (plain text, no color).
func LevelBar(level int) string {
	level = store.ClampLevel(level)
	return strings.Repeat("█", level) + strings.Repeat("░", 5-level)
}

// Level labels indexed by skill level 0-5.
var levelLabels = []string{
	"Unaware",
	"Novice",
	"Beginner",
	"Intermediate",
	"Advanced",
	"Elite",
}

// Level descriptions indexed by skill level 0-5.
var levelDescriptions = []string{
	"Haven't touched it",
	"Know the concept exists, can describe it",
	"Can do with docs/guidance open",
	"Can do solo without reference",
	"Confident, could teach others",
	"Deep understanding, can debug edge cases",
}

// Level bar colors indexed by skill level 0-5.
var levelColors = []string{
	"8",  // dim
	"15", // white
	"12", // blue
	"14", // cyan
	"10", // green
	"11", // yellow
}

// Scenario status icons.
var statusIcons = map[string]string{
	"planned":     "○",
	"in_progress": "◉",
	"completed":   "✓",
	"abandoned":   "✗",
}

// --- Tree model ---

type treeStage int

const (
	stageTree treeStage = iota
	stageSkillDetail
	stageLevelHelp
)

type flatNode struct {
	skill store.Skill
	depth int
}

type detailSection struct {
	name      string
	level     int
	deckStart int // index into detailDecks
	deckCount int
	scenarios []store.Scenario
}

// TreeModel manages the skill tree navigation and detail views.
type TreeModel struct {
	skills    []store.Skill
	flatNodes []flatNode
	cursor    int
	expanded  map[int64]bool
	selected  *store.Skill
	stage     treeStage
	prevStage treeStage // for returning from level help
	width     int
	err       error

	// For launching review from detail view.
	allDecks    []store.Deck
	cardsByDeck map[int64][]store.Card

	// Skill detail state.
	detailCursor    int
	detailDecks     []store.Deck
	detailSections  []detailSection // groups decks/scenarios by skill
	detailScenarios []store.Scenario
}

// NewTreeModel creates a TreeModel from the full skill tree.
func NewTreeModel(skills []store.Skill, allDecks []store.Deck, cardsByDeck map[int64][]store.Card) TreeModel {
	m := TreeModel{
		skills:      skills,
		expanded:    make(map[int64]bool),
		stage:       stageTree,
		allDecks:    allDecks,
		cardsByDeck: cardsByDeck,
	}
	m.rebuildFlatNodes()
	return m
}

func (m *TreeModel) rebuildFlatNodes() {
	m.flatNodes = m.flatNodes[:0]
	for i := range m.skills {
		m.walkTree(&m.skills[i], 0)
	}
}

func (m *TreeModel) walkTree(skill *store.Skill, depth int) {
	m.flatNodes = append(m.flatNodes, flatNode{skill: *skill, depth: depth})
	if m.expanded[skill.ID] {
		for i := range skill.Children {
			m.walkTree(&skill.Children[i], depth+1)
		}
	}
}

func (m TreeModel) Init() tea.Cmd { return nil }

func (m TreeModel) Update(msg tea.Msg) (TreeModel, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		return m, nil
	case tea.KeyMsg:
		switch m.stage {
		case stageTree:
			return m.updateTree(msg)
		case stageSkillDetail:
			return m.updateDetail(msg)
		case stageLevelHelp:
			return m.updateLevelHelp(msg)
		}
	}
	return m, nil
}

func (m TreeModel) View() string {
	if m.err != nil {
		return "Error: " + m.err.Error()
	}
	switch m.stage {
	case stageSkillDetail:
		return m.renderDetail()
	case stageLevelHelp:
		return m.renderLevelHelp()
	default:
		return m.renderTree()
	}
}

// --- Tree navigation ---

func (m TreeModel) updateTree(msg tea.KeyMsg) (TreeModel, tea.Cmd) {
	switch msg.String() {
	case "q", "ctrl+c":
		return m, tea.Quit
	case "up", "k":
		if m.cursor > 0 {
			m.cursor--
		}
	case "down", "j":
		if m.cursor < len(m.flatNodes)-1 {
			m.cursor++
		}
	case "enter", " ":
		if m.cursor >= 0 && m.cursor < len(m.flatNodes) {
			node := m.flatNodes[m.cursor]
			if len(node.skill.Children) > 0 {
				m.expanded[node.skill.ID] = !m.expanded[node.skill.ID]
				m.rebuildFlatNodes()
				if m.cursor >= len(m.flatNodes) {
					m.cursor = len(m.flatNodes) - 1
				}
			} else {
				// Leaf node: open detail.
				skill := node.skill
				m.selected = &skill
				m.stage = stageSkillDetail
				m.detailCursor = 0
				m.loadDetailData(skill)
			}
		}
	case "d":
		if m.cursor >= 0 && m.cursor < len(m.flatNodes) {
			skill := m.flatNodes[m.cursor].skill
			m.selected = &skill
			m.stage = stageSkillDetail
			m.detailCursor = 0
			m.loadDetailData(skill)
		}
	case "?":
		m.prevStage = stageTree
		m.stage = stageLevelHelp
	}
	return m, nil
}

func (m *TreeModel) loadDetailData(skill store.Skill) {
	m.detailDecks = nil
	m.detailSections = nil
	m.detailScenarios = nil

	// Add the skill's own decks/scenarios if any.
	if len(skill.Decks) > 0 || len(skill.Scenarios) > 0 {
		sec := detailSection{
			name:      skill.Name,
			level:     skill.Level,
			deckStart: len(m.detailDecks),
			deckCount: len(skill.Decks),
			scenarios: skill.Scenarios,
		}
		m.detailDecks = append(m.detailDecks, skill.Decks...)
		m.detailScenarios = append(m.detailScenarios, skill.Scenarios...)
		m.detailSections = append(m.detailSections, sec)
	}

	// Add children's decks/scenarios as subsections.
	for _, child := range skill.Children {
		if len(child.Decks) == 0 && len(child.Scenarios) == 0 {
			continue
		}
		sec := detailSection{
			name:      child.Name,
			level:     child.Level,
			deckStart: len(m.detailDecks),
			deckCount: len(child.Decks),
			scenarios: child.Scenarios,
		}
		m.detailDecks = append(m.detailDecks, child.Decks...)
		m.detailScenarios = append(m.detailScenarios, child.Scenarios...)
		m.detailSections = append(m.detailSections, sec)
	}
}

// --- Skill detail navigation ---

func (m TreeModel) updateDetail(msg tea.KeyMsg) (TreeModel, tea.Cmd) {
	switch msg.String() {
	case "q", "ctrl+c":
		return m, tea.Quit
	case "b", "esc":
		m.stage = stageTree
		m.selected = nil
	case "up", "k":
		if m.detailCursor > 0 {
			m.detailCursor--
		}
	case "down", "j":
		if m.detailCursor < len(m.detailDecks)-1 {
			m.detailCursor++
		}
	case "r":
		// handled by AppModel — returns with detail state intact
	case "?":
		m.prevStage = stageSkillDetail
		m.stage = stageLevelHelp
	}
	return m, nil
}

// WantsReview returns the deck the user wants to review (pressed 'r' in detail).
func (m TreeModel) WantsReview() bool {
	return m.stage == stageSkillDetail && len(m.detailDecks) > 0
}

// SelectedDetailDecks returns the decks for the currently selected skill.
func (m TreeModel) SelectedDetailDecks() []store.Deck {
	return m.detailDecks
}

// DetailCursor returns the current cursor position in the detail deck list.
func (m TreeModel) DetailCursor() int {
	return m.detailCursor
}

// --- Tree rendering ---

func (m TreeModel) renderTree() string {
	title := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("14")).Render("Skill Tree")
	lines := []string{title, ""}

	if len(m.flatNodes) == 0 {
		lines = append(lines, "No skills found.")
		lines = append(lines, "Use the CLI to add skills to your tree.")
		lines = append(lines, "")
		lines = append(lines, lipgloss.NewStyle().Faint(true).Render("q Quit"))
		return renderWithHorizontalPadding(lines, m.width)
	}

	for i, node := range m.flatNodes {
		line := m.renderTreeNode(i, node)
		lines = append(lines, line)
	}

	lines = append(lines, "")
	lines = append(lines, lipgloss.NewStyle().Faint(true).Render("j/k Navigate  enter Expand/Collapse  d Detail  ? Levels  q Quit"))
	return renderWithHorizontalPadding(lines, m.width)
}

func (m TreeModel) renderTreeNode(index int, node flatNode) string {
	indent := strings.Repeat("  ", node.depth)

	// Node prefix based on children and expanded state.
	prefix := "─ "
	if len(node.skill.Children) > 0 {
		if m.expanded[node.skill.ID] {
			prefix = "▼ "
		} else {
			prefix = "▶ "
		}
	}

	// Cursor indicator.
	cursor := "  "
	if index == m.cursor {
		cursor = "> "
	}

	// Level bar and label.
	level := store.ClampLevel(node.skill.Level)
	bar := renderLevelBar(level)
	label := levelLabels[level]

	// Count decks and scenarios for leaf info.
	info := leafInfo(node.skill)

	// Build the line.
	nameStyle := lipgloss.NewStyle()
	if index == m.cursor {
		nameStyle = nameStyle.Foreground(lipgloss.Color("13")).Bold(true)
	}
	name := nameStyle.Render(node.skill.Name)

	levelText := lipgloss.NewStyle().Foreground(lipgloss.Color(levelColors[level])).Render(
		fmt.Sprintf("%s %d/5 %s", bar, level, label),
	)

	line := fmt.Sprintf("%s%s%s%s", cursor, indent, prefix, name)

	// Pad to align level bars.
	padded := padRight(line, 40)
	result := padded + "  " + levelText
	if info != "" {
		result += "   " + lipgloss.NewStyle().Faint(true).Render(info)
	}

	return result
}

func renderLevelBar(level int) string {
	const barWidth = 5
	filled := level
	empty := barWidth - filled
	color := levelColors[level]
	bar := lipgloss.NewStyle().Foreground(lipgloss.Color(color)).Render(strings.Repeat("█", filled))
	bar += lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Render(strings.Repeat("░", empty))
	return bar
}

func leafInfo(skill store.Skill) string {
	deckCount := len(skill.Decks)
	scenarioCount := len(skill.Scenarios)
	if deckCount == 0 && scenarioCount == 0 {
		return ""
	}
	parts := []string{}
	if deckCount > 0 {
		noun := "deck"
		if deckCount > 1 {
			noun = "decks"
		}
		parts = append(parts, fmt.Sprintf("%d %s", deckCount, noun))
	}
	if scenarioCount > 0 {
		noun := "scenario"
		if scenarioCount > 1 {
			noun = "scenarios"
		}
		parts = append(parts, fmt.Sprintf("%d %s", scenarioCount, noun))
	}
	return "[" + strings.Join(parts, " · ") + "]"
}

func padRight(s string, width int) string {
	// Use rune count for visible width approximation (ignores ANSI escapes).
	// For styled strings this won't be exact, but gives reasonable alignment.
	visible := lipgloss.Width(s)
	if visible >= width {
		return s
	}
	return s + strings.Repeat(" ", width-visible)
}

// --- Level help ---

func (m TreeModel) updateLevelHelp(msg tea.KeyMsg) (TreeModel, tea.Cmd) {
	switch msg.String() {
	case "q", "ctrl+c":
		return m, tea.Quit
	case "b", "esc", "?":
		m.stage = m.prevStage
	}
	return m, nil
}

func (m TreeModel) renderLevelHelp() string {
	title := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("14")).Render("Skill Levels")
	lines := []string{title, ""}

	for i := 0; i < len(levelLabels); i++ {
		bar := renderLevelBar(i)
		label := lipgloss.NewStyle().Foreground(lipgloss.Color(levelColors[i])).Bold(true).Render(
			fmt.Sprintf("%-12s", levelLabels[i]),
		)
		desc := lipgloss.NewStyle().Faint(true).Render(levelDescriptions[i])
		lines = append(lines, fmt.Sprintf("  %d  %s  %s  %s", i, bar, label, desc))
	}

	lines = append(lines, "")
	lines = append(lines, lipgloss.NewStyle().Faint(true).Render("b Back  q Quit"))
	return renderWithHorizontalPadding(lines, m.width)
}

// --- Detail rendering ---

func (m TreeModel) renderDetail() string {
	if m.selected == nil {
		return renderWithHorizontalPadding([]string{"No skill selected."}, m.width)
	}

	skill := m.selected
	level := store.ClampLevel(skill.Level)

	// Header.
	nameStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("14"))
	levelStyle := lipgloss.NewStyle().Foreground(lipgloss.Color(levelColors[level]))
	bar := renderLevelBar(level)
	header := nameStyle.Render(skill.Name) + "    " +
		levelStyle.Render(fmt.Sprintf("%s %d/5 %s", bar, level, levelLabels[level]))

	lines := []string{header}
	if skill.Description != "" {
		lines = append(lines, lipgloss.NewStyle().Faint(true).Render(skill.Description))
	}

	hasChildren := len(skill.Children) > 0

	if len(m.detailDecks) == 0 && len(m.detailScenarios) == 0 {
		lines = append(lines, "")
		lines = append(lines, "  No decks or scenarios linked.")
	} else if !hasChildren {
		// Leaf skill: flat rendering, no section headers.
		lines = append(lines, "")
		if len(m.detailDecks) > 0 {
			lines = append(lines, lipgloss.NewStyle().Bold(true).Render("Decks"))
			for i, d := range m.detailDecks {
				prefix := "    "
				style := lipgloss.NewStyle()
				if i == m.detailCursor {
					prefix = "  > "
					style = style.Foreground(lipgloss.Color("13")).Bold(true)
				}
				cardInfo := lipgloss.NewStyle().Faint(true).Render(fmt.Sprintf("%d cards", d.CardCount))
				lines = append(lines, style.Render(prefix+d.Name)+"  "+cardInfo)
			}
		}
		if len(m.detailScenarios) > 0 {
			lines = append(lines, "")
			lines = append(lines, lipgloss.NewStyle().Bold(true).Render("Scenarios"))
			for _, s := range m.detailScenarios {
				icon := statusIcons[s.Status]
				if icon == "" {
					icon = "○"
				}
				lines = append(lines, fmt.Sprintf("  %s %s", icon, s.Name))
			}
		}
	} else {
		// Parent skill: sectioned rendering by child.
		sectionStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("14"))
		for _, sec := range m.detailSections {
			lines = append(lines, "")
			secLevel := store.ClampLevel(sec.level)
			secBar := renderLevelBar(secLevel)
			secHeader := sectionStyle.Render(sec.name) + "  " +
				lipgloss.NewStyle().Foreground(lipgloss.Color(levelColors[secLevel])).Render(
					fmt.Sprintf("%s %d/5 %s", secBar, secLevel, levelLabels[secLevel]),
				)
			lines = append(lines, secHeader)

			// Decks subsection (only if present).
			if sec.deckCount > 0 {
				lines = append(lines, lipgloss.NewStyle().Faint(true).Render("  Decks:"))
				for i := sec.deckStart; i < sec.deckStart+sec.deckCount; i++ {
					d := m.detailDecks[i]
					prefix := "      "
					style := lipgloss.NewStyle()
					if i == m.detailCursor {
						prefix = "    > "
						style = style.Foreground(lipgloss.Color("13")).Bold(true)
					}
					cardInfo := lipgloss.NewStyle().Faint(true).Render(fmt.Sprintf("%d cards", d.CardCount))
					lines = append(lines, style.Render(prefix+d.Name)+"  "+cardInfo)
				}
			}

			// Scenarios subsection (only if present).
			if len(sec.scenarios) > 0 {
				lines = append(lines, lipgloss.NewStyle().Faint(true).Render("  Scenarios:"))
				for _, s := range sec.scenarios {
					icon := statusIcons[s.Status]
					if icon == "" {
						icon = "○"
					}
					lines = append(lines, fmt.Sprintf("    %s %s", icon, s.Name))
				}
			}
		}
	}
	lines = append(lines, "")

	// Help.
	help := "j/k Navigate  r Review deck  ? Levels  b Back  q Quit"
	lines = append(lines, lipgloss.NewStyle().Faint(true).Render(help))
	return renderWithHorizontalPadding(lines, m.width)
}

// --- App composition ---

type appStage int

const (
	appTree appStage = iota
	appReview
)

// AppModel composes the tree and review sub-models.
type AppModel struct {
	tree   TreeModel
	review ReviewModel
	active appStage
	width  int
}

// NewAppModel creates the top-level app model.
func NewAppModel(skills []store.Skill, allDecks []store.Deck, cardsByDeck map[int64][]store.Card) AppModel {
	return AppModel{
		tree:   NewTreeModel(skills, allDecks, cardsByDeck),
		active: appTree,
	}
}

// Init satisfies the tea.Model interface.
func (m AppModel) Init() tea.Cmd { return nil }

// Update delegates to the active sub-model.
func (m AppModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.tree.width = msg.Width
		m.review.width = msg.Width
		return m, nil
	case tea.KeyMsg:
		switch m.active {
		case appTree:
			return m.updateTree(msg)
		case appReview:
			return m.updateReview(msg)
		}
	}
	return m, nil
}

func (m AppModel) updateTree(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	// Check for 'r' in detail view to launch review.
	if msg.String() == "r" && m.tree.stage == stageSkillDetail && len(m.tree.detailDecks) > 0 {
		decks := m.tree.detailDecks
		cardsByDeck := make(map[int64][]store.Card)
		for _, d := range decks {
			cardsByDeck[d.ID] = m.tree.cardsByDeck[d.ID]
		}
		m.review = NewReviewModel(decks, cardsByDeck, m.tree.detailCursor, ModeAuto, true)
		m.review.width = m.width
		m.active = appReview
		return m, nil
	}

	var cmd tea.Cmd
	m.tree, cmd = m.tree.Update(msg)
	return m, cmd
}

func (m AppModel) updateReview(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	updated, cmd := m.review.Update(msg)
	m.review = updated.(ReviewModel)
	if m.review.Done() {
		m.active = appTree
		// Stay in skill detail so the user returns to context.
	}
	return m, cmd
}

// View delegates to the active sub-model.
func (m AppModel) View() string {
	switch m.active {
	case appReview:
		return m.review.View()
	default:
		return m.tree.View()
	}
}
