import OnchainPriceFetcher from './onchain-price-fetcher.js';

const fetcher = new OnchainPriceFetcher(
  'https://bsc-dataseed1.binance.org',
  '0x10ED43C718714eb63d5aA57B78B54704E256024E',
  '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  '0x55d398326f99059fF775485246999027B3197955'
);

const tokenAddress = '0xe6e7dbc4725db70df94cd9e899d51830dcf64444';

console.log('測試實時價格查詢（連續 3 次，間隔 2 秒）...\n');

for (let i = 1; i <= 3; i++) {
  console.log(`第 ${i} 次查詢:`);
  const price = await fetcher.getTokenPriceInUSD(tokenAddress);
  console.log(`價格: $${price.toFixed(18)}`);
  console.log('');

  if (i < 3) {
    await new Promise(r => setTimeout(r, 2000));
  }
}

process.exit(0);
