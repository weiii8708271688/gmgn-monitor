// test-twitter-timestamp.js
// 測試 Twitter Snowflake ID 時間戳解析

// 從 Twitter 狀態 ID 提取時間戳並轉換為 Date
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

// 檢查推文是否在指定秒數內
function isTweetRecent(statusId, maxAgeSeconds = 30) {
  const tweetTime = getTwitterTimestamp(statusId);
  if (!tweetTime) return false;

  const now = new Date();
  const ageInSeconds = (now - tweetTime) / 1000;

  console.log(`推文時間: ${tweetTime.toISOString()}`);
  console.log(`GMT+8 時間: ${tweetTime.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`);
  console.log(`當前時間: ${now.toISOString()}`);
  console.log(`年齡: ${ageInSeconds.toFixed(2)} 秒`);

  return ageInSeconds <= maxAgeSeconds;
}

console.log('=== Twitter 時間戳測試 ===\n');

// 測試案例 1: 你提供的例子
console.log('測試案例 1: 1981452339807736297');
const testId1 = '1981452339807736297';
const time1 = getTwitterTimestamp(testId1);
if (time1) {
  console.log(`解析結果: ${time1.toISOString()}`);
  console.log(`GMT+8 時間: ${time1.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`);
  console.log(`預期: 2025-10-24 上午4點07分 (GMT+8)`);
}
console.log('\n');

// 測試案例 2: 從 JSON 示例中提取的狀態 ID
console.log('測試案例 2: heyibinance/status/1981452339807736297');
const twitter2 = 'heyibinance/status/1981452339807736297';
const statusId2 = twitter2.split('/status/')[1];
const time2 = getTwitterTimestamp(statusId2);
if (time2) {
  console.log(`解析結果: ${time2.toISOString()}`);
  console.log(`GMT+8 時間: ${time2.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`);
}
console.log('\n');

// 測試案例 3: 檢查推文是否在 30 秒內 (模擬當前時間的推文)
console.log('測試案例 3: 模擬當前時間的推文');
const now = new Date();
const nowTimestamp = now.getTime();
// 計算對應的 Twitter Snowflake ID
const TWITTER_EPOCH = 1288834974657;
const snowflakeId = ((BigInt(nowTimestamp) - BigInt(TWITTER_EPOCH)) << 22n) | 0n;
console.log(`生成的 Snowflake ID: ${snowflakeId.toString()}`);

const isRecent = isTweetRecent(snowflakeId.toString(), 30);
console.log(`是否在 30 秒內: ${isRecent ? '是' : '否'}`);
console.log('\n');

// 測試案例 4: 檢查舊推文 (1小時前)
console.log('測試案例 4: 模擬 1 小時前的推文');
const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
const oneHourAgoTimestamp = oneHourAgo.getTime();
const snowflakeIdOld = ((BigInt(oneHourAgoTimestamp) - BigInt(TWITTER_EPOCH)) << 22n) | 0n;
console.log(`生成的 Snowflake ID: ${snowflakeIdOld.toString()}`);

const isRecentOld = isTweetRecent(snowflakeIdOld.toString(), 30);
console.log(`是否在 30 秒內: ${isRecentOld ? '是' : '否'}`);
console.log('\n');

// 測試案例 5: 驗證 JSON 中的其他推文
console.log('測試案例 5: 其他推文示例');
const testCases = [
  { handle: 'kyle_chasse', statusId: '1985170168306389051' },
  { handle: 'binancezh', statusId: '1985145399838154848' },
  { handle: 'binance', statusId: '1984190916043919610' },
  { handle: 'binance', statusId: '1985119909446103064' }
];

testCases.forEach(({ handle, statusId }) => {
  console.log(`\n@${handle} - 狀態 ID: ${statusId}`);
  const time = getTwitterTimestamp(statusId);
  if (time) {
    console.log(`時間: ${time.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`);
  }
});

console.log('\n=== 測試完成 ===');
