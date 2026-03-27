import { google } from 'googleapis';
import fs from 'fs';
import { mkdirSync } from 'fs';
import path from 'path';
import logger from '../utils/logger.js';

const CLIENT_SECRET_PATH = './google-oauth-client.json';
const TOKEN_PATH = './google-token.json';
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const DB_PATH = './data/trading.db';

function getAuthClient() {
  const credentials = JSON.parse(fs.readFileSync(CLIENT_SECRET_PATH, 'utf8'));
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  oauth2Client.setCredentials(tokens);

  // 自動更新 token
  oauth2Client.on('tokens', (newTokens) => {
    const current = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...current, ...newTokens }, null, 2));
  });

  return oauth2Client;
}

export async function backupToDrive() {
  if (!FOLDER_ID) {
    logger.warn('GOOGLE_DRIVE_FOLDER_ID 未設定，跳過備份');
    return;
  }

  if (!fs.existsSync(CLIENT_SECRET_PATH)) {
    logger.warn(`找不到 OAuth 憑證檔案: ${CLIENT_SECRET_PATH}，跳過備份`);
    return;
  }

  if (!fs.existsSync(TOKEN_PATH)) {
    logger.warn(`找不到 Token 檔案: ${TOKEN_PATH}，請先執行 node auth-google.js 授權`);
    return;
  }

  if (!fs.existsSync(DB_PATH)) {
    logger.warn('找不到資料庫檔案，跳過備份');
    return;
  }

  try {
    logger.info('開始備份資料庫到 Google Drive...');

    const auth = getAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `trading-${timestamp}.db`;

    const response = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [FOLDER_ID],
      },
      media: {
        mimeType: 'application/octet-stream',
        body: fs.createReadStream(DB_PATH),
      },
      fields: 'id, name',
    });

    logger.success(`資料庫備份成功: ${response.data.name} (ID: ${response.data.id})`);

    await cleanOldBackups(drive);
  } catch (error) {
    logger.error('備份到 Google Drive 失敗:', error.message);
  }
}

export async function restoreFromDrive() {
  if (!FOLDER_ID) {
    logger.warn('GOOGLE_DRIVE_FOLDER_ID 未設定，跳過從 Google Drive 還原');
    return false;
  }

  if (!fs.existsSync(CLIENT_SECRET_PATH)) {
    logger.warn(`找不到 OAuth 憑證檔案: ${CLIENT_SECRET_PATH}，跳過還原`);
    return false;
  }

  if (!fs.existsSync(TOKEN_PATH)) {
    logger.warn(`找不到 Token 檔案: ${TOKEN_PATH}，請先執行 node auth-google.js 授權`);
    return false;
  }

  try {
    logger.info('找不到本地資料庫，嘗試從 Google Drive 還原最新備份...');

    const auth = getAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    // 找出資料夾內所有 trading-*.db 檔案，依建立時間降序排列
    const res = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and name contains 'trading-' and trashed = false`,
      orderBy: 'createdTime desc',
      pageSize: 1,
      fields: 'files(id, name, createdTime)',
    });

    const files = res.data.files || [];
    if (files.length === 0) {
      logger.warn('Google Drive 上找不到任何備份檔案');
      return false;
    }

    const latest = files[0];
    logger.info(`找到最新備份: ${latest.name} (${latest.createdTime})`);

    // 確保 data 目錄存在
    mkdirSync(path.dirname(DB_PATH), { recursive: true });

    // 下載到本地
    const dest = fs.createWriteStream(DB_PATH);
    const fileRes = await drive.files.get(
      { fileId: latest.id, alt: 'media' },
      { responseType: 'stream' }
    );

    await new Promise((resolve, reject) => {
      fileRes.data
        .on('error', reject)
        .pipe(dest)
        .on('finish', resolve)
        .on('error', reject);
    });

    logger.info(`資料庫還原成功: ${DB_PATH}`);
    return true;
  } catch (error) {
    logger.error('從 Google Drive 還原失敗:', error.message);
    return false;
  }
}

async function cleanOldBackups(drive) {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoff = sevenDaysAgo.toISOString();

    const res = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and name contains 'trading-' and createdTime < '${cutoff}'`,
      fields: 'files(id, name)',
    });

    const oldFiles = res.data.files || [];
    for (const file of oldFiles) {
      await drive.files.delete({ fileId: file.id });
      logger.info(`已刪除舊備份: ${file.name}`);
    }

    if (oldFiles.length > 0) {
      logger.info(`清理完成，共刪除 ${oldFiles.length} 個舊備份`);
    }
  } catch (error) {
    logger.warn('清理舊備份失敗:', error.message);
  }
}
