import * as Diff from "diff";

export interface DiffSection {
  title: string;
  type: "added" | "removed" | "modified" | "unchanged";
  content: string;
  diff_html: string;
}

export interface DiffResult {
  hasChange: boolean;
  diffHTML: string;
  addedCount: number;
  removedCount: number;
  sections: DiffSection[];
}

export function computeDiff(prevText: string, newText: string): DiffResult {
  if (!prevText) {
    // Initial baseline snapshot
    return {
      hasChange: false,
      diffHTML: `<div class="diff-line diff-add">${escapeHtml(newText)}</div>`,
      addedCount: newText.split("\n").filter((l) => l.trim() !== "").length,
      removedCount: 0,
      sections: [
        {
          title: "Initial Content",
          type: "unchanged",
          content: newText,
          diff_html: escapeHtml(newText),
        },
      ],
    };
  }

  const changes = Diff.diffLines(prevText, newText);
  let addedCount = 0;
  let removedCount = 0;
  let hasChange = false;
  const htmlParts: string[] = [];

  for (const part of changes) {
    const lines = part.value
      .split("\n")
      .filter((line: string, idx: number, arr: string[]) => idx < arr.length - 1 || part.value.endsWith("\n") || line !== "");
    
    if (part.added) {
      hasChange = true;
      addedCount += lines.length;
      for (const line of lines) {
        htmlParts.push(`<div class="diff-line diff-add">+ ${escapeHtml(line)}</div>`);
      }
    } else if (part.removed) {
      hasChange = true;
      removedCount += lines.length;
      for (const line of lines) {
        htmlParts.push(`<div class="diff-line diff-del">- ${escapeHtml(line)}</div>`);
      }
    } else {
      for (const line of lines) {
        htmlParts.push(`<div class="diff-line diff-ctx">  ${escapeHtml(line)}</div>`);
      }
    }
  }

  const sections: DiffSection[] = [
    {
      title: hasChange ? "Detected Updates" : "Page Content",
      type: hasChange ? "modified" : "unchanged",
      content: newText,
      diff_html: htmlParts.join("\n"),
    },
  ];

  return {
    hasChange,
    diffHTML: htmlParts.join("\n"),
    addedCount,
    removedCount,
    sections,
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
