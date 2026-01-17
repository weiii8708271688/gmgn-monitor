import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('https://bsc-dataseed1.binance.org');
const tokenAddress = '0xa7601a0e9779adcb01b12b1ec0496bceb3f04444';

console.log('搜尋代幣的所有流動性池...');
console.log('代幣地址:', tokenAddress);
console.log('');

// 常見的 DEX Factory 地址
const factories = [
  { name: 'PancakeSwap V2', address: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73' },
  { name: 'PancakeSwap V1', address: '0xBCfCcbde45cE4943226A0b15Ffc8a8b0e7D30e35' },
  { name: 'Uniswap V2 (BSC)', address: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f' },
  { name: 'Biswap', address: '0x858E3312ed3A876947EA49d572A7C42DE08af7EE' },
  { name: 'ApeSwap', address: '0x0841BD0B734E4F5853f0dD8d7Ea041c241fb0Da6' }
];

// 常見的交易對代幣
const baseTokens = [
  { symbol: 'WBNB', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' },
  { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955' },
  { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' },
  { symbol: 'BUSD', address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56' },
  { symbol: 'USD1', address: '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d' },
  { symbol: 'DAI', address: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3' },
  { symbol: 'ETH', address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8' },
  { symbol: 'BTCB', address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c' }
];

const factoryAbi = ['function getPair(address tokenA, address tokenB) external view returns (address pair)'];
const pairAbi = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
  'function token1() view returns (address)'
];

let foundPools = [];

// 搜尋所有 Factory
for (const factory of factories) {
  console.log(`\n檢查 ${factory.name}...`);

  try {
    const factoryContract = new ethers.Contract(factory.address, factoryAbi, provider);

    for (const baseToken of baseTokens) {
      try {
        const pairAddress = await factoryContract.getPair(tokenAddress, baseToken.address);

        if (pairAddress !== '0x0000000000000000000000000000000000000000') {
          console.log(`  ✅ 找到 Token/${baseToken.symbol} 池: ${pairAddress}`);

          // 獲取池子詳細信息
          try {
            const pairContract = new ethers.Contract(pairAddress, pairAbi, provider);
            const [reserve0, reserve1, token0, token1] = await Promise.all([
              pairContract.getReserves().then(r => r[0]),
              pairContract.getReserves().then(r => r[1]),
              pairContract.token0(),
              pairContract.token1()
            ]);

            foundPools.push({
              dex: factory.name,
              baseToken: baseToken.symbol,
              pairAddress,
              token0,
              token1,
              reserve0: ethers.formatEther(reserve0),
              reserve1: ethers.formatEther(reserve1)
            });

            console.log(`     Token0: ${token0}`);
            console.log(`     Token1: ${token1}`);
            console.log(`     Reserve0: ${ethers.formatEther(reserve0)}`);
            console.log(`     Reserve1: ${ethers.formatEther(reserve1)}`);
          } catch (error) {
            console.log(`     ⚠️  無法讀取池子詳情: ${error.message}`);
          }
        }
      } catch (error) {
        // 忽略查詢錯誤
      }
    }
  } catch (error) {
    console.log(`  ⚠️  ${factory.name} 查詢失敗: ${error.message}`);
  }
}

console.log('\n\n========== 搜尋結果 ==========');
if (foundPools.length === 0) {
  console.log('❌ 沒有找到任何流動性池');
  console.log('\n可能的原因:');
  console.log('1. 這個代幣沒有在常見的 DEX 上架');
  console.log('2. 使用了非標準的流動性池');
  console.log('3. 代幣地址錯誤');
} else {
  console.log(`✅ 找到 ${foundPools.length} 個流動性池:\n`);
  foundPools.forEach((pool, i) => {
    console.log(`${i + 1}. ${pool.dex} - Token/${pool.baseToken}`);
    console.log(`   地址: ${pool.pairAddress}`);
    console.log(`   流動性: ${pool.reserve0} / ${pool.reserve1}\n`);
  });
}

process.exit(0);
