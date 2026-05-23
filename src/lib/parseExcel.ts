import * as XLSX from 'xlsx';

export interface ExcelContent {
  texte: string;
  feuilles: string[];
}

function cellToStr(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toLocaleDateString('fr-FR');
  return String(cell).trim().replace(/[\r\n]+/g, ' ');
}

export async function parseExcel(file: File): Promise<ExcelContent> {
  const buffer = await file.arrayBuffer();
  const u8 = new Uint8Array(buffer);

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(u8, { type: 'array', cellDates: true });
  } catch {
    wb = XLSX.read(u8, { type: 'array' });
  }

  const feuilles = wb.SheetNames;
  const blocs: string[] = [];

  for (const nom of feuilles) {
    const ws = wb.Sheets[nom];
    if (!ws) continue;

    const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' }) as unknown[][];

    const lignes = data
      .filter(row => row.some(cell => cellToStr(cell) !== ''))
      .slice(0, 200)
      .map(row => {
        const cells = row.map(cellToStr);
        let last = cells.length - 1;
        while (last >= 0 && cells[last] === '') last--;
        return cells.slice(0, last + 1).join(' | ');
      })
      .filter(l => l.trim() !== '');

    if (lignes.length > 0) {
      blocs.push(`=== Feuille : ${nom} ===\n${lignes.join('\n')}`);
    }
  }

  return { texte: blocs.join('\n\n'), feuilles };
}
