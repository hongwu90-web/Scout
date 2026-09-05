package monitor

import (
	"fmt"
	"html"
	"strings"

	"github.com/0x2E/fusion/internal/model"
	"github.com/sergi/go-diff/diffmatchpatch"
)

type DiffResult struct {
	DiffHTML     string
	AddedCount   int
	RemovedCount int
	HasChange    bool
	Sections     []model.SectionChange
}

type SectionBlock struct {
	Title string
	Body  string
}

func parseSections(text string) []SectionBlock {
	if text == "" {
		return nil
	}
	lines := strings.Split(text, "\n")
	var sections []SectionBlock
	currTitle := "General Content"
	var currBodyLines []string

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "## ") {
			if len(currBodyLines) > 0 || (currTitle != "General Content" && len(sections) > 0) {
				sections = append(sections, SectionBlock{
					Title: currTitle,
					Body:  strings.TrimSpace(strings.Join(currBodyLines, "\n")),
				})
			}
			currTitle = strings.TrimSpace(strings.TrimPrefix(trimmed, "## "))
			currBodyLines = nil
		} else if trimmed != "" {
			currBodyLines = append(currBodyLines, trimmed)
		}
	}

	if len(currBodyLines) > 0 || len(sections) == 0 {
		sections = append(sections, SectionBlock{
			Title: currTitle,
			Body:  strings.TrimSpace(strings.Join(currBodyLines, "\n")),
		})
	}

	return sections
}

func ComputeDiff(oldText, newText string) *DiffResult {
	if oldText == "" {
		newSections := parseSections(newText)
		var sectionChanges []model.SectionChange
		totalAdded := 0

		for _, sec := range newSections {
			words := len(strings.Fields(sec.Body))
			totalAdded += words
			escaped := html.EscapeString(sec.Body)
			sectionChanges = append(sectionChanges, model.SectionChange{
				SectionTitle: sec.Title,
				ChangeType:   "added",
				NewText:      sec.Body,
				DiffHTML:     fmt.Sprintf("<ins class=\"diff-ins bg-emerald-100 text-emerald-950 px-1 py-0.5 rounded font-medium underline decoration-emerald-500 block\">%s</ins>", escaped),
				AddedCount:   words,
				RemovedCount: 0,
			})
		}

		return &DiffResult{
			DiffHTML:     fmt.Sprintf("<ins class=\"diff-ins\">%s</ins>", html.EscapeString(newText)),
			AddedCount:   totalAdded,
			RemovedCount: 0,
			HasChange:    true,
			Sections:     sectionChanges,
		}
	}

	dmp := diffmatchpatch.New()
	dmp.DiffTimeout = 0

	oldSections := parseSections(oldText)
	newSections := parseSections(newText)

	oldSecMap := make(map[string]SectionBlock)
	for _, sec := range oldSections {
		oldSecMap[sec.Title] = sec
	}

	newSecMap := make(map[string]bool)
	var sectionChanges []model.SectionChange
	totalAdded := 0
	totalRemoved := 0

	// 1. Process new & modified sections
	for _, newSec := range newSections {
		newSecMap[newSec.Title] = true
		oldSec, exists := oldSecMap[newSec.Title]

		if !exists {
			// Brand new section added
			words := len(strings.Fields(newSec.Body))
			totalAdded += words
			escaped := html.EscapeString(newSec.Body)
			sectionChanges = append(sectionChanges, model.SectionChange{
				SectionTitle: newSec.Title,
				ChangeType:   "added",
				NewText:      newSec.Body,
				DiffHTML:     fmt.Sprintf("<ins class=\"diff-ins bg-emerald-100 text-emerald-950 px-1 py-0.5 rounded font-medium underline decoration-emerald-500 block\">%s</ins>", escaped),
				AddedCount:   words,
				RemovedCount: 0,
			})
		} else if oldSec.Body != newSec.Body {
			// Section content modified
			w1, w2, lineArray := dmp.DiffLinesToRunes(oldSec.Body, newSec.Body)
			diffs := dmp.DiffMainRunes(w1, w2, false)
			diffs = dmp.DiffCharsToLines(diffs, lineArray)
			diffs = dmp.DiffCleanupSemantic(diffs)

			var secHTML strings.Builder
			var oldParts, newParts []string
			secAdded, secRemoved := 0, 0
			hasSecDiff := false

			for _, diff := range diffs {
				escaped := html.EscapeString(diff.Text)
				switch diff.Type {
				case diffmatchpatch.DiffInsert:
					hasSecDiff = true
					secAdded += len(strings.Fields(diff.Text))
					newParts = append(newParts, diff.Text)
					secHTML.WriteString(fmt.Sprintf("<ins class=\"diff-ins bg-emerald-100 text-emerald-950 px-1 py-0.5 rounded font-bold underline decoration-emerald-500\">%s</ins>", escaped))
				case diffmatchpatch.DiffDelete:
					hasSecDiff = true
					secRemoved += len(strings.Fields(diff.Text))
					oldParts = append(oldParts, diff.Text)
					secHTML.WriteString(fmt.Sprintf("<del class=\"diff-del bg-rose-100 text-rose-950 px-1 py-0.5 rounded line-through decoration-rose-500 opacity-80\">%s</del>", escaped))
				case diffmatchpatch.DiffEqual:
					secHTML.WriteString(escaped)
				}
			}

			if hasSecDiff {
				totalAdded += secAdded
				totalRemoved += secRemoved
				sectionChanges = append(sectionChanges, model.SectionChange{
					SectionTitle: newSec.Title,
					ChangeType:   "modified",
					OldText:      strings.TrimSpace(strings.Join(oldParts, " ")),
					NewText:      strings.TrimSpace(strings.Join(newParts, " ")),
					DiffHTML:     secHTML.String(),
					AddedCount:   secAdded,
					RemovedCount: secRemoved,
				})
			}
		}
	}

	// 2. Check for removed sections
	for _, oldSec := range oldSections {
		if !newSecMap[oldSec.Title] {
			words := len(strings.Fields(oldSec.Body))
			totalRemoved += words
			escaped := html.EscapeString(oldSec.Body)
			sectionChanges = append(sectionChanges, model.SectionChange{
				SectionTitle: oldSec.Title,
				ChangeType:   "removed",
				OldText:      oldSec.Body,
				DiffHTML:     fmt.Sprintf("<del class=\"diff-del bg-rose-100 text-rose-950 px-1 py-0.5 rounded line-through decoration-rose-500 opacity-80 block\">%s</del>", escaped),
				AddedCount:   0,
				RemovedCount: words,
			})
		}
	}

	// 3. Compute overall full unified diff HTML
	w1, w2, lineArray := dmp.DiffLinesToRunes(oldText, newText)
	diffs := dmp.DiffMainRunes(w1, w2, false)
	diffs = dmp.DiffCharsToLines(diffs, lineArray)
	diffs = dmp.DiffCleanupSemantic(diffs)

	var sb strings.Builder
	for _, diff := range diffs {
		escaped := html.EscapeString(diff.Text)
		switch diff.Type {
		case diffmatchpatch.DiffInsert:
			sb.WriteString(fmt.Sprintf("<ins class=\"diff-ins bg-emerald-100 text-emerald-950 px-1 py-0.5 rounded font-bold underline decoration-emerald-500\">%s</ins>", escaped))
		case diffmatchpatch.DiffDelete:
			sb.WriteString(fmt.Sprintf("<del class=\"diff-del bg-rose-100 text-rose-950 px-1 py-0.5 rounded line-through decoration-rose-500 opacity-80\">%s</del>", escaped))
		case diffmatchpatch.DiffEqual:
			sb.WriteString(escaped)
		}
	}

	return &DiffResult{
		DiffHTML:     sb.String(),
		AddedCount:   totalAdded,
		RemovedCount: totalRemoved,
		HasChange:    len(sectionChanges) > 0 || totalAdded > 0 || totalRemoved > 0,
		Sections:     sectionChanges,
	}
}
