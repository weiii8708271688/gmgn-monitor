import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('https://bsc-dataseed1.binance.org');
const address = '0x41ff9AA7e16B8B1a8a8dc4f0eFacd93D02d071c9';

console.log('檢查合約:', address);
console.log('');

// 檢查是否為合約
const code = await provider.getCode(address);
console.log('Bytecode 長度:', code.length);
console.log('是否為合約:', code !== '0x' ? '✅ 是' : '❌ 否');

if (code === '0x') {
  console.log('\n❌ 這不是一個合約地址');
  process.exit(1);
}

// 嘗試各種常見的方法
const testAbis = [
  { name: 'ERC20 name()', abi: ['function name() view returns (string)'] },
  { name: 'ERC20 symbol()', abi: ['function symbol() view returns (string)'] },
  { name: 'V2 Pair token0()', abi: ['function token0() view returns (address)'] },
  { name: 'V2 Pair factory()', abi: ['function factory() view returns (address)'] },
  { name: 'V3 Pool token0()', abi: ['function token0() external view returns (address)'] },
  { name: 'V3 Pool slot0()', abi: ['function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint32, bool)'] },
  { name: 'Ownable owner()', abi: ['function owner() view returns (address)'] }
];

console.log('\n嘗試各種方法...\n');

for (const test of testAbis) {
  try {
    const contract = new ethers.Contract(address, test.abi, provider);
    const method = test.abi[0].match(/function (\w+)/)[1];
    const result = await contract[method]();
    console.log(`✅ ${test.name}: ${result}`);
  } catch (error) {
    console.log(`❌ ${test.name}: ${error.message.split('\n')[0]}`);
  }
}

process.exit(0);
