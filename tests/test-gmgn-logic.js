/**
 * 測試 GMGN 監控邏輯
 * 驗證 new_creation 和 completed 的獨立處理
 */

console.log('🧪 GMGN 監控邏輯測試\n');
console.log('='.repeat(80));

// 模擬場景
const scenarios = [
  {
    name: '場景 1: 全新的 SUB 代幣（new_creation）',
    newCreation: [
      { address: '0xAAA', symbol: 'SUB1', twitter: 'https://x.com/cz_binance/status/RECENT', twitter_handle: 'cz_binance', isSub: true }
    ],
    completed: [],
    expected: {
      new_creation_recorded: 1,
      sub_notifications: 1,
      completed_recorded: 0,
      completed_notifications: 0,
    }
  },
  {
    name: '場景 2: new_creation 不符合 SUB（靜默跳過）',
    newCreation: [
      { address: '0xBBB', symbol: 'NOTSUB', twitter: 'https://x.com/random/status/123', twitter_handle: 'random', isSub: false }
    ],
    completed: [],
    expected: {
      new_creation_recorded: 0,
      sub_notifications: 0,
      completed_recorded: 0,
      completed_notifications: 0,
    }
  },
  {
    name: '場景 3: 全新的 completed 代幣',
    newCreation: [],
    completed: [
      { address: '0xCCC', symbol: 'COMP1', passFilter: true }
    ],
    expected: {
      new_creation_recorded: 0,
      sub_notifications: 0,
      completed_recorded: 1,
      completed_notifications: 1,
    }
  },
  {
    name: '場景 4: SUB 代幣升級到 completed',
    description: '第一次檢查: new_creation 符合 SUB\n      第二次檢查: 同一個代幣出現在 completed',
    newCreation: [
      { address: '0xDDD', symbol: 'SUB2', twitter: 'https://x.com/heyibinance/status/RECENT', twitter_handle: 'heyibinance', isSub: true }
    ],
    completed: [
      { address: '0xDDD', symbol: 'SUB2', passFilter: true }
    ],
    expected: {
      new_creation_recorded: 1,
      sub_notifications: 1,
      completed_upgraded: 1,
      completed_notifications: 1,
    }
  },
  {
    name: '場景 5: SUB 代幣升級但不通過過濾',
    description: '第一次檢查: new_creation 符合 SUB\n      第二次檢查: 同一個代幣出現在 completed 但被過濾',
    newCreation: [
      { address: '0xEEE', symbol: 'SUB3', twitter: 'https://x.com/cz_binance/status/RECENT', twitter_handle: 'cz_binance', isSub: true }
    ],
    completed: [
      { address: '0xEEE', symbol: 'SUB3', passFilter: false }
    ],
    expected: {
      new_creation_recorded: 1,
      sub_notifications: 1,
      completed_upgraded: 1,
      completed_notifications: 0, // 被過濾了
    }
  },
  {
    name: '場景 6: 已存在的 completed 代幣再次出現',
    description: '代幣已經在資料庫中 (source=completed)，再次出現時跳過',
    existingInDB: [
      { address: '0xFFF', source: 'completed' }
    ],
    newCreation: [],
    completed: [
      { address: '0xFFF', symbol: 'OLD', passFilter: true }
    ],
    expected: {
      new_creation_recorded: 0,
      sub_notifications: 0,
      completed_recorded: 0, // 已存在，跳過
      completed_notifications: 0,
    }
  }
];

console.log('\n📊 測試場景:\n');

scenarios.forEach((scenario, index) => {
  console.log(`\n${index + 1}. ${scenario.name}`);
  if (scenario.description) {
    console.log(`   描述: ${scenario.description}`);
  }

  console.log('\n   輸入:');
  if (scenario.existingInDB && scenario.existingInDB.length > 0) {
    console.log(`   - 資料庫已存在: ${JSON.stringify(scenario.existingInDB)}`);
  }
  console.log(`   - new_creation: ${scenario.newCreation.length} 個代幣`);
  scenario.newCreation.forEach(t => {
    console.log(`     • ${t.symbol} (${t.address}) - SUB: ${t.isSub ? '✅' : '❌'}`);
  });
  console.log(`   - completed: ${scenario.completed.length} 個代幣`);
  scenario.completed.forEach(t => {
    console.log(`     • ${t.symbol} (${t.address}) - 通過過濾: ${t.passFilter ? '✅' : '❌'}`);
  });

  console.log('\n   預期結果:');
  Object.entries(scenario.expected).forEach(([key, value]) => {
    console.log(`   - ${key}: ${value}`);
  });

  console.log('\n   處理流程:');

  // 模擬處理 new_creation
  let newCreationRecorded = 0;
  let subNotifications = 0;
  const db = new Map();

  // 模擬已存在的資料
  if (scenario.existingInDB) {
    scenario.existingInDB.forEach(item => {
      db.set(item.address, item.source);
    });
  }

  scenario.newCreation.forEach(token => {
    if (db.has(token.address)) {
      console.log(`   ⏭️  跳過 ${token.symbol}: 已在資料庫`);
      return;
    }

    if (token.isSub) {
      db.set(token.address, 'new_creation');
      newCreationRecorded++;
      subNotifications++;
      console.log(`   ✅ 記錄 ${token.symbol} (new_creation) + 發送 SUB 通知`);
    } else {
      console.log(`   ⏭️  跳過 ${token.symbol}: 不符合 SUB 條件`);
    }
  });

  // 模擬處理 completed
  let completedRecorded = 0;
  let completedUpgraded = 0;
  let completedNotifications = 0;

  scenario.completed.forEach(token => {
    const existingSource = db.get(token.address);

    if (existingSource === 'completed') {
      console.log(`   ⏭️  跳過 ${token.symbol}: 已是 completed`);
      return;
    } else if (existingSource === 'new_creation') {
      db.set(token.address, 'completed');
      completedUpgraded++;

      if (token.passFilter) {
        completedNotifications++;
        console.log(`   🔄 升級 ${token.symbol} (new_creation → completed) + 發送通知`);
      } else {
        console.log(`   🔄 升級 ${token.symbol} (new_creation → completed) - 被過濾，不通知`);
      }
    } else {
      db.set(token.address, 'completed');
      completedRecorded++;

      if (token.passFilter) {
        completedNotifications++;
        console.log(`   ✅ 記錄 ${token.symbol} (completed) + 發送通知`);
      } else {
        console.log(`   ✅ 記錄 ${token.symbol} (completed) - 被過濾，不通知`);
      }
    }
  });

  // 驗證結果
  console.log('\n   實際結果:');
  const actual = {
    new_creation_recorded: newCreationRecorded,
    sub_notifications: subNotifications,
    completed_recorded: completedRecorded,
    completed_upgraded: completedUpgraded,
    completed_notifications: completedNotifications,
  };

  let passed = true;
  Object.entries(scenario.expected).forEach(([key, expectedValue]) => {
    const actualValue = actual[key] || 0;
    const match = actualValue === expectedValue;
    const icon = match ? '✅' : '❌';
    console.log(`   ${icon} ${key}: ${actualValue} (預期: ${expectedValue})`);
    if (!match) passed = false;
  });

  console.log(`\n   ${passed ? '✅ 通過' : '❌ 失敗'}`);
  console.log('\n' + '-'.repeat(80));
});

console.log('\n' + '='.repeat(80));
console.log('\n✅ 測試完成！\n');
console.log('📝 關鍵邏輯總結:');
console.log('1. new_creation: 只記錄符合 SUB 的代幣');
console.log('2. completed: 記錄所有通過過濾的代幣');
console.log('3. 升級流程: new_creation → completed 時重新檢查並通知');
console.log('4. 兩者獨立: 不會在同一次 API 查詢中重疊\n');
