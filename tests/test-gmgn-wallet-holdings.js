/**
 * 測試 GMGN 錢包持倉 API (Playwright)
 * 端點: /api/v1/wallet_holdings/bsc/{wallet}
 * BNB 價格: PancakeSwap 鏈上查詢
 *
 * 用法: node tests/test-gmgn-wallet-holdings.js
 */

import { createRequire } from 'module';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gmgnTraderDir = path.join(__dirname, '..', 'gmgn-trader');

dotenv.config({ path: path.join(gmgnTraderDir, '.env') });

// 從 gmgn-trader 載入依賴
const require = createRequire(path.join(gmgnTraderDir, 'node_modules', 'placeholder.js'));
const { chromium } = require('playwright');
const { ethers } = require('ethers');

const token = process.env.GMGN_AUTH_TOKEN;
const walletAddress = process.env.GMGN_WALLET_ADDRESS || '0xe074e46aaa9d3588bed825881c9185a16f9a8555';
const bscRpc = process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org';

if (!token) {
  console.log('❌ 缺少 GMGN_AUTH_TOKEN，請檢查 gmgn-trader/.env');
  process.exit(1);
}

// PancakeSwap 常數
const PANCAKE_FACTORY = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const USDT = '0x55d398326f99059fF775485246999027B3197955';

const FACTORY_ABI = ['function getPair(address, address) view returns (address)'];
const PAIR_ABI = [
  'function getReserves() view returns (uint112, uint112, uint32)',
  'function token0() view returns (address)'
];

// GMGN 查詢參數
const baseParams = {
  device_id: '99aa3a4a-48cb-478f-810e-b76c89ea9900',
  fp_did: '7007dbff0da66412c0e06ee07b82413b',
  client_id: 'gmgn_web_20251108-6872-be2ed8c',
  from_app: 'gmgn',
  app_ver: '20251108-6872-be2ed8c',
  tz_name: 'Asia/Taipei',
  tz_offset: '28800',
  app_lang: 'zh-TW',
  os: 'web',
  worker: '0'
};

// 從 PancakeSwap 取得 BNB 價格
async function getBnbPrice() {
  const provider = new ethers.JsonRpcProvider(bscRpc);
  const factory = new ethers.Contract(PANCAKE_FACTORY, FACTORY_ABI, provider);
  const pairAddr = await factory.getPair(WBNB, USDT);
  const pair = new ethers.Contract(pairAddr, PAIR_ABI, provider);

  const [reserves, token0] = await Promise.all([pair.getReserves(), pair.token0()]);
  const isWbnbToken0 = token0.toLowerCase() === WBNB.toLowerCase();

  const reserve0 = parseFloat(ethers.formatUnits(reserves[0], 18));
  const reserve1 = parseFloat(ethers.formatUnits(reserves[1], 18));

  return isWbnbToken0 ? reserve1 / reserve0 : reserve0 / reserve1;
}

// 在瀏覽器內執行 API 請求
async function browserFetch(page, url) {
  return page.evaluate(
    async ({ url, token }) => {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            'accept': 'application/json, text/plain, */*',
            'authorization': `Bearer ${token}`
          },
          credentials: 'include'
        });
        if (!res.ok) return { success: false, status: res.status, error: await res.text() };
        return { success: true, data: await res.json() };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },
    { url, token }
  );
}

function formatNum(num) {
  if (typeof num === 'string') num = parseFloat(num);
  if (!num || isNaN(num)) return '0';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  if (num >= 1) return num.toFixed(4);
  if (num >= 0.0001) return num.toFixed(6);
  return num.toExponential(2);
}

// ========== 主程式 ==========
async function main() {
  console.log('🧪 GMGN 錢包持倉測試');
  console.log(`📍 錢包: ${walletAddress}\n`);

  // 1. 取得 BNB 價格 (鏈上)
  console.log('💰 查詢 BNB 價格 (PancakeSwap)...');
  const bnbPrice = await getBnbPrice();
  console.log(`   BNB = $${bnbPrice.toFixed(2)}\n`);

  // 2. 啟動瀏覽器
  console.log('🚀 啟動瀏覽器...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei'
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  await page.goto('https://gmgn.ai/bsc', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  console.log('✅ 瀏覽器就緒\n');

  // 3. 取得持倉
  const params = new URLSearchParams({
    ...baseParams,
    limit: '50',
    orderby: 'last_active_timestamp',
    direction: 'desc',
    showsmall: 'true',
    sellout: 'true',
    hide_abnormal: 'false'
  });

  console.log('📦 查詢錢包持倉...');
  const url = `https://gmgn.ai/api/v1/wallet_holdings/bsc/${walletAddress}?${params}`;
  const result = await browserFetch(page, url);

  if (!result.success || result.data?.code !== 0) {
    console.log(`❌ 查詢失敗: ${result.error || result.data?.msg || 'unknown'}`);
    await browser.close();
    return;
  }

  const holdings = result.data.data?.holdings || [];
  console.log(`✅ 持倉數量: ${holdings.length} 個代幣\n`);

  if (holdings.length === 0) {
    console.log('   (此錢包沒有持倉)');
    await browser.close();
    return;
  }

  // 4. 顯示持倉 (USD + BNB)
  console.log('-'.repeat(95));
  console.log(`  ${'#'.padEnd(4)}${'代幣'.padEnd(14)}${'數量'.padEnd(18)}${'價值(USD)'.padEnd(14)}${'價值(BNB)'.padEnd(14)}${'盈虧(USD)'}`);
  console.log('-'.repeat(95));

  let totalUsd = 0;
  let totalProfit = 0;

  holdings.forEach((h, i) => {
    if (h.history_bought_cost == 0) return; // 跳過成本為 0 的項目（可能是空持倉或異常數據）
    const symbol = (h.token?.symbol || 'N/A').substring(0, 12);
    const usdVal = parseFloat(h.usd_value) || 0;
    const bnbVal = usdVal / bnbPrice;
    const profit = parseFloat(h.total_profit) || 0;

    totalUsd += usdVal;
    totalProfit += profit;

    const profitStr = profit >= 0 ? `+$${formatNum(profit)}` : `-$${formatNum(Math.abs(profit))}`;

    console.log(
      `  ${String(i + 1).padEnd(4)}${symbol.padEnd(12)}` +
      `${formatNum(parseFloat(h.balance)).padEnd(18)}` +
      `$${formatNum(usdVal).padEnd(13)}` +
      `${formatNum(bnbVal).padEnd(13)} BNB` +
      `  ${profitStr}`
    );
  });

  console.log('-'.repeat(95));

  const totalBnb = totalUsd / bnbPrice;
  const totalProfitStr = totalProfit >= 0 ? `+$${formatNum(totalProfit)}` : `-$${formatNum(Math.abs(totalProfit))}`;
  console.log(`\n📊 總計: $${formatNum(totalUsd)} = ${formatNum(totalBnb)} BNB  |  總盈虧: ${totalProfitStr}`);

  // 5. 顯示第一筆完整資料 (開發參考)
  console.log('\n📝 第一筆完整資料結構:');
  for (let i = 0; i < holdings.length; i++) {
    if (holdings[i].history_bought_cost == 0) {
      console.log(`   (第 ${i + 1} 筆)`);
      console.log(JSON.stringify(holdings[i], null, 2));
    }
  }
  console.log(JSON.stringify(holdings[0], null, 2));

  await browser.close();
  console.log('\n✅ 測試完成');
}

main().catch(err => {
  console.error('❌ 致命錯誤:', err.message);
  process.exit(1);
});
