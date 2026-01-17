import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { toTaiwanString, getTaiwanTime, getTimeDifferenceInSeconds, formatTimeDifference } from './src/utils/timeHelper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Twitter Snowflake ID 時間戳解析
function getTwitterTimestamp(statusId) {
  if (!statusId) return null;
  try {
    const id = BigInt(statusId);
    const TWITTER_EPOCH = 1288834974657n;
    const timestamp = ((id >> 22n) + TWITTER_EPOCH);
    return new Date(Number(timestamp));
  } catch (error) {
    console.error('解析 Twitter 時間戳失敗:', error.message);
    return null;
  }
}

// 檢查推文是否在指定秒數內
function isTweetRecent(statusId, maxAgeSeconds = 30) {
  const tweetTime = getTwitterTimestamp(statusId);
  if (!tweetTime) return false;

  const now = getTaiwanTime();
  const ageInSeconds = getTimeDifferenceInSeconds(tweetTime, now);

  console.log(`\n⏰ 推文時間分析 (台灣時間 GMT+8):`);
  console.log(`   推文發布時間: ${toTaiwanString(tweetTime)}`);
  console.log(`   當前時間: ${toTaiwanString(now)}`);
  console.log(`   年齡: ${ageInSeconds} 秒 (${formatTimeDifference(ageInSeconds)})`);
  console.log(`   是否在 ${maxAgeSeconds} 秒內: ${ageInSeconds <= maxAgeSeconds ? '✅ 是' : '❌ 否'}`);

  return ageInSeconds <= maxAgeSeconds;
}

// 檢查 Twitter 帳號
function isTargetTwitterAccount(twitterHandle) {
  if (!twitterHandle) return false;
  const handle = twitterHandle.toLowerCase().trim();
  return handle === 'cz_binance' || handle === 'heyibinance';
}

// 檢查是否為 SUB 代幣
function isSubToken(token) {
  console.log('\n🔍 檢查代幣是否符合 SUB 條件:');
  console.log(`   代幣: ${token.symbol} (${token.name})`);

  // 1. 檢查是否有 Twitter 欄位
  if (!token.twitter) {
    console.log('   ❌ 沒有 Twitter 欄位');
    return false;
  }
  console.log(`   ✅ 有 Twitter: ${token.twitter}`);

  // 2. 檢查 Twitter 帳號
  if (!isTargetTwitterAccount(token.twitter_handle)) {
    console.log(`   ❌ Twitter 帳號不符合: @${token.twitter_handle} (需要 @cz_binance 或 @heyibinance)`);
    return false;
  }
  console.log(`   ✅ Twitter 帳號符合: @${token.twitter_handle}`);

  // 3. 提取狀態 ID
  let statusId = null;
  if (token.twitter.includes('/status/')) {
    const parts = token.twitter.split('/status/');
    if (parts.length > 1) {
      statusId = parts[1].split('?')[0];
    }
  }

  if (!statusId) {
    console.log('   ❌ 無法提取 Twitter 狀態 ID');
    return false;
  }
  console.log(`   ✅ Twitter 狀態 ID: ${statusId}`);

  // 4. 檢查推文是否在 30 秒內
  const isRecent = isTweetRecent(statusId, 30);

  if (!isRecent) {
    console.log('   ❌ 推文不在 30 秒內');
    return false;
  }
  console.log('   ✅ 推文在 30 秒內');

  return true;
}

// 模擬 GMGN API 回應
async function simulateGMGNData() {
  console.log('\n🚀 開始模擬 GMGN 監控系統 (new_creation 測試)\n');
  console.log('=' .repeat(80));

  // 模擬的 new_creation 代幣資料
  const mockNewCreationTokens = [
    {
      address: '0x1234567890123456789012345678901234567890',
      symbol: 'TEST1',
      name: 'Test Token 1',
      twitter: 'https://x.com/uncleibbra/status/1992565936457756723',
      twitter_handle: 'cz_binance',
      market_cap: 50000,
      top_10_holder_rate: 0.35,
      liquidity: 25000,
      holder_count: 150
    },
    {
      address: '0x2345678901234567890123456789012345678901',
      symbol: 'TEST2',
      name: 'Test Token 2',
      twitter: 'https://x.com/heyibinance/status/1860123456789012345',
      twitter_handle: 'heyibinance',
      market_cap: 75000,
      top_10_holder_rate: 0.28,
      liquidity: 35000,
      holder_count: 200
    },
    {
      address: '0x3456789012345678901234567890123456789012',
      symbol: 'TEST3',
      name: 'Test Token 3',
      twitter: 'https://x.com/random_user/status/1860234567890123456',
      twitter_handle: 'random_user',
      market_cap: 60000,
      top_10_holder_rate: 0.30,
      liquidity: 30000,
      holder_count: 180
    },
    {
      address: '0x4567890123456789012345678901234567890123',
      symbol: 'TEST4',
      name: 'Test Token 4',
      // 沒有 Twitter 欄位
      market_cap: 40000,
      top_10_holder_rate: 0.25,
      liquidity: 20000,
      holder_count: 120
    }
  ];

  console.log(`\n📊 模擬獲取到 ${mockNewCreationTokens.length} 個 new_creation 代幣\n`);

  let subTokensCount = 0;
  const subTokens = [];

  for (let i = 0; i < mockNewCreationTokens.length; i++) {
    const token = mockNewCreationTokens[i];
    console.log('\n' + '─'.repeat(80));
    console.log(`\n📝 代幣 ${i + 1}/${mockNewCreationTokens.length}:`);

    const isSub = isSubToken(token);

    if (isSub) {
      subTokensCount++;
      subTokens.push(token);
      console.log('\n🎉 結果: ⭐ 這是一個 SUB 代幣！將發送通知');
    } else {
      console.log('\n📌 結果: ❌ 不是 SUB 代幣，將靜默添加到數據庫');
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n📈 測試總結:');
  console.log(`   總代幣數: ${mockNewCreationTokens.length}`);
  console.log(`   SUB 代幣數: ${subTokensCount}`);
  console.log(`   普通代幣數: ${mockNewCreationTokens.length - subTokensCount}`);

  if (subTokens.length > 0) {
    console.log('\n⭐ SUB 代幣列表:');
    subTokens.forEach((token, index) => {
      console.log(`   ${index + 1}. ${token.symbol} (@${token.twitter_handle})`);
    });
  }

  console.log('\n' + '='.repeat(80));
}

// 執行模擬測試
simulateGMGNData().catch(console.error);
