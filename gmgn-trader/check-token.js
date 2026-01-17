import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('https://bsc-dataseed1.binance.org');
const tokenAddress = '0xa7601a0e9779adcb01b12b1ec0496bceb3f04444';

console.log('檢查代幣地址:', tokenAddress);

const code = await provider.getCode(tokenAddress);
console.log('是否為合約:', code !== '0x' ? '✅ 是' : '❌ 否');

if (code === '0x') {
  console.log('\n❌ 這不是一個合約地址！');
  process.exit(1);
}

const tokenAbi = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)'
];

const token = new ethers.Contract(tokenAddress, tokenAbi, provider);

try {
  const [name, symbol, decimals, totalSupply] = await Promise.all([
    token.name(),
    token.symbol(),
    token.decimals(),
    token.totalSupply()
  ]);

  console.log('\n代幣資訊:');
  console.log('名稱:', name);
  console.log('符號:', symbol);
  console.log('精度:', decimals);
  console.log('總供應量:', ethers.formatUnits(totalSupply, decimals));
} catch (error) {
  console.log('\n❌ 無法讀取代幣資訊:', error.message);
}

process.exit(0);
