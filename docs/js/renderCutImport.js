// Excelからコピーしたカット一覧(タブ区切り)を読み取る。値の正規化(選択肢の
// 丸め・フレームの数値化)は api.js の sanitizeRenderCut が行う。

const COLUMNS = [
  'cutNumber',
  'renderable',
  'reason',
  'priority',
  'assignee',
  'dueDate',
  'status',
  'config',
  'startFrame',
  'endFrame',
  'cameraName',
  'scenePath',
];

// Excelはセル内に改行やタブを含むセルを "…" で囲み、" は "" にして出力する。
function splitTsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let atCellStart = true;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && atCellStart) {
      inQuotes = true;
      atCellStart = false;
    } else if (ch === '\t') {
      row.push(cell);
      cell = '';
      atCellStart = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      atCellStart = true;
    } else {
      cell += ch;
      atCellStart = false;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function toIsoDate(value) {
  const m = String(value).trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!m) return '';
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

function isHeaderOrBlank(firstCell) {
  const v = firstCell.trim();
  return !v || v === 'カット番号' || v.includes('レンダリング状況');
}

export function parseRenderCutPaste(text) {
  const byNumber = new Map();
  for (const cells of splitTsv(String(text || ''))) {
    if (isHeaderOrBlank(cells[0] || '')) continue;
    const cut = {};
    COLUMNS.forEach((key, i) => {
      cut[key] = (cells[i] ?? '').trim();
    });
    cut.dueDate = toIsoDate(cut.dueDate);
    cut.scenePath = cut.scenePath.replace(/^"+|"+$/g, '');
    // Mapは再セット時に元の位置を保つので、重複は後の行の値・最初の位置になる
    byNumber.set(cut.cutNumber, cut);
  }
  return [...byNumber.values()];
}
