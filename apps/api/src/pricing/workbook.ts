import ExcelJS from 'exceljs';

/**
 * Reading and writing the spreadsheets the pricing screens exchange.
 *
 * Kept apart from PricingService on purpose: this file knows about cells and
 * headers and nothing about prices, and PricingService knows about prices and
 * nothing about Excel. Everything here is pure — a buffer in, plain rows out,
 * or plain rows in, a buffer out — so it is testable without a database.
 */

/** A cell's text, whatever shape ExcelJS handed back. */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    // Rich text, hyperlinks and formulas all carry their readable value in a
    // different place; a plain String() on any of them yields "[object
    // Object]", which would silently become a product code that matches
    // nothing.
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText
        .map((part) => part.text)
        .join('')
        .trim();
    }
    if ('text' in value && typeof value.text === 'string')
      return value.text.trim();
    if ('result' in value) return cellText(value.result);
    // Anything else object-shaped — a formula with no cached result, an
    // error value, a shape a future ExcelJS adds — reads as empty rather
    // than as "[object Object]". A cell we cannot interpret has no text;
    // pretending it does would put that literal string into a product code
    // and match nothing, loudly and confusingly.
    return '';
  }
  return String(value).trim();
}

/**
 * Header text reduced to something two humans typing the same column would
 * agree on: no accents, no case, no punctuation, single spaces. "Cód.
 * Artículo" and "COD ARTICULO" both become "cod articulo".
 */
export function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * A product code as a matching key.
 *
 * Tango pads the variant part of `Cód. Artículo` with spaces — the real file
 * contains "0002/     0002" — so a naive comparison against a stored SKU
 * never matches. Every internal run of whitespace collapses to nothing and
 * the case is folded, which makes "0002/     0002", "0002/0002" and
 * "0002 / 0002" the same key.
 */
export function normalizeCode(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/**
 * A price cell as a decimal string, or null when it is not a number.
 *
 * Accepts both what Excel stores as a number and what a person may have
 * typed as text, including the es-AR "1.234,56". The ambiguity is real:
 * "1.234" is one thousand two hundred thirty-four in es-AR and one point
 * two three four in en-US. It is resolved by looking at which separator
 * comes last, which is the only reliable signal a lone string carries —
 * and it never applies to a genuine numeric cell, where Excel has already
 * told us the value.
 */
export function parseDecimal(value: ExcelJS.CellValue): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null;
  }
  const raw = cellText(value);
  if (!raw) return null;

  let text = raw.replace(/[^\d,.-]/g, '');
  if (!text) return null;

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    // Both present: the rightmost is the decimal separator, the other is
    // grouping.
    if (lastComma > lastDot) text = text.replace(/\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else if (lastComma !== -1) {
    // A lone comma is a decimal separator ("1234,56"), unless it is being
    // used for grouping in a value with exactly three trailing digits and
    // more than one group ("1,234,567").
    text =
      text.split(',').length > 2
        ? text.replace(/,/g, '')
        : text.replace(',', '.');
  }

  if (!/^-?\d*\.?\d+$/.test(text)) return null;
  const num = Number(text);
  if (!Number.isFinite(num)) return null;
  // Returned as a string, never a number: this feeds a Decimal column, and
  // the whole point of the money rules is that it never round-trips through
  // a float on the way (see AGENTS.md).
  return text;
}

export interface SheetTable {
  /** Normalized header -> zero-based column index. */
  columns: Map<string, number>;
  /** Data rows, excluding the header. `rowNumber` is the 1-based spreadsheet row. */
  rows: { rowNumber: number; cells: ExcelJS.CellValue[] }[];
}

/**
 * The first worksheet, read as a header row plus data rows.
 *
 * Columns are located by NAME, not by position, so a file with the columns
 * reordered or with extra ones alongside still imports. The header is
 * searched for in the first few rows rather than assumed to be row 1: real
 * exports often carry a title or a blank line above it.
 */
export async function readSheetTable(
  buffer: Buffer,
  requiredHeaders: string[],
  maxHeaderScanRows = 10,
): Promise<SheetTable | null> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return null;

  const wanted = new Set(requiredHeaders.map(normalizeHeader));

  let headerRowNumber = 0;
  let columns = new Map<string, number>();
  const scanLimit = Math.min(maxHeaderScanRows, sheet.rowCount);
  for (let r = 1; r <= scanLimit; r += 1) {
    const found = new Map<string, number>();
    const row = sheet.getRow(r);
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const key = normalizeHeader(cellText(cell.value));
      if (key && !found.has(key)) found.set(key, colNumber);
    });
    const hasAll = [...wanted].every((h) => found.has(h));
    if (hasAll) {
      headerRowNumber = r;
      columns = found;
      break;
    }
  }
  if (headerRowNumber === 0) return null;

  const rows: SheetTable['rows'] = [];
  for (let r = headerRowNumber + 1; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const cells: ExcelJS.CellValue[] = [];
    let empty = true;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cells[colNumber] = cell.value;
      if (cellText(cell.value) !== '') empty = false;
    });
    // Excel files routinely carry thousands of formatted-but-blank rows past
    // the data; counting them as failed matches would drown the real report.
    if (empty) continue;
    rows.push({ rowNumber: r, cells });
  }

  return { columns, rows };
}

export interface WorkbookColumn {
  header: string;
  width: number;
  /** Marks a column the importer reads back — rendered locked and greyed. */
  readOnly?: boolean;
  numeric?: boolean;
}

/**
 * Builds the price-edit workbook.
 *
 * The sheet is protected with an empty password and only the editable
 * columns are unlocked. That is a guard rail, not security — Excel's sheet
 * protection is trivially removed and is not meant to stop anyone. Its job
 * is to make the intended workflow obvious: the identifying columns are
 * what the importer matches on, and a file that comes back with them edited
 * cannot be applied.
 */
export async function buildWorkbook(params: {
  sheetName: string;
  columns: WorkbookColumn[];
  rows: (string | number | null)[][];
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ERP';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(params.sheetName, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = params.columns.map((c) => ({
    header: c.header,
    width: c.width,
  }));

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle' };

  for (const row of params.rows) sheet.addRow(row);

  params.columns.forEach((col, i) => {
    const column = sheet.getColumn(i + 1);
    if (col.numeric) column.numFmt = '#,##0.00';
    // Locked by default in a protected sheet, so only the editable ones need
    // saying — but both are set explicitly, because "the default" is exactly
    // the kind of thing that changes under you.
    column.eachCell({ includeEmpty: false }, (cell, rowNumber) => {
      if (rowNumber === 1) return;
      cell.protection = { locked: Boolean(col.readOnly) };
    });
  });

  await sheet.protect('', {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatColumns: true,
    formatRows: true,
  });

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}
