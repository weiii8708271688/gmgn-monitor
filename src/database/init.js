import Database from 'better-sqlite3';
import config from '../config/config.js';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = config.database.path;

// 確保資料夾存在
try {
  mkdirSync(dirname(dbPath), { recursive: true });
} catch (err) {
  // 資料夾已存在
}

const db = new Database(dbPath);

// 建立資料表
function initDatabase() {
  console.log('初始化資料庫...');

  // 代幣資訊表
  db.exec(`
    CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chain TEXT NOT NULL,
      address TEXT NOT NULL,
      symbol TEXT NOT NULL,
      decimals INTEGER NOT NULL,
      pair_address TEXT,
      pool_address TEXT,
      pool_protocol TEXT,
      pool_version TEXT,
      pool_pair_token TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(chain, address)
    )
  `);

  // 掛單表
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      target_price REAL NOT NULL,
      current_price REAL,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      executed_at DATETIME,
      FOREIGN KEY (token_id) REFERENCES tokens(id)
    )
  `);

  // 價格提醒表
  db.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_id INTEGER NOT NULL,
      condition TEXT NOT NULL,
      target_price REAL NOT NULL,
      status TEXT DEFAULT 'active',
      alert_type TEXT DEFAULT 'price',
      unit TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      triggered_at DATETIME,
      FOREIGN KEY (token_id) REFERENCES tokens(id)
    )
  `);

  // 價格歷史表
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_id INTEGER NOT NULL,
      price REAL NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (token_id) REFERENCES tokens(id)
    )
  `);

  // 錢包餘額歷史表
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_balance_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_address TEXT NOT NULL,
      chain TEXT NOT NULL,
      balance REAL NOT NULL,
      balance_usd REAL,
      tokens_value_usd REAL,
      tokens_value_bnb REAL,
      total_balance_bnb REAL,
      holdings_count INTEGER DEFAULT 0,
      holdings_detail TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 為已有資料庫新增欄位（若不存在）
  const newColumns = [
    { name: 'tokens_value_usd', type: 'REAL' },
    { name: 'tokens_value_bnb', type: 'REAL' },
    { name: 'total_balance_bnb', type: 'REAL' },
    { name: 'holdings_count', type: 'INTEGER DEFAULT 0' },
    { name: 'holdings_detail', type: 'TEXT' },
  ];
  for (const col of newColumns) {
    try {
      db.exec(`ALTER TABLE wallet_balance_history ADD COLUMN ${col.name} ${col.type}`);
    } catch (e) {
      // 欄位已存在，忽略
    }
  }

  // 建立索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
    CREATE INDEX IF NOT EXISTS idx_price_history_token ON price_history(token_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_wallet_balance_history ON wallet_balance_history(wallet_address, timestamp);
  `);

  console.log('資料庫初始化完成！');
}

// 執行初始化
initDatabase();

db.close();
