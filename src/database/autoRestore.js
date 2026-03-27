/**
 * 自動還原腳本 - 在主程式啟動前執行
 * 若 data/trading.db 不存在，自動從 Google Drive 下載最新備份
 */
import 'dotenv/config';
import fs from 'fs';
import { restoreFromDrive } from '../services/googleDriveBackup.js';

const DB_PATH = './data/trading.db';

if (fs.existsSync(DB_PATH)) {
  // 資料庫已存在，直接結束腳本，繼續啟動主程式
  process.exit(0);
}

console.log('[autoRestore] 找不到 data/trading.db，嘗試從 Google Drive 還原...');

try {
  const success = await restoreFromDrive();
  if (success) {
    console.log('[autoRestore] 還原成功，繼續啟動主程式');
  } else {
    console.log('[autoRestore] 無法從 Google Drive 還原，將以空白資料庫啟動');
  }
} catch (err) {
  console.error('[autoRestore] 還原過程發生錯誤:', err.message);
  console.log('[autoRestore] 將以空白資料庫啟動');
}

process.exit(0);
