import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

turndown.addRule('strikethrough', {
  filter: ['del', 's', 'strike'] as unknown as TurndownService.Filter,
  replacement: (content) => `~~${content}~~`,
});

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html).trim();
}

export function documentToMarkdown(doc: Document = document): string {
  const clone = doc.cloneNode(true) as Document;
  const article = new Readability(clone).parse();
  if (article?.content) {
    const title = article.title ? `# ${article.title}\n\n` : '';
    return `${title}${htmlToMarkdown(article.content)}`;
  }
  return htmlToMarkdown(doc.body.innerHTML);
}

export function selectionToMarkdown(selection: Selection | null = window.getSelection()): string {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return '';
  }
  const container = document.createElement('div');
  for (let i = 0; i < selection.rangeCount; i += 1) {
    container.appendChild(selection.getRangeAt(i).cloneContents());
  }
  return htmlToMarkdown(container.innerHTML);
}

export type TableMatrix = string[][];

export function extractTables(root: ParentNode = document): TableMatrix[] {
  return Array.from(root.querySelectorAll('table')).map(tableToMatrix);
}

function tableToMatrix(table: HTMLTableElement): TableMatrix {
  const rows = Array.from(table.rows);
  return rows.map((row) =>
    Array.from(row.cells).map((cell) => normalizeCellText(cell.textContent ?? '')),
  );
}

function normalizeCellText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
