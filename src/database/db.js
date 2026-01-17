import Database from 'better-sqlite3';
import config from '../config/config.js';

const db = new Database(config.database.path);
db.pragma('journal_mode = WAL');

export default db;
