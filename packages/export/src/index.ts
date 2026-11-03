export function rowsToCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
}

export function tablesToCsv(tables: string[][][], separator = '\n\n'): string {
  return tables.map(rowsToCsv).filter(Boolean).join(separator);
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function slugFilename(title: string, extension: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `${base || 'export'}.${extension}`;
}
