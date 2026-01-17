import {
  getTaiwanTime,
  toTaiwanString,
  getTaiwanISOString,
  getTimeDifferenceInSeconds,
  formatTimeDifference
} from './src/utils/timeHelper.js';

console.log('🕐 台灣時間工具測試\n');
console.log('=' .repeat(60));

// 測試 1: 獲取台灣時間
const taiwanTime = getTaiwanTime();
console.log('\n1️⃣ getTaiwanTime()');
console.log('   結果:', taiwanTime);

// 測試 2: 格式化為台灣時間字串
const taiwanString = toTaiwanString();
console.log('\n2️⃣ toTaiwanString()');
console.log('   結果:', taiwanString);

// 測試 3: 獲取資料庫用的 ISO 格式
const taiwanISO = getTaiwanISOString();
console.log('\n3️⃣ getTaiwanISOString()');
console.log('   結果:', taiwanISO);

// 測試 4: 計算時間差異
const pastDate = new Date('2025-11-23T19:00:00Z');
const diff = getTimeDifferenceInSeconds(pastDate);
console.log('\n4️⃣ getTimeDifferenceInSeconds()');
console.log('   過去時間:', pastDate.toISOString());
console.log('   現在時間:', new Date().toISOString());
console.log('   時間差:', diff, '秒');
console.log('   格式化:', formatTimeDifference(diff));

// 測試 5: Twitter Snowflake ID 時間解析
function getTwitterTimestamp(statusId) {
  const id = BigInt(statusId);
  const TWITTER_EPOCH = 1288834974657n;
  const timestamp = ((id >> 22n) + TWITTER_EPOCH);
  return new Date(Number(timestamp));
}

const testStatusId = '1860000000000000000';
const tweetTime = getTwitterTimestamp(testStatusId);
console.log('\n5️⃣ Twitter 時間戳解析測試');
console.log('   Status ID:', testStatusId);
console.log('   推文時間 (UTC):', tweetTime.toISOString());
console.log('   推文時間 (台灣):', toTaiwanString(tweetTime));

const tweetAge = getTimeDifferenceInSeconds(tweetTime);
console.log('   距離現在:', formatTimeDifference(tweetAge));

// 測試 6: 模擬 30 秒內的推文
const recentTweet = new Date(Date.now() - 15000); // 15 秒前
const recentAge = getTimeDifferenceInSeconds(recentTweet);
console.log('\n6️⃣ 模擬最近推文測試');
console.log('   推文時間:', toTaiwanString(recentTweet));
console.log('   年齡:', recentAge, '秒');
console.log('   是否在 30 秒內:', recentAge <= 30 ? '✅ 是' : '❌ 否');

console.log('\n' + '='.repeat(60));
console.log('\n✅ 測試完成！所有時間都已轉換為台灣時區 (GMT+8)\n');
