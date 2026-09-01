const STATUS_FILL = {
  未着手: 'FF9AA1AC',
  進行中: 'FF3B5BC4',
  完了: 'FF3F8B53',
};

const MILESTONE_FILL = 'FF6B5B95';
const TODAY_LINE_ARGB = 'FFB3413A';
const HEADER_FILL = 'FFEEF1F9';

function isoAddDays(iso, n) {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function isoDaysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

function todayIsoLocal() {
  const now = new Date();
  const tz = now.getTimezoneOffset() * 60000;
  return new Date(now - tz).toISOString().slice(0, 10);
}

function downloadWorkbook(workbook, filenamePrefix) {
  return workbook.xlsx.writeBuffer().then((buffer) => {
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filenamePrefix}_${todayIsoLocal().replace(/-/g, '')}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

function icsDate(iso) {
  return iso.replace(/-/g, '');
}

function icsDateTimeStamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
}

function icsEscape(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function foldLine(line) {
  if (line.length <= 70) return line;
  const parts = [];
  let rest = line;
  while (rest.length > 70) {
    parts.push(rest.slice(0, 70));
    rest = ` ${rest.slice(70)}`;
  }
  parts.push(rest);
  return parts.join('\r\n');
}

export function exportScheduleToIcs(tasks, milestones) {
  const validMilestones = milestones.filter((m) => m.date);
  const validTasks = tasks.filter((t) => t.endDate);
  if (validMilestones.length === 0 && validTasks.length === 0) {
    throw new Error('出力できるタスク・マイルストーンがありません。');
  }

  const stamp = icsDateTimeStamp();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//pm-app//schedule//JA', 'CALSCALE:GREGORIAN'];

  for (const ms of validMilestones) {
    lines.push('BEGIN:VEVENT');
    lines.push(foldLine(`UID:milestone-${ms.id}@pm-app`));
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${icsDate(ms.date)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDate(isoAddDays(ms.date, 1))}`);
    lines.push(foldLine(`SUMMARY:${icsEscape(ms.title)}`));
    lines.push('END:VEVENT');
  }

  for (const t of validTasks) {
    lines.push('BEGIN:VEVENT');
    lines.push(foldLine(`UID:task-${t.id}@pm-app`));
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${icsDate(t.endDate)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDate(isoAddDays(t.endDate, 1))}`);
    lines.push(foldLine(`SUMMARY:${icsEscape(`締切: ${t.title}`)}`));
    if (t.description) lines.push(foldLine(`DESCRIPTION:${icsEscape(t.description)}`));
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  const content = lines.join('\r\n');

  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `スケジュール_${todayIsoLocal().replace(/-/g, '')}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function exportGanttToExcel(tasks, milestones) {
  if (!window.ExcelJS) {
    throw new Error('Excel出力ライブラリの読み込みに失敗しました。通信環境を確認して再度お試しください。');
  }
  if (tasks.length === 0 && milestones.length === 0) {
    throw new Error('出力できるタスク・マイルストーンがありません。');
  }

  const validTasks = tasks.filter((t) => t.startDate && t.endDate);
  const allDates = [
    ...validTasks.flatMap((t) => [t.startDate, t.endDate]),
    ...milestones.map((m) => m.date).filter(Boolean),
    todayIsoLocal(),
  ];
  const minDate = allDates.reduce((a, b) => (a < b ? a : b));
  const maxDate = allDates.reduce((a, b) => (a > b ? a : b));
  const rangeStart = isoAddDays(minDate, -3);
  const rangeEnd = isoAddDays(maxDate, 3);
  const totalDays = isoDaysBetween(rangeStart, rangeEnd) + 1;
  const today = todayIsoLocal();

  const workbook = new window.ExcelJS.Workbook();
  workbook.creator = '卒業制作 チームページ';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('ガントチャート', {
    views: [{ state: 'frozen', xSplit: 5, ySplit: 2 }],
  });

  const LABEL_COLS = ['カテゴリ', 'タスク名', '担当役職', '状態', '進捗'];
  LABEL_COLS.forEach((label, i) => {
    const col = i + 1;
    sheet.mergeCells(1, col, 2, col);
    const cell = sheet.getCell(1, col);
    cell.value = label;
    cell.font = { bold: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  });
  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 28;
  sheet.getColumn(3).width = 14;
  sheet.getColumn(4).width = 10;
  sheet.getColumn(5).width = 8;

  const dateColStart = LABEL_COLS.length + 1;
  let monthStartCol = dateColStart;
  let currentMonthLabel = null;

  for (let i = 0; i < totalDays; i++) {
    const dateIso = isoAddDays(rangeStart, i);
    const d = new Date(dateIso);
    const col = dateColStart + i;
    const monthLabel = `${d.getFullYear()}/${d.getMonth() + 1}`;
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;

    const dayCell = sheet.getCell(2, col);
    dayCell.value = d.getDate();
    dayCell.alignment = { horizontal: 'center' };
    dayCell.font = { size: 9, color: { argb: isWeekend ? TODAY_LINE_ARGB : 'FF6B7280' } };
    dayCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: dateIso === today ? 'FFFBE7E5' : HEADER_FILL } };

    sheet.getColumn(col).width = 3.3;

    if (monthLabel !== currentMonthLabel) {
      if (currentMonthLabel !== null) {
        sheet.mergeCells(1, monthStartCol, 1, col - 1);
      }
      currentMonthLabel = monthLabel;
      monthStartCol = col;
      sheet.getCell(1, col).value = monthLabel;
    }
  }
  sheet.mergeCells(1, monthStartCol, 1, dateColStart + totalDays - 1);
  for (let c = dateColStart; c < dateColStart + totalDays; c++) {
    const cell = sheet.getCell(1, c);
    cell.alignment = { horizontal: 'center' };
    cell.font = { bold: true, size: 9 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  }

  const sortedTasks = validTasks
    .slice()
    .sort((a, b) => (a.category || '').localeCompare(b.category || '', 'ja') || a.startDate.localeCompare(b.startDate));

  let rowIndex = 3;
  for (const task of sortedTasks) {
    const row = sheet.getRow(rowIndex);
    row.getCell(1).value = task.category || '未分類';
    row.getCell(2).value = task.title;
    row.getCell(3).value = task.assigneeRole || '未割当';
    row.getCell(4).value = task.status;
    row.getCell(5).value = `${task.progress}%`;

    const startOffset = isoDaysBetween(rangeStart, task.startDate);
    const endOffset = isoDaysBetween(rangeStart, task.endDate);
    const fillArgb = STATUS_FILL[task.status] || STATUS_FILL['未着手'];
    for (let i = Math.max(startOffset, 0); i <= Math.min(endOffset, totalDays - 1); i++) {
      sheet.getCell(rowIndex, dateColStart + i).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: fillArgb },
      };
    }
    rowIndex += 1;
  }

  if (milestones.length > 0) {
    rowIndex += 1;
    const headerCell = sheet.getCell(rowIndex, 2);
    headerCell.value = 'マイルストーン';
    headerCell.font = { bold: true };
    rowIndex += 1;

    const sortedMilestones = milestones
      .filter((m) => m.date)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));

    for (const ms of sortedMilestones) {
      sheet.getCell(rowIndex, 1).value = ms.date;
      sheet.getCell(rowIndex, 2).value = ms.title;
      const offset = isoDaysBetween(rangeStart, ms.date);
      if (offset >= 0 && offset < totalDays) {
        sheet.getCell(rowIndex, dateColStart + offset).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: MILESTONE_FILL },
        };
      }
      rowIndex += 1;
    }
  }

  const taskSheet = workbook.addWorksheet('タスク一覧');
  taskSheet.columns = [
    { header: 'カテゴリ', key: 'category', width: 14 },
    { header: 'タスク名', key: 'title', width: 30 },
    { header: '説明', key: 'description', width: 30 },
    { header: '担当役職', key: 'assigneeRole', width: 16 },
    { header: '状態', key: 'status', width: 10 },
    { header: '進捗(%)', key: 'progress', width: 10 },
    { header: '開始日', key: 'startDate', width: 12 },
    { header: '終了日', key: 'endDate', width: 12 },
  ];
  taskSheet.getRow(1).font = { bold: true };
  for (const task of sortedTasks) {
    taskSheet.addRow({
      category: task.category || '未分類',
      title: task.title,
      description: task.description || '',
      assigneeRole: task.assigneeRole || '未割当',
      status: task.status,
      progress: task.progress,
      startDate: task.startDate,
      endDate: task.endDate,
    });
  }

  await downloadWorkbook(workbook, 'スケジュール');
}
