package tui

import (
	"strings"
	"unicode/utf8"

	"github.com/charmbracelet/lipgloss"
)

const (
	defaultHorizontalPadding = 2
	minReadableContentWidth  = 32
)

func horizontalPadding(width int) int {
	if width <= 0 {
		return defaultHorizontalPadding
	}
	maxPad := (width - minReadableContentWidth) / 2
	if maxPad < 0 {
		return 0
	}
	if maxPad < defaultHorizontalPadding {
		return maxPad
	}
	return defaultHorizontalPadding
}

func renderWithHorizontalPadding(lines []string, width int) string {
	content := strings.Join(lines, "\n")
	pad := horizontalPadding(width)
	if pad <= 0 {
		return content
	}
	return lipgloss.NewStyle().Padding(0, pad).Render(content)
}

func renderMarkdown(text string, baseStyle lipgloss.Style) []string {
	if strings.TrimSpace(text) == "" {
		return []string{""}
	}
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	out := make([]string, 0, len(lines))
	inCode := false
	for _, line := range lines {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "```") {
			inCode = !inCode
			continue
		}
		if inCode {
			out = append(out, lipgloss.NewStyle().Faint(true).Render("  "+line))
			continue
		}
		prefix := ""
		content := line
		if list, ok := trimListMarker(line); ok {
			prefix = "• "
			content = list
		}
		rendered := renderInlineMarkdown(strings.TrimSpace(content), baseStyle)
		if prefix != "" {
			rendered = prefix + rendered
		}
		if strings.TrimSpace(rendered) == "" {
			out = append(out, "")
		} else {
			out = append(out, rendered)
		}
	}
	if len(out) == 0 {
		return []string{""}
	}
	return out
}

func trimListMarker(line string) (string, bool) {
	trim := strings.TrimLeft(line, " \t")
	if strings.HasPrefix(trim, "- ") || strings.HasPrefix(trim, "* ") {
		return strings.TrimSpace(trim[2:]), true
	}
	return line, false
}

func renderInlineMarkdown(text string, baseStyle lipgloss.Style) string {
	if text == "" {
		return ""
	}

	var b strings.Builder
	for len(text) > 0 {
		if strings.HasPrefix(text, "**") {
			if end := strings.Index(text[2:], "**"); end >= 0 {
				token := text[2 : 2+end]
				b.WriteString(baseStyle.Copy().Bold(true).Render(token))
				text = text[2+end+2:]
				continue
			}
		}
		if strings.HasPrefix(text, "*") && !strings.HasPrefix(text, "**") {
			if end := strings.Index(text[1:], "*"); end >= 0 {
				token := text[1 : 1+end]
				b.WriteString(baseStyle.Copy().Italic(true).Render(token))
				text = text[1+end+1:]
				continue
			}
		}
		if strings.HasPrefix(text, "`") {
			if end := strings.Index(text[1:], "`"); end >= 0 {
				token := text[1 : 1+end]
				b.WriteString(lipgloss.NewStyle().Foreground(lipgloss.Color("11")).Render(token))
				text = text[1+end+1:]
				continue
			}
		}
		r, size := utf8.DecodeRuneInString(text)
		b.WriteString(baseStyle.Render(string(r)))
		text = text[size:]
	}
	return b.String()
}
