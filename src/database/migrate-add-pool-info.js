import Database from 'better-sqlite3';
import config from '../config/config.js';
import logger from '../utils/logger.js';

const dbPath = config.database.path;
const db = new Database(dbPath);

/**
 * 遷移腳本：為 tokens 表添加池子信息欄位
 */
function migrateAddPoolInfo() {
  try {
    logger.info('開始遷移：添加池子信息欄位...');

    // 檢查欄位是否已存在
    const tableInfo = db.prepare("PRAGMA table_info(tokens)").all();
    const columns = tableInfo.map(col => col.name);

    const columnsToAdd = [
      { name: 'pool_address', type: 'TEXT', exists: columns.includes('pool_address') },
      { name: 'pool_protocol', type: 'TEXT', exists: columns.includes('pool_protocol') },
      { name: 'pool_version', type: 'TEXT', exists: columns.includes('pool_version') },
      { name: 'pool_pair_token', type: 'TEXT', exists: columns.includes('pool_pair_token') },
    ];

    let migrated = false;

    for (const col of columnsToAdd) {
      if (!col.exists) {
        logger.info(`添加欄位: ${col.name}`);
        db.exec(`ALTER TABLE tokens ADD COLUMN ${col.name} ${col.type}`);
        migrated = true;
      } else {
        logger.info(`欄位已存在: ${col.name}`);
      }
    }

    if (migrated) {
      logger.info('✅ 遷移完成！池子信息欄位已添加');
    } else {
      logger.info('✅ 所有欄位已存在，無需遷移');
    }

    db.close();
  } catch (error) {
    logger.error('遷移失敗:', error);
    db.close();
    process.exit(1);
  }
}

// 執行遷移
migrateAddPoolInfo();
