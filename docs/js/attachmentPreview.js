import { escapeHtml, formatFileSize } from './utils.js';

const PREVIEW_MAX_ROWS = 200;
const PREVIEW_MAX_COLS = 30;

function isImage(attachment) {
  return Boolean(attachment && (attachment.contentType || '').startsWith('image/'));
}

function isXlsx(attachment) {
  return Boolean(attachment && (attachment.fileName || '').toLowerCase().endsWith('.xlsx'));
}

function attachmentMeta(attachment) {
  const sizeLabel = formatFileSize(attachment.size);
  return `${escapeHtml(attachment.fileName)}${sizeLabel ? ` (${sizeLabel})` : ''}`;
}

// 添付ファイルの種類に応じた表示用HTMLを返す。画像はサムネイル、xlsxは
// プレビューボタン付きのリンク、それ以外は通常のダウンロードリンク。
export function attachmentPreviewHtml(attachment) {
  if (!attachment) return '';

  if (isImage(attachment)) {
    return `<a class="attachment-thumb-link" href="${escapeHtml(attachment.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(attachment.fileName)}">
      <img class="attachment-thumb" src="${escapeHtml(attachment.url)}" alt="${escapeHtml(attachment.fileName)}" loading="lazy" />
    </a>`;
  }

  if (isXlsx(attachment)) {
    return `<div class="attachment-line">
      <a class="link-external attachment-link" href="${escapeHtml(attachment.url)}" target="_blank" rel="noopener noreferrer">添付ファイル: ${attachmentMeta(attachment)}</a>
      <button type="button" class="btn btn-small" data-preview-xlsx-url="${escapeHtml(attachment.url)}" data-preview-xlsx-name="${escapeHtml(attachment.fileName)}">プレビュー</button>
    </div>`;
  }

  return `<a class="link-external attachment-link" href="${escapeHtml(attachment.url)}" target="_blank" rel="noopener noreferrer">添付ファイル: ${attachmentMeta(attachment)}</a>`;
}

// container内のxlsxプレビューボタンにクリックイベントを配線する。
// 各render関数の最後で呼び出す。
export function wireAttachmentPreviews(container) {
  container.querySelectorAll('[data-preview-xlsx-url]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openXlsxPreview(btn.dataset.previewXlsxUrl, btn.dataset.previewXlsxName);
    });
  });
}

async function openXlsxPreview(url, fileName) {
  const modalLayer = document.getElementById('modal-layer');
  if (!modalLayer) return;

  modalLayer.innerHTML = `
    <div class="overlay">
      <div class="modal modal-wide">
        <h3>${escapeHtml(fileName)}</h3>
        <div id="xlsx-preview-body"><p class="empty">読み込み中...</p></div>
        <div class="modal-actions">
          <span></span>
          <div><button type="button" class="btn" id="xlsx-preview-close">閉じる</button></div>
        </div>
      </div>
    </div>
  `;

  modalLayer.querySelector('#xlsx-preview-close').addEventListener('click', () => {
    modalLayer.innerHTML = '';
  });

  const body = modalLayer.querySelector('#xlsx-preview-body');
  try {
    if (!window.ExcelJS) {
      throw new Error('プレビュー用ライブラリの読み込みに失敗しました。通信環境を確認して再度お試しください。');
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error('ファイルの取得に失敗しました。');
    const buffer = await res.arrayBuffer();

    const workbook = new window.ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('シートが見つかりませんでした。');

    body.innerHTML = buildSheetTableHtml(sheet, workbook.worksheets.length);
  } catch (err) {
    body.innerHTML = `<p class="empty">プレビューに失敗しました: ${escapeHtml(err.message)}</p>`;
  }
}

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toLocaleDateString('ja-JP');
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((t) => t.text).join('');
    if (value.result !== undefined) return cellText(value.result);
    if (value.text !== undefined) return String(value.text);
    return '';
  }
  return String(value);
}

function buildSheetTableHtml(sheet, sheetCount) {
  const rowCount = Math.min(sheet.rowCount, PREVIEW_MAX_ROWS);
  const colCount = Math.min(sheet.columnCount, PREVIEW_MAX_COLS);

  let rowsHtml = '';
  for (let r = 1; r <= rowCount; r++) {
    const row = sheet.getRow(r);
    let cellsHtml = '';
    for (let c = 1; c <= colCount; c++) {
      cellsHtml += `<td>${escapeHtml(cellText(row.getCell(c).value))}</td>`;
    }
    rowsHtml += `<tr>${cellsHtml}</tr>`;
  }

  const truncatedNote =
    sheet.rowCount > PREVIEW_MAX_ROWS || sheet.columnCount > PREVIEW_MAX_COLS
      ? `<p class="empty">先頭${rowCount}行 × ${colCount}列のみ表示しています</p>`
      : '';
  const sheetNote =
    sheetCount > 1
      ? `<p class="empty">「${escapeHtml(sheet.name)}」シートを表示しています(他に${sheetCount - 1}シートあります)</p>`
      : '';

  return `
    ${sheetNote}
    <div class="table-scroll"><table class="data-table xlsx-preview-table"><tbody>${rowsHtml}</tbody></table></div>
    ${truncatedNote}
  `;
}
