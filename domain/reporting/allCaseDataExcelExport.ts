import JSZip from 'jszip';
import type { AllCaseDataColumn, AllCaseDataRow } from '../../services/allCaseDataReportService';

/**
 * Manors cleanup phase (Task #8, "All Case Data" report — Excel export).
 * No Excel library exists anywhere in this codebase yet (`package.json`
 * has no xlsx/exceljs), and this codebase's own established precedent
 * (`domain/reporting/csvExport.ts`'s header comment) is to hand-roll a
 * genuinely simple format rather than add a new dependency when one
 * already-installed primitive (here, `jszip` — already a dependency, used
 * by `services/documentService.ts`'s bulk-download ZIP) is enough. An
 * `.xlsx` file IS a zip of a handful of small, fixed XML parts
 * (OOXML/SpreadsheetML) — this writes exactly the minimal valid set: one
 * sheet, inline strings (no `sharedStrings.xml` needed), a bold header
 * row via one extra cell style, and per-column widths sized to content.
 * Produces a real, standards-conformant `.xlsx` — not a renamed CSV.
 */

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** 0 -> A, 1 -> B, ..., 25 -> Z, 26 -> AA, ... */
function columnLetter(index: number): string {
  let n = index;
  let letters = '';
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

function inlineStringCell(ref: string, value: string, styleIndex: number): string {
  return `<c r="${ref}" t="inlineStr"${styleIndex ? ` s="${styleIndex}"` : ''}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="All Case Data" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><sz val="11"/><name val="Calibri"/><b/></font>
  </fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
</styleSheet>`;

const MIN_COLUMN_WIDTH = 10;
const MAX_COLUMN_WIDTH = 40;

export async function buildAllCaseDataXlsx(rows: readonly AllCaseDataRow[], columns: readonly AllCaseDataColumn[]): Promise<Buffer> {
  const widths = columns.map((col) => {
    const longest = rows.reduce((max, row) => Math.max(max, col.value(row).length), col.header.length);
    return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, longest + 2));
  });

  const colsXml = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`;

  const headerRow = `<row r="1">${columns.map((col, i) => inlineStringCell(`${columnLetter(i)}1`, col.header, 1)).join('')}</row>`;
  const dataRows = rows
    .map((row, rowIndex) => {
      const r = rowIndex + 2;
      const cells = columns.map((col, i) => inlineStringCell(`${columnLetter(i)}${r}`, col.value(row), 0)).join('');
      return `<row r="${r}">${cells}</row>`;
    })
    .join('');

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${colsXml}
  <sheetData>${headerRow}${dataRows}</sheetData>
</worksheet>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', ROOT_RELS);
  zip.file('xl/workbook.xml', WORKBOOK);
  zip.file('xl/_rels/workbook.xml.rels', WORKBOOK_RELS);
  zip.file('xl/styles.xml', STYLES);
  zip.file('xl/worksheets/sheet1.xml', sheet);

  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}
