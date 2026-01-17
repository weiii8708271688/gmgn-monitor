import { ethers } from 'ethers';

const RPC_ENDPOINTS = [
  { name: 'Base Official', url: 'https://mainnet.base.org' },
  { name: 'Ankr', url: 'https://rpc.ankr.com/base' },
  { name: 'BlockPI', url: 'https://base.blockpi.network/v1/rpc/public' },
  { name: '1RPC', url: 'https://1rpc.io/base' },
  { name: 'LlamaRPC (current)', url: 'https://base.llamarpc.com' },
];

async function testRPC(name, url) {
  try {
    const provider = new ethers.JsonRpcProvider(url);

    // 測試 1: 獲取最新區塊號
    const start1 = Date.now();
    const blockNumber = await provider.getBlockNumber();
    const time1 = Date.now() - start1;

    // 測試 2: 獲取區塊詳情
    const start2 = Date.now();
    await provider.getBlock(blockNumber);
    const time2 = Date.now() - start2;

    // 測試 3: 合約調用（查詢 USDC balance）
    const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
    const contract = new ethers.Contract(
      USDC,
      ['function totalSupply() view returns (uint256)'],
      provider
    );
    const start3 = Date.now();
    await contract.totalSupply();
    const time3 = Date.now() - start3;

    const avgTime = Math.round((time1 + time2 + time3) / 3);

    return {
      name,
      success: true,
      blockNumber,
      times: { getBlock: time1, blockDetails: time2, contractCall: time3 },
      avgTime,
    };
  } catch (error) {
    return {
      name,
      success: false,
      error: error.message.slice(0, 50),
    };
  }
}

async function testAllRPCs() {
  console.log('\n=== 測試 Base RPC Endpoints 速度 ===\n');
  console.log('測試項目:');
  console.log('1. 獲取最新區塊號');
  console.log('2. 獲取區塊詳情');
  console.log('3. 合約調用 (totalSupply)\n');
  console.log('─'.repeat(80));

  const results = [];

  for (const rpc of RPC_ENDPOINTS) {
    process.stdout.write(`測試 ${rpc.name.padEnd(25)} ... `);
    const result = await testRPC(rpc.name, rpc.url);
    results.push(result);

    if (result.success) {
      console.log(`✅ 平均: ${result.avgTime}ms`);
    } else {
      console.log(`❌ ${result.error}`);
    }
  }

  console.log('\n' + '─'.repeat(80));
  console.log('\n📊 詳細結果:\n');

  const successful = results.filter(r => r.success).sort((a, b) => a.avgTime - b.avgTime);

  for (let i = 0; i < successful.length; i++) {
    const r = successful[i];
    const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;

    console.log(`${rank} ${r.name}`);
    console.log(`   區塊號: ${r.blockNumber}`);
    console.log(`   獲取區塊: ${r.times.getBlock}ms`);
    console.log(`   區塊詳情: ${r.times.blockDetails}ms`);
    console.log(`   合約調用: ${r.times.contractCall}ms`);
    console.log(`   平均延遲: ${r.avgTime}ms\n`);
  }

  if (results.some(r => !r.success)) {
    console.log('❌ 失敗的 RPC:\n');
    results.filter(r => !r.success).forEach(r => {
      console.log(`   ${r.name}: ${r.error}`);
    });
  }

  console.log('\n' + '─'.repeat(80));
  console.log('\n💡 推薦:\n');
  if (successful.length > 0) {
    console.log(`   最快: ${successful[0].name} (${successful[0].avgTime}ms)`);
    console.log(`   配置: BASE_RPC_URL=${RPC_ENDPOINTS.find(r => r.name === successful[0].name).url}`);
  }

  console.log('\n✅ 測試完成\n');
}

testAllRPCs();
