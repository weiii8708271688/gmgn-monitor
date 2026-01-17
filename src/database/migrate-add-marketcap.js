import Database from 'better-sqlite3';
import config from '../config/config.js';

const db = new Database(config.database.path);

console.log('開始數據庫遷移：添加市值提醒支持...');

try {
  // 添加新字段
  db.exec(`
    ALTER TABLE alerts ADD COLUMN alert_type TEXT DEFAULT 'price';
  `);

  db.exec(`
    ALTER TABLE alerts ADD COLUMN unit TEXT DEFAULT '';
  `);

  console.log('✅ 成功添加 alert_type 和 unit 字段');
  console.log('✅ 數據庫遷移完成！');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('⚠️ 字段已存在，跳過遷移');
  } else {
    console.error('❌ 遷移失敗:', error.message);
    process.exit(1);
  }
}

db.close();
