import db from '../database/db.js';
import config from '../config/config.js';
import TelegramNotification from './notification/telegram.js';
import TelegramWebhookNotification from './notification/telegramWebhook.js';
import { toTaiwanString, getTaiwanTime, getTimeDifferenceInSeconds, formatTimeDifference, getTaiwanISOString } from '../utils/timeHelper.js';

const GMGN_API_URL = 'https://gmgn.ai/vas/api/v1/rank/bsc';

/**
 * 轉義 Markdown 特殊字符
 */
function escapeMarkdown(text) {
  if (text === null || text === undefined) {
    return '';
  }
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

// 監控狀態（預設開啟）
let isMonitoring = true;
let authToken = null;

// 根據配置選擇 Telegram 通知服務
// mode: 'bot' = 直接使用 Bot API, 'webhook' = 使用 Flask 服務器
const telegramNotification = config.telegram.mode === 'webhook'
  ? new TelegramWebhookNotification()
  : new TelegramNotification();

console.log(`GMGN 監控使用 Telegram 模式: ${config.telegram.mode}`);

// 獲取監控狀態
export function getMonitoringStatus() {
  return {
    isMonitoring,
    hasAuthToken: !!authToken
  };
}

// 設置監控狀態
export function setMonitoringStatus(status) {
  isMonitoring = status;
  console.log(`GMGN 監控已${status ? '啟動' : '停止'}`);
  return { success: true, isMonitoring };
}

// 設置 Auth Token
export function setAuthToken(token) {
  authToken = token;
  console.log('GMGN Auth Token 已設置');
  return { success: true };
}

// 初始化資料庫表
export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gmgn_monitored_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT NOT NULL UNIQUE,
      symbol TEXT,
      name TEXT,
      market_cap REAL,
      top_10_holder_rate REAL,
      liquidity REAL,
      holder_count INTEGER,
      launchpad TEXT,
      exchange TEXT,
      open_source TEXT,
      owner_renounced TEXT,
      is_honeypot TEXT,
      rug_ratio REAL,
      source TEXT DEFAULT 'completed',
      twitter_status_id TEXT,
      first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      data_snapshot TEXT
    )
  `);

  // 創建配置表存儲 auth token
  db.exec(`
    CREATE TABLE IF NOT EXISTS gmgn_config (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('GMGN 監控資料表已初始化');

  // 從資料庫加載 auth token
  loadAuthToken();
}

// 從資料庫加載 auth token
function loadAuthToken() {
  try {
    const stmt = db.prepare('SELECT value FROM gmgn_config WHERE key = ?');
    const result = stmt.get('auth_token');
    if (result) {
      authToken = result.value;
      console.log('已從資料庫加載 GMGN Auth Token');
    }
  } catch (error) {
    console.error('加載 Auth Token 失敗:', error.message);
  }
}

// 保存 auth token 到資料庫
function saveAuthToken(token) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO gmgn_config (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `);
  stmt.run('auth_token', token);
}

// 檢查地址是否已被監控，並返回 source 類型
function getTokenSource(address) {
  const stmt = db.prepare('SELECT source FROM gmgn_monitored_tokens WHERE address = ?');
  const result = stmt.get(address.toLowerCase());
  return result ? result.source : null;
}

// 檢查地址是否已被監控
function isAddressMonitored(address) {
  return getTokenSource(address) !== null;
}

// 檢查 Twitter 狀態 ID 是否已被監控
function isTwitterStatusMonitored(statusId) {
  if (!statusId) return false;
  const stmt = db.prepare('SELECT COUNT(*) as count FROM gmgn_monitored_tokens WHERE twitter_status_id = ?');
  const result = stmt.get(statusId);
  return result.count > 0;
}

// 從 Twitter 狀態 ID 提取時間戳並轉換為 Date
// Twitter Snowflake ID: ((id >> 22) + 1288834974657) / 1000 = Unix timestamp in seconds
function getTwitterTimestamp(statusId) {
  if (!statusId) return null;
  try {
    const id = BigInt(statusId);
    // Twitter epoch 開始時間: 2010-11-04 01:42:54.657 UTC
    const TWITTER_EPOCH = 1288834974657n;
    const timestamp = ((id >> 22n) + TWITTER_EPOCH);
    return new Date(Number(timestamp));
  } catch (error) {
    console.error('解析 Twitter 時間戳失敗:', error.message);
    return null;
  }
}

// 檢查 Twitter 帳號是否為指定的帳號 (czbinance 或 heyibinance)
function isTargetTwitterAccount(twitterHandle) {
  if (!twitterHandle) return false;
  const handle = twitterHandle.toLowerCase().trim();
  return handle === 'cz_binance' || handle === 'heyibinance';
}

// 檢查推文是否在指定秒數內 (預設 30 秒)
function isTweetRecent(statusId, maxAgeSeconds = 30) {
  const tweetTime = getTwitterTimestamp(statusId);
  if (!tweetTime) return false;

  const now = getTaiwanTime();
  const ageInSeconds = getTimeDifferenceInSeconds(tweetTime, now);

  console.log(`推文時間: ${toTaiwanString(tweetTime)}, 當前時間: ${toTaiwanString(now)}, 年齡: ${ageInSeconds}秒 (${formatTimeDifference(ageInSeconds)})`);

  return ageInSeconds <= maxAgeSeconds;
}

// 檢查 new_creation 代幣是否符合 SUB 條件
function isSubToken(token) {
  // 0. 檢查是否啟用推特監控
  if (!config.gmgn.enableTwitterMonitor) {
    return false;
  }

  // 1. 檢查是否有 Twitter 欄位
  if (!token.twitter) {
    return false;
  }

  // 2. 檢查 Twitter 帳號是否為目標帳號
  if (!isTargetTwitterAccount(token.twitter_handle)) {
    return false;
  }

  // 3. 提取狀態 ID
  let statusId = null;
  if (token.twitter.includes('/status/')) {
    const parts = token.twitter.split('/status/');
    if (parts.length > 1) {
      statusId = parts[1].split('?')[0];
    }
  }

  if (!statusId) {
    return false;
  }

  // 4. 檢查推文是否在 30 秒內
  if (!isTweetRecent(statusId, 30)) {
    return false;
  }

  return true;
}

// 添加監控地址
function addMonitoredAddress(tokenData, source = 'completed') {
  // 提取 Twitter 狀態 ID
  let twitterStatusId = null;
  if (tokenData.twitter && tokenData.twitter.includes('/status/')) {
    const parts = tokenData.twitter.split('/status/');
    if (parts.length > 1) {
      twitterStatusId = parts[1].split('?')[0]; // 移除任何查詢參數
    }
  }

  const stmt = db.prepare(`
    INSERT INTO gmgn_monitored_tokens (
      address, symbol, name, market_cap, top_10_holder_rate,
      liquidity, holder_count, launchpad, exchange,
      open_source, owner_renounced, is_honeypot, rug_ratio,
      source, twitter_status_id, data_snapshot
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    tokenData.address.toLowerCase(),
    tokenData.symbol,
    tokenData.name,
    tokenData.market_cap,
    tokenData.top_10_holder_rate,
    tokenData.liquidity,
    tokenData.holder_count,
    tokenData.launchpad,
    tokenData.exchange,
    tokenData.open_source,
    tokenData.owner_renounced,
    tokenData.is_honeypot,
    tokenData.rug_ratio,
    source,
    twitterStatusId,
    JSON.stringify(tokenData)
  );
}

// 更新代幣的 source (從 new_creation 升級到 completed)
function updateTokenSource(tokenData, 
  
) {
  const stmt = db.prepare(`
    UPDATE gmgn_monitored_tokens
    SET source = ?,
        symbol = ?,
        name = ?,
        market_cap = ?,
        top_10_holder_rate = ?,
        liquidity = ?,
        holder_count = ?,
        launchpad = ?,
        exchange = ?,
        open_source = ?,
        owner_renounced = ?,
        is_honeypot = ?,
        rug_ratio = ?,
        data_snapshot = ?
    WHERE address = ?
  `);

  stmt.run(
    newSource,
    tokenData.symbol,
    tokenData.name,
    tokenData.market_cap,
    tokenData.top_10_holder_rate,
    tokenData.liquidity,
    tokenData.holder_count,
    tokenData.launchpad,
    tokenData.exchange,
    tokenData.open_source,
    tokenData.owner_renounced,
    tokenData.is_honeypot,
    tokenData.rug_ratio,
    JSON.stringify(tokenData),
    tokenData.address.toLowerCase()
  );
}

// 檢查過濾條件
function shouldFilterToken(token) {
  // 過濾條件 1: top_10_holder_rate > 0.4
  if (token.top_10_holder_rate > 0.4) {
    console.log(`過濾代幣 ${token.symbol} (${token.address}): top_10_holder_rate=${token.top_10_holder_rate}`);
    return true;
  }

  // 過濾條件 2: entrapment_ratio > 0.4
  if (token.entrapment_ratio > 0.4) {
    console.log(`過濾代幣 ${token.symbol} (${token.address}): entrapment_ratio=${token.entrapment_ratio}`);
    return true;
  }

  // 過濾條件 3: rat_trader_amount_rate > 0.4
  if (token.rat_trader_amount_rate > 0.4) {
    console.log(`過濾代幣 ${token.symbol} (${token.address}): rat_trader_amount_rate=${token.rat_trader_amount_rate}`);
    return true;
  }

  // 過濾條件 4: holder_count < 150
  if (token.holder_count < 150) {
    console.log(`過濾代幣 ${token.symbol} (${token.address}): holder_count=${token.holder_count}`);
    return true;
  }

  // 可在此添加更多過濾條件
  // 例如: if (token.is_honeypot === 'yes') return true;
  // 例如: if (token.rug_ratio > 0.5) return true;

  return false;
}

// 格式化通知消息（簡化版）
function formatNotificationMessage(token, isSub = false) {
  const emoji = isSub ? '⭐' : '🚀';
  const title = isSub ? '新代幣 [SUB]' : '新代幣';

  let message = `${emoji} ${title}\n\n`;
  message += `${token.name} (${token.symbol})\n`;
  message += `${token.address}\n`;
  message += `市值: $${token.market_cap?.toLocaleString() || 'N/A'}`;

  return message;
}

// 調用 GMGN API
async function fetchGMGNData() {
  if (!authToken) {
    throw new Error('未設置 GMGN Auth Token');
  }

  const params = new URLSearchParams({
    device_id: 'f829d5a2-f18d-4e76-b67c-751aaca9e556',
    fp_did: 'ac2515382b84577aab6572d7d47d29fb',
    client_id: 'gmgn_web_20251101-6461-0986672',
    from_app: 'gmgn',
    app_ver: '20251101-6461-0986672',
    tz_name: 'Asia/Taipei',
    tz_offset: '28800',
    app_lang: 'zh-TW',
    os: 'web',
    worker: '0'
  });

  const requestBody = {
    new_creation: {
      filters: ['not_honeypot', 'open_source', 'owner_renounced'],
      launchpad_platform: ['fourmeme'],
      quote_address_type: [6, 7, 1, 8, 9, 10, 2],
      creation_tools: ['uxento', 'rapid'],
      limit: 10,
      launchpad_platform_v2: true
    },
    near_completion: {
      launchpad_platform: ['fourmeme', 'bn_fourmeme'],
      quote_address_type: [6, 7, 1, 8, 9, 10, 2],
      creation_tools: ['uxento', 'rapid'],
      limit: 1,
      launchpad_platform_v2: true
    },
    completed: {
      launchpad_platform: ['fourmeme', 'bn_fourmeme', 'flap'],
      quote_address_type: [6, 7, 1, 8, 9, 10, 2],
      creation_tools: ['uxento', 'rapid'],
      limit: 20, // 獲取最近20個已完成的代幣
      launchpad_platform_v2: true
    }
  };

  const response = await fetch(`${GMGN_API_URL}?${params}`, {
    method: 'POST',
    headers: {
      'authorization': authToken,
      'content-type': 'application/json',
      'accept': 'application/json, text/plain, */*',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GMGN API 請求失敗: ${response.status} - ${text}`);
  }

  return await response.json();
}

// 監控新幣
export async function monitorNewTokens() {
  if (!isMonitoring) {
    return { checked: false, reason: 'monitoring_disabled' };
  }

  if (!authToken) {
    console.error('未設置 GMGN Auth Token');
    return { checked: false, reason: 'no_auth_token' };
  }

  try {
    console.log('正在檢查 GMGN 新幣...');

    const result = await fetchGMGNData();

    if (result.code !== 0) {
      console.error('GMGN API 返回錯誤:', result.message);
      return { checked: false, reason: 'api_error', error: result.message };
    }

    const completedTokens = result.data?.completed || [];
    const newCreationTokens = result.data?.new_creation || [];

    console.log(`獲取到 ${completedTokens.length} 個已完成代幣`);
    console.log(`獲取到 ${newCreationTokens.length} 個新創建代幣`);

    let newTokensCount = 0;
    let filteredCount = 0;
    let subTokensCount = 0;
    let upgradedCount = 0; // 從 new_creation 升級到 completed 的數量

    // 處理新創建的代幣 (new_creation) - 只處理符合 SUB 條件的
    // 如果 Twitter 監控已關閉，直接跳過整個 new_creation 處理
    if (config.gmgn.enableTwitterMonitor) {
      for (const token of newCreationTokens) {
        // 檢查是否已監控
        if (isAddressMonitored(token.address)) {
          continue;
        }

        // 提取 Twitter 狀態 ID
        let statusId = null;
        if (token.twitter && token.twitter.includes('/status/')) {
          const parts = token.twitter.split('/status/');
          if (parts.length > 1) {
            statusId = parts[1].split('?')[0];
          }
        }

        // 檢查推文是否已經通知過
        if (statusId && isTwitterStatusMonitored(statusId)) {
          console.log(`跳過已通知的推文: ${statusId}`);
          continue;
        }

        // 檢查是否符合 SUB 條件
        const isSub = isSubToken(token);

        if (isSub) {
          // 符合 SUB 條件，記錄並通知
          subTokensCount++;
          console.log(`發現 SUB 代幣 (new_creation): ${token.symbol} (${token.address}) - Twitter: @${token.twitter_handle}`);

          addMonitoredAddress(token, 'new_creation');

          // 發送通知 (帶 SUB 標記)
          const message = formatNotificationMessage(token, true);
          await telegramNotification.sendMessage(message);

          // 避免發送過快
          await new Promise(resolve => setTimeout(resolve, 1000));

          break; // 每次只處理一個符合 SUB 條件的代幣
        }
        // 不符合 SUB 條件的 new_creation 代幣 → 靜默跳過，不記錄
      }
    }
    
    // 處理已完成的代幣 (completed)
    for (const token of completedTokens) {
      if (subTokensCount != 0) {
        // 如果本次已經有處理過 SUB 代幣，則跳過後續的 completed 代幣處理
        console.log('本次已處理 SUB 代幣，跳過後續 completed 代幣處理');
        break;
      }
      const existingSource = getTokenSource(token.address);

      if (existingSource === 'completed') {
        // 已經是 completed，跳過
        continue;
      } else if (existingSource === 'new_creation') {
        // 從 new_creation 升級到 completed，需要做 completed 的檢查和通知
        console.log(`代幣從 new_creation 升級到 completed: ${token.symbol} (${token.address})`);

        // 應用過濾條件
        if (shouldFilterToken(token)) {
          filteredCount++;
          // 更新 source 但不發送通知
          updateTokenSource(token, 'completed');
          upgradedCount++;
          continue;
        }

        // 通過過濾，更新並發送通知
        updateTokenSource(token, 'completed');
        upgradedCount++;
        newTokensCount++;

        console.log(`發送 completed 通知: ${token.symbol} (${token.address})`);

        // 發送通知
        const message = formatNotificationMessage(token, false);
        await telegramNotification.sendMessage(message);

        // 避免發送過快
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        // 全新的代幣
        // 應用過濾條件
        if (shouldFilterToken(token)) {
          filteredCount++;
          // 仍然添加到數據庫，但不發送通知
          addMonitoredAddress(token, 'completed');
          continue;
        }

        // 新代幣且通過過濾
        newTokensCount++;
        console.log(`發現新代幣 (completed): ${token.symbol} (${token.address})`);

        // 添加到監控列表
        addMonitoredAddress(token, 'completed');

        // 發送通知
        const message = formatNotificationMessage(token, false);
        await telegramNotification.sendMessage(message);

        // 避免發送過快
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const result_summary = {
      checked: true,
      timestamp: toTaiwanString(),
      completed: {
        total: completedTokens.length,
        new: newTokensCount,
        upgraded: upgradedCount,
      },
      new_creation: {
        total: newCreationTokens.length,
        sub: subTokensCount,
      },
      filtered: filteredCount
    };

    if (newTokensCount > 0 || subTokensCount > 0 || upgradedCount > 0) {
      console.log(`本次發現 ${newTokensCount} 個新代幣(completed)，${subTokensCount} 個 SUB 代幣(new_creation)，${upgradedCount} 個升級(new_creation→completed)，過濾 ${filteredCount} 個`);
    }

    return result_summary;

  } catch (error) {
    console.error('GMGN 監控錯誤:', error.message);
    return { checked: false, reason: 'exception', error: error.message };
  }
}

// 獲取已監控的代幣列表
// 只顯示：1) completed 代幣（全部）2) new_creation 中符合 SUB 條件的代幣（有 twitter_status_id）
export function getMonitoredTokens(limit = 50) {
  const stmt = db.prepare(`
    SELECT id, address, symbol, name, market_cap, top_10_holder_rate,
           liquidity, holder_count, launchpad, exchange,
           open_source, owner_renounced, is_honeypot, rug_ratio,
           source, twitter_status_id, first_seen_at
    FROM gmgn_monitored_tokens
    WHERE source = 'completed'
       OR (source = 'new_creation' AND twitter_status_id IS NOT NULL)
    ORDER BY first_seen_at DESC
    LIMIT ?
  `);

  return stmt.all(limit);
}

// 獲取統計信息
// 只統計會顯示在網頁上的代幣（completed + SUB）
export function getStatistics() {
  const stmt = db.prepare(`
    SELECT
      COUNT(*) as total_monitored,
      COUNT(CASE WHEN first_seen_at > datetime('now', '-1 hour') THEN 1 END) as last_hour,
      COUNT(CASE WHEN first_seen_at > datetime('now', '-24 hours') THEN 1 END) as last_24h,
      COUNT(CASE WHEN top_10_holder_rate > 0.4 THEN 1 END) as filtered_high_holder,
      COUNT(CASE WHEN source = 'completed' THEN 1 END) as completed_tokens,
      COUNT(CASE WHEN source = 'new_creation' AND twitter_status_id IS NOT NULL THEN 1 END) as sub_tokens
    FROM gmgn_monitored_tokens
    WHERE source = 'completed'
       OR (source = 'new_creation' AND twitter_status_id IS NOT NULL)
  `);

  return stmt.get();
}

// 清除舊記錄（保留最近7天）
export function cleanOldRecords() {
  const stmt = db.prepare(`
    DELETE FROM gmgn_monitored_tokens
    WHERE first_seen_at < datetime('now', '-7 days')
  `);

  const result = stmt.run();
  console.log(`清除了 ${result.changes} 條舊記錄`);
  return { deleted: result.changes };
}

// 保存新的 Auth Token
export function updateAuthToken(token) {
  authToken = token;
  saveAuthToken(token);
  console.log('GMGN Auth Token 已更新並保存');
  return { success: true };
}
