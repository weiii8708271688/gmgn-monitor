import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('https://bsc-dataseed1.binance.org');
const address = '0x41ff9AA7e16B8B1a8a8dc4f0eFacd93D02d071c9';

console.log('檢查地址:', address);

const code = await provider.getCode(address);
console.log('Bytecode 長度:', code.length);
console.log('是否為合約:', code !== '0x' ? '✅ 是' : '❌ 否');

if (code === '0x') {
  console.log('\n❌ 這不是一個合約地址，可能：');
  console.log('1. 地址錯誤');
  console.log('2. 合約已被銷毀');
  console.log('3. 不在 BSC 鏈上');
}

process.exit(0);
