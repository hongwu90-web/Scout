import DOMPurify from "dompurify";
import { formatDate } from "@/lib/utils";
import type { Item } from "@/lib/api";

export function printSelectedArticles(
  articles: Item[],
  getFeedName: (feedId: number) => string,
) {
  if (articles.length === 0) return;

  const articlesHtml = articles
    .map((item) => {
      const source = getFeedName(item.feed_id);
      const date = formatDate(item.pub_date);
      const cleanContent = DOMPurify.sanitize(item.content || "", {
        FORBID_TAGS: ["script", "iframe", "object", "embed"],
      });

      return `
        <article class="print-article">
          <header class="print-header">
            <div class="print-meta">[ ${source.toUpperCase()} ] &bull; ${date}</div>
            <h1 class="print-title">${item.title}</h1>
            <div class="print-link">Source: <a href="${item.link}">${item.link}</a></div>
          </header>
          <div class="print-content">
            ${cleanContent}
          </div>
        </article>
      `;
    })
    .join('<div class="page-break"></div>');

  const htmlDocument = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Scout - Print ${articles.length} Article${articles.length === 1 ? "" : "s"}</title>
    <style>
      @media print {
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; padding: 24px; line-height: 1.6; }
        .print-article { margin-bottom: 40px; }
        .print-meta { font-family: monospace; font-size: 11px; text-transform: uppercase; color: #666; margin-bottom: 6px; }
        .print-title { font-size: 22px; font-weight: bold; margin: 0 0 8px 0; line-height: 1.3; }
        .print-link { font-size: 11px; font-family: monospace; color: #555; margin-bottom: 16px; word-break: break-all; }
        .print-content { font-size: 14px; color: #222; }
        .print-content img { max-width: 100%; height: auto; margin: 12px 0; }
        .print-content a { color: #111; text-decoration: underline; }
        .page-break { page-break-after: always; break-after: page; }
      }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; padding: 24px; line-height: 1.6; max-width: 800px; margin: 0 auto; }
      .print-article { margin-bottom: 40px; }
      .print-meta { font-family: monospace; font-size: 11px; text-transform: uppercase; color: #666; margin-bottom: 6px; }
      .print-title { font-size: 22px; font-weight: bold; margin: 0 0 8px 0; line-height: 1.3; }
      .print-link { font-size: 11px; font-family: monospace; color: #555; margin-bottom: 16px; word-break: break-all; }
      .print-content { font-size: 14px; color: #222; }
      .print-content img { max-width: 100%; height: auto; margin: 12px 0; }
      .page-break { border-top: 1px dashed #ccc; margin: 30px 0; }
    </style>
  </head>
  <body>
    ${articlesHtml}
  </body>
</html>`;

  // 1. Native macOS WebKit shell bridge (direct NSPrintOperation with PDF export)
  if (typeof window !== "undefined" && (window as any).webkit?.messageHandlers?.printHtml) {
    (window as any).webkit.messageHandlers.printHtml.postMessage(htmlDocument);
    return;
  }

  // 2. Browser popup print fallback
  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write(htmlDocument);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 250);
    return;
  }

  // 3. Fallback to iframe
  const printFrame = document.createElement("iframe");
  printFrame.style.position = "fixed";
  printFrame.style.right = "0";
  printFrame.style.bottom = "0";
  printFrame.style.width = "0";
  printFrame.style.height = "0";
  printFrame.style.border = "0";

  document.body.appendChild(printFrame);

  const doc = printFrame.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(printFrame);
    window.print();
    return;
  }

  doc.open();
  doc.write(htmlDocument);
  doc.close();

  setTimeout(() => {
    printFrame.contentWindow?.focus();
    printFrame.contentWindow?.print();
    setTimeout(() => {
      document.body.removeChild(printFrame);
    }, 1000);
  }, 300);
}
