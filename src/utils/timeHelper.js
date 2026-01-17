// 台灣時區時間工具函數

/**
 * 獲取當前台灣時間的 Date 物件
 */
export function getTaiwanTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
}

/**
 * 將任意 Date 物件轉換為台灣時區字串
 * @param {Date} date - 日期物件
 * @param {Object} options - 格式選項
 */
export function toTaiwanString(date = new Date(), options = {}) {
  const defaultOptions = {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };

  return date.toLocaleString('zh-TW', { ...defaultOptions, ...options });
}

/**
 * 獲取台灣時間的 ISO 格式字串（用於資料庫）
 * 格式: YYYY-MM-DD HH:mm:ss
 */
export function getTaiwanISOString(date = new Date()) {
  const taiwanTime = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));

  const year = taiwanTime.getFullYear();
  const month = String(taiwanTime.getMonth() + 1).padStart(2, '0');
  const day = String(taiwanTime.getDate()).padStart(2, '0');
  const hours = String(taiwanTime.getHours()).padStart(2, '0');
  const minutes = String(taiwanTime.getMinutes()).padStart(2, '0');
  const seconds = String(taiwanTime.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 計算兩個時間之間的差異（秒）
 * @param {Date} date1 - 較早的時間
 * @param {Date} date2 - 較晚的時間（預設為現在）
 */
export function getTimeDifferenceInSeconds(date1, date2 = new Date()) {
  return Math.floor((date2 - date1) / 1000);
}

/**
 * 格式化時間差異為人類可讀格式
 * @param {number} seconds - 秒數
 */
export function formatTimeDifference(seconds) {
  if (seconds < 60) {
    return `${seconds} 秒`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes} 分鐘`;
  } else if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours} 小時 ${minutes} 分鐘`;
  } else {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    return `${days} 天 ${hours} 小時`;
  }
}
