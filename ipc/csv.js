// "Export this table to CSV" (right-click any table): asks where to save, then writes the file.
const { ipcMain, dialog, BrowserWindow, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { toCsv, csvFileName } = require('../shared/csv');

// { title, rows: [[cell text, ...], ...] }
ipcMain.handle('save-csv', async (event, input = {}) => {
  const rows = Array.isArray(input.rows) ? input.rows.filter(Array.isArray) : [];
  if (!rows.length) return { success: false, error: 'The table is empty.' };
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(win, {
    title: 'Export table to CSV',
    defaultPath: path.join(app.getPath('documents'), csvFileName(input.title)),
    filters: [{ name: 'CSV (Excel, Google Sheets)', extensions: ['csv'] }],
  });
  if (result.canceled || !result.filePath) return { success: true, canceled: true };
  try {
    fs.writeFileSync(result.filePath, toCsv(rows), 'utf8');
    return { success: true, filePath: result.filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
