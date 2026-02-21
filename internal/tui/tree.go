package tui

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/raulsaavedra/skill-builder/internal/store"
)

// Level labels indexed by skill level 0-5.
var levelLabels = []string{
	"Unexplored",
	"Awareness",
	"Guided",
	"Independent",
	"Proficient",
	"Expert",
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
)

type flatNode struct {
	skill store.Skill
	depth int
}

// TreeModel manages the skill tree navigation and detail views.
type TreeModel struct {
	skills    []store.Skill
	flatNodes []flatNode
	cursor    int
	expanded  map[int64]bool
	selected  *store.Skill
	stage     treeStage
	width     int
	err       error

	// For launching review from detail view.
	allDecks    []store.Deck
	cardsByDeck map[int64][]store.Card

	// Skill detail state.
	detailCursor    int
	detailDecks     []store.Deck
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
	}
	return m, nil
}

func (m *TreeModel) loadDetailData(skill store.Skill) {
	m.detailDecks = skill.Decks
	m.detailScenarios = skill.Scenarios
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
	lines = append(lines, lipgloss.NewStyle().Faint(true).Render("j/k Navigate  enter Expand/Collapse  d Detail  q Quit"))
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
	level := node.skill.Level
	if level < 0 {
		level = 0
	}
	if level > 5 {
		level = 5
	}
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

// --- Detail rendering ---

func (m TreeModel) renderDetail() string {
	if m.selected == nil {
		return renderWithHorizontalPadding([]string{"No skill selected."}, m.width)
	}

	skill := m.selected
	level := skill.Level
	if level < 0 {
		level = 0
	}
	if level > 5 {
		level = 5
	}

	// Header.
	nameStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("14"))
	levelStyle := lipgloss.NewStyle().Foreground(lipgloss.Color(levelColors[level]))
	header := nameStyle.Render(skill.Name) + "    " +
		levelStyle.Render(fmt.Sprintf("Level: %d/5 %s", level, levelLabels[level]))

	lines := []string{header}
	if skill.Description != "" {
		lines = append(lines, lipgloss.NewStyle().Faint(true).Render(skill.Description))
	}
	lines = append(lines, "")

	// Decks section.
	lines = append(lines, lipgloss.NewStyle().Bold(true).Render("Decks"))
	if len(m.detailDecks) == 0 {
		lines = append(lines, "  No decks linked to this skill.")
	} else {
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
	lines = append(lines, "")

	// Scenarios section.
	lines = append(lines, lipgloss.NewStyle().Bold(true).Render("Scenarios"))
	if len(m.detailScenarios) == 0 {
		lines = append(lines, "  No scenarios linked to this skill.")
	} else {
		for _, s := range m.detailScenarios {
			icon := statusIcons[s.Status]
			if icon == "" {
				icon = "○"
			}
			lines = append(lines, fmt.Sprintf("    %s %s", icon, s.Name))
		}
	}
	lines = append(lines, "")

	// Help.
	help := "r Review deck  b Back  q Quit"
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
