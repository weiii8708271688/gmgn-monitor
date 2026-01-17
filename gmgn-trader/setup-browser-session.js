/**
 * 使用瀏覽器設置會話
 *
 * 使用方法：
 * 1. 運行此腳本
 * 2. 在打開的瀏覽器中手動登入 GMGN.ai
 * 3. 按 Enter 繼續
 * 4. 腳本會自動提取並保存 token 和 cookies
 */

import BrowserAuth from './browser-auth.js';

async function main() {
  console.log('='.repeat(60));
  console.log('使用真實瀏覽器設置 GMGN.ai 會話');
  console.log('='.repeat(60));
  console.log('');

  const browserAuth = new BrowserAuth();

  try {
    // 啟動瀏覽器（顯示視窗）
    await browserAuth.launch(false);

    // 等待用戶登入
    await browserAuth.waitForLogin();

    // 提取 token, cookies 和 localStorage
    const { token, cookies, localStorage } = await browserAuth.extractTokenAndCookies();

    console.log('\n✅ 會話設置成功！');
    console.log(`Token: ${token.substring(0, 50)}...`);
    console.log(`Cookies: ${Object.keys(cookies).length} 個`);
    console.log(`localStorage: ${Object.keys(localStorage).length} 個`);

    // 顯示過期時間
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      const expiryDate = new Date(payload.exp * 1000);
      const now = new Date();
      const remainingMinutes = Math.floor((expiryDate - now) / 60000);

      console.log(`\nToken 信息:`);
      console.log(`過期時間: ${expiryDate.toLocaleString()}`);
      console.log(`剩餘時間: ${remainingMinutes} 分鐘`);
    } catch (error) {
      console.error('無法解析 Token:', error.message);
    }

    console.log('\n現在可以使用以下命令測試:');
    console.log('  node test-create-order.js');
    console.log('  node index.js');

  } catch (error) {
    console.error('\n❌ 錯誤:', error.message);
  } finally {
    await browserAuth.close();
  }
}

main();
