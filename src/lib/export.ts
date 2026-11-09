import 'server-only';
import ExcelJS from 'exceljs';

export type Col = { header: string; key: string; width?: number; numFmt?: string };

function csvCell(v: unknown) {
  if (v == null) return '';
  let s = String(v);
  // neutralise spreadsheet formula injection
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(cols: Col[], rows: Record<string, unknown>[]) {
  return [cols.map((c) => csvCell(c.header)).join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c.key])).join(','))].join('\r\n');
}

export async function toXlsx(sheet: string, cols: Col[], rows: Record<string, unknown>[], title?: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Heritage Housekeepers Operations Hub';
  const ws = wb.addWorksheet(sheet);
  if (title) {
    ws.addRow([title]).font = { bold: true, size: 13 };
    ws.addRow([]);
  }
  const header = ws.addRow(cols.map((c) => c.header));
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF44583B' } }; });
  rows.forEach((r) => ws.addRow(cols.map((c) => r[c.key] ?? '')));
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? Math.max(12, c.header.length + 2);
    if (c.numFmt) col.numFmt = c.numFmt;
  });
  ws.views = [{ state: 'frozen', ySplit: title ? 3 : 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function fileResponse(body: string | Buffer, filename: string, format: 'csv' | 'xlsx') {
  return new Response(body as any, {
    headers: {
      'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}.${format}"`,
      'Cache-Control': 'no-store',
    },
  });
}
