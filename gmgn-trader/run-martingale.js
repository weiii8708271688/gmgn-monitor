/**
 * 马丁格尔策略主运行文件
 *
 * 使用方法:
 * node run-martingale.js
 */

import MartingaleStrategy from './martingale-strategy.js';

// 创建策略实例
const strategy = new MartingaleStrategy();

// 处理优雅退出
process.on('SIGINT', async () => {
  console.log('\n\n收到退出信号...');
  await strategy.cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\n收到终止信号...');
  await strategy.cleanup();
  process.exit(0);
});

// 主函数
async function main() {
  try {
    // 初始化
    await strategy.init();

    // 启动策略
    await strategy.start();

    // 保持运行
    console.log('策略运行中... (按 Ctrl+C 停止)');
  } catch (error) {
    console.error('\n❌ 发生错误:', error.message);
    await strategy.cleanup();
    process.exit(1);
  }
}

// 运行
main();
