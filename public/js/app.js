const API_BASE = '/api';
// 狀態管理
let state = {
    tokens: [],
    orders: [],
    alerts: [],
    prices: {},
    lastGMGNTokenCount: 0,  // 追蹤最後一次的代幣數量
};

// 創建全局 AudioContext（避免每次都創建新的）
let globalAudioContext = null;

// 初始化 AudioContext
function initAudioContext() {
    if (!globalAudioContext) {
        try {
            globalAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log('✅ AudioContext 已初始化');
        } catch (error) {
            console.error('❌ AudioContext 初始化失敗:', error);
        }
    }
    return globalAudioContext;
}

// 創建提示音（使用 Web Audio API 生成可愛的音效）
async function playNotificationSound() {
    try {
        const audioContext = initAudioContext();
        if (!audioContext) {
            console.error('❌ AudioContext 不可用');
            return;
        }

        // 確保 AudioContext 是運行狀態
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
            console.log('🔊 AudioContext 已恢復');
        }

        // 創建一個可愛的兩音調「叮咚」音效
        const playTone = (frequency, startTime, duration) => {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = frequency;
            oscillator.type = 'sine';

            // 音量淡入淡出效果
            gainNode.gain.setValueAtTime(0, startTime);
            gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.01);
            gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

            oscillator.start(startTime);
            oscillator.stop(startTime + duration);
        };

        const now = audioContext.currentTime;
        // 第一個音 (高音 E6)
        playTone(1318.51, now, 0.2);
        // 第二個音 (中音 C6)
        playTone(1046.50, now + 0.15, 0.3);

        console.log('🔔 音效已觸發');

    } catch (error) {
        console.error('❌ 播放提示音失敗:', error);
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    setupForms();
    loadInitialData();
    startAutoRefresh();
    startGMGNAutoRefresh();  // 啟動 GMGN 自動刷新

    // 預先初始化 AudioContext（透過用戶交互）
    document.body.addEventListener('click', () => {
        initAudioContext();
    }, { once: true });
});

// 設定分頁切換
function setupTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;
            switchTab(targetTab);
        });
    });
}

function switchTab(tabName) {
    // 更新按鈕狀態
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // 更新內容顯示
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === tabName);
    });

    // 載入對應資料
    switch(tabName) {
        case 'tokens':
            loadTokens();
            break;
        case 'orders':
            loadOrders();
            break;
        case 'alerts':
            loadAlerts();
            break;
        case 'prices':
            loadPrices();
            break;
        case 'gmgn':
            loadGMGNData();
            break;
        case 'wallet':
            loadWalletBalance();
            break;
    }
}

// 設定表單提交
function setupForms() {
    // 添加代幣
    document.getElementById('addTokenForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData);

        // 移除空值
        Object.keys(data).forEach(key => {
            if (data[key] === '') delete data[key];
        });

        try {
            const response = await fetch(`${API_BASE}/tokens`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error + (result.hint ? '\n提示: ' + result.hint : ''));
            }

            closeModal('addTokenModal');
            e.target.reset();
            loadTokens();
            showNotification('代幣添加成功', 'success');
        } catch (error) {
            showNotification('添加失敗: ' + error.message, 'error');
        }
    });

    // 建立掛單
    document.getElementById('addOrderForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData);
        data.target_price = parseFloat(data.target_price);
        data.token_id = parseInt(data.token_id);

        try {
            await fetch(`${API_BASE}/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });

            closeModal('addOrderModal');
            e.target.reset();
            loadOrders();
            showNotification('掛單建立成功', 'success');
        } catch (error) {
            showNotification('建立失敗: ' + error.message, 'error');
        }
    });

    // 建立提醒
    document.getElementById('addAlertForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData);
        data.token_id = parseInt(data.token_id);

        // 處理市值提醒：需要將 K/M 轉換為實際數值
        if (data.alert_type === 'marketcap') {
            let targetValue = parseFloat(data.target_price);
            const originalValue = targetValue;
            const unit = data.unit || '';

            if (unit === 'K') {
                targetValue = targetValue * 1000;
            } else if (unit === 'M') {
                targetValue = targetValue * 1000000;
            }

            data.target_price = targetValue;
            console.log(`📊 市值提醒: ${originalValue}${unit} → ${targetValue}`);
        } else {
            data.target_price = parseFloat(data.target_price);
            // 價格提醒不需要 unit
            delete data.unit;
            console.log(`💰 價格提醒: ${data.target_price}`);
        }

        console.log('提交數據:', data);

        try {
            await fetch(`${API_BASE}/alerts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });

            closeModal('addAlertModal');
            e.target.reset();
            // 重置顯示
            document.getElementById('currentDataDisplay').style.display = 'none';
            document.getElementById('unitSelect').style.display = 'none';
            loadAlerts();
            showNotification('提醒建立成功', 'success');
        } catch (error) {
            showNotification('建立失敗: ' + error.message, 'error');
        }
    });
}

// 載入初始數據
async function loadInitialData() {
    await loadStatus();
    await loadTokens();
}

// 載入系統狀態
async function loadStatus() {
    try {
        const response = await fetch(`${API_BASE}/status`);
        const result = await response.json();

        if (result.success) {
            const stats = result.data;
            document.getElementById('stats').textContent =
                `代幣: ${stats.tokens} | 活躍訂單: ${stats.activeOrders} | 活躍提醒: ${stats.activeAlerts}`;
        }
    } catch (error) {
        console.error('載入狀態失敗:', error);
    }
}

// 載入代幣列表
async function loadTokens() {
    try {
        const response = await fetch(`${API_BASE}/tokens`);
        const result = await response.json();

        if (result.success) {
            state.tokens = result.data;
            renderTokens();
            updateTokenSelects();
        }
    } catch (error) {
        console.error('載入代幣失敗:', error);
    }
}

function renderTokens() {
    const container = document.getElementById('tokensList');

    if (state.tokens.length === 0) {
        container.innerHTML = '<div class="empty-state">尚無代幣，請點擊右上角添加</div>';
        return;
    }

    container.innerHTML = state.tokens.map(token => `
        <div class="card">
            <div class="card-header">
                <div class="card-title">${token.symbol}</div>
                <span class="badge ${token.chain}">${token.chain.toUpperCase()}</span>
            </div>
            <div class="card-body">
                <div class="info-row">
                    <span class="info-label">地址</span>
                    <span class="info-value">${shortenAddress(token.address)}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">精度</span>
                    <span class="info-value">${token.decimals}</span>
                </div>
                ${token.pair_address ? `
                <div class="info-row">
                    <span class="info-label">交易對</span>
                    <span class="info-value">${shortenAddress(token.pair_address)}</span>
                </div>
                ` : ''}
            </div>
            <div class="card-actions">
                <button class="btn btn-danger" onclick="deleteToken(${token.id})">刪除</button>
            </div>
        </div>
    `).join('');
}

// 載入訂單列表
async function loadOrders() {
    try {
        const response = await fetch(`${API_BASE}/orders`);
        const result = await response.json();

        if (result.success) {
            state.orders = result.data;
            renderOrders();
        }
    } catch (error) {
        console.error('載入訂單失敗:', error);
    }
}

function renderOrders() {
    const container = document.getElementById('ordersList');

    if (state.orders.length === 0) {
        container.innerHTML = '<div class="empty-state">尚無掛單，請點擊右上角建立</div>';
        return;
    }

    container.innerHTML = state.orders.map(order => `
        <div class="card">
            <div class="card-header">
                <div class="card-title">${order.symbol}</div>
                <span class="badge ${order.status}">${getStatusText(order.status)}</span>
            </div>
            <div class="card-body">
                <div class="info-row">
                    <span class="info-label">類型</span>
                    <span class="info-value">${getOrderTypeText(order.type)}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">目標價格</span>
                    <span class="info-value">${order.target_price}</span>
                </div>
                ${order.current_price ? `
                <div class="info-row">
                    <span class="info-label">當前價格</span>
                    <span class="info-value">${order.current_price}</span>
                </div>
                ` : ''}
                <div class="info-row">
                    <span class="info-label">建立時間</span>
                    <span class="info-value">${formatDate(order.created_at)}</span>
                </div>
            </div>
            ${order.status === 'active' ? `
            <div class="card-actions">
                <button class="btn btn-danger" onclick="cancelOrder(${order.id})">取消</button>
            </div>
            ` : ''}
        </div>
    `).join('');
}

// 載入提醒列表
async function loadAlerts() {
    try {
        const response = await fetch(`${API_BASE}/alerts`);
        const result = await response.json();

        if (result.success) {
            state.alerts = result.data;
            renderAlerts();
        }
    } catch (error) {
        console.error('載入提醒失敗:', error);
    }
}

function renderAlerts() {
    const container = document.getElementById('alertsList');

    if (state.alerts.length === 0) {
        container.innerHTML = '<div class="empty-state">尚無提醒，請點擊右上角建立</div>';
        return;
    }

    container.innerHTML = state.alerts.map(alert => {
        const alertType = alert.alert_type || 'price';
        const isMarketCap = alertType === 'marketcap';

        // 格式化目標值
        let targetValueDisplay = alert.target_price;
        if (isMarketCap) {
            const unit = alert.unit || '';
            if (unit === 'K') {
                targetValueDisplay = `${(alert.target_price / 1000).toFixed(2)}K`;
            } else if (unit === 'M') {
                targetValueDisplay = `${(alert.target_price / 1000000).toFixed(2)}M`;
            } else {
                targetValueDisplay = `$${formatNumber(alert.target_price)}`;
            }
        } else {
            targetValueDisplay = `$${alert.target_price.toFixed(8)}`;
        }

        return `
        <div class="card">
            <div class="card-header">
                <div class="card-title">${alert.symbol}</div>
                <span class="badge ${alert.status}">${getStatusText(alert.status)}</span>
            </div>
            <div class="card-body">
                <div class="info-row">
                    <span class="info-label">類型</span>
                    <span class="info-value">${isMarketCap ? '💎 市值' : '💰 價格'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">條件</span>
                    <span class="info-value">${getConditionText(alert.condition)}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">目標${isMarketCap ? '市值' : '價格'}</span>
                    <span class="info-value">${targetValueDisplay}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">建立時間</span>
                    <span class="info-value">${formatDate(alert.created_at)}</span>
                </div>
            </div>
            ${alert.status === 'active' ? `
            <div class="card-actions">
                <button class="btn btn-danger" onclick="cancelAlert(${alert.id})">取消</button>
            </div>
            ` : ''}
        </div>
    `;
    }).join('');
}

// 載入價格
async function loadPrices() {
    const container = document.getElementById('pricesList');
    container.innerHTML = '<div class="loading">載入中...</div>';

    try {
        const tokens = state.tokens;
        const pricePromises = tokens.map(async token => {
            try {
                let url = `${API_BASE}/price/${token.chain}/${token.address}?decimals=${token.decimals}`;
                if (token.pair_address) {
                    url += `&pairAddress=${token.pair_address}`;
                }

                const response = await fetch(url);
                const result = await response.json();

                if (result.success) {
                    return {
                        token,
                        priceUSD: result.data.priceUSD,
                        marketCap: result.data.marketCap,
                        marketCapFormatted: result.data.marketCapFormatted,
                        totalSupply: result.data.totalSupply
                    };
                }
                return { token, error: 'Failed to fetch price' };
            } catch (error) {
                return { token, error: error.message };
            }
        });

        const prices = await Promise.all(pricePromises);
        renderPrices(prices);
    } catch (error) {
        container.innerHTML = '<div class="empty-state">載入價格失敗</div>';
    }
}

function renderPrices(prices) {
    const container = document.getElementById('pricesList');

    if (prices.length === 0) {
        container.innerHTML = '<div class="empty-state">請先添加代幣</div>';
        return;
    }

    container.innerHTML = prices.map(({ token, priceUSD, marketCapFormatted, totalSupply, error }) => `
        <div class="card">
            <div class="card-header">
                <div class="card-title">${token.symbol}</div>
                <span class="badge ${token.chain}">${token.chain.toUpperCase()}</span>
            </div>
            <div class="card-body">
                ${priceUSD !== undefined ? `
                    <div class="price-large">$${formatPrice(priceUSD)}</div>
                    <div style="text-align: center; color: #10b981; font-size: 0.9rem; margin-top: 8px; font-weight: 500;">
                        市值: ${marketCapFormatted}
                    </div>
                    <div style="text-align: center; color: #6c757d; margin-top: 5px; font-size: 0.85rem;">
                        總供應量: ${formatNumber(totalSupply)}
                    </div>
                ` : `
                    <div style="color: #ef4444;">錯誤: ${error}</div>
                `}
            </div>
        </div>
    `).join('');
}

// Modal 操作
function openAddTokenModal() {
    document.getElementById('addTokenModal').classList.add('active');
}

function openAddOrderModal() {
    if (state.tokens.length === 0) {
        showNotification('請先添加代幣', 'error');
        return;
    }
    document.getElementById('addOrderModal').classList.add('active');
}

function openAddAlertModal() {
    if (state.tokens.length === 0) {
        showNotification('請先添加代幣', 'error');
        return;
    }
    document.getElementById('addAlertModal').classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// 更新下拉選單
function updateTokenSelects() {
    const orderSelect = document.getElementById('orderTokenSelect');
    const alertSelect = document.getElementById('alertTokenSelect');

    const options = state.tokens.map(token =>
        `<option value="${token.id}">${token.symbol} (${token.chain.toUpperCase()})</option>`
    ).join('');

    orderSelect.innerHTML = '<option value="">請選擇代幣</option>' + options;
    alertSelect.innerHTML = '<option value="">請選擇代幣</option>' + options;
}

// 刪除操作
async function deleteToken(id) {
    if (!confirm('確定要刪除此代幣嗎？')) return;

    try {
        await fetch(`${API_BASE}/tokens/${id}`, { method: 'DELETE' });
        loadTokens();
        showNotification('代幣已刪除', 'success');
    } catch (error) {
        showNotification('刪除失敗', 'error');
    }
}

async function cancelOrder(id) {
    try {
        await fetch(`${API_BASE}/orders/${id}/cancel`, { method: 'PATCH' });
        loadOrders();
        showNotification('訂單已取消', 'success');
    } catch (error) {
        showNotification('取消失敗', 'error');
    }
}

async function cancelAlert(id) {
    try {
        await fetch(`${API_BASE}/alerts/${id}/cancel`, { method: 'PATCH' });
        loadAlerts();
        showNotification('提醒已取消', 'success');
    } catch (error) {
        showNotification('取消失敗', 'error');
    }
}

// 刷新價格
async function refreshPrices() {
    await loadPrices();
    showNotification('價格已更新', 'success');
}

// 工具函數
function shortenAddress(address) {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatDate(dateString) {
    // 資料庫存的已經是台灣時間字串，直接顯示即可
    if (!dateString) return '';
    // 如果是完整的日期時間格式 (YYYY-MM-DD HH:mm:ss)，直接返回
    if (dateString.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
        return dateString;
    }
    // 如果是其他格式，轉換為台灣時間
    return new Date(dateString).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
}

function formatPrice(price) {
    if (price < 0.000001) {
        return price.toExponential(4);
    }
    return price.toFixed(8);
}

function formatNumber(num) {
    if (num >= 1_000_000_000) {
        return (num / 1_000_000_000).toFixed(2) + 'B';
    } else if (num >= 1_000_000) {
        return (num / 1_000_000).toFixed(2) + 'M';
    } else if (num >= 1_000) {
        return (num / 1_000).toFixed(2) + 'K';
    }
    return num.toFixed(2);
}

function getOrderTypeText(type) {
    const types = {
        'limit_buy': '限價買入',
        'limit_sell': '限價賣出',
        'stop_loss': '止損',
        'take_profit': '止盈',
    };
    return types[type] || type;
}

function getConditionText(condition) {
    const conditions = {
        'above': '價格高於',
        'below': '價格低於',
        'change_up': '上漲',
        'change_down': '下跌',
    };
    return conditions[condition] || condition;
}

function getStatusText(status) {
    const statuses = {
        'active': '活躍',
        'executed': '已執行',
        'cancelled': '已取消',
        'triggered': '已觸發',
    };
    return statuses[status] || status;
}

function showNotification(message, type = 'info') {
    // 簡單的通知實現
    alert(message);
}

// 自動刷新
function startAutoRefresh() {
    setInterval(async () => {
        await loadStatus();

        // 如果在訂單或提醒頁面，自動刷新
        const activeTab = document.querySelector('.tab-btn.active').dataset.tab;
        if (activeTab === 'orders') {
            await loadOrders();
        } else if (activeTab === 'alerts') {
            await loadAlerts();
        }
    }, 30000); // 每 30 秒
}

// 點擊 modal 外部關閉
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('active');
    }
});

// 處理 Alert 類型改變（價格 / 市值）
async function onAlertTypeChange(type) {
    const targetLabel = document.getElementById('targetLabel');
    const unitSelect = document.getElementById('unitSelect');
    const targetInput = document.getElementById('targetPriceInput');

    if (type === 'marketcap') {
        targetLabel.textContent = '目標市值:';
        unitSelect.style.display = 'block';
        targetInput.placeholder = '輸入數字，選擇 K 或 M';
    } else {
        targetLabel.textContent = '目標價格:';
        unitSelect.style.display = 'none';
        targetInput.placeholder = '';
    }

    // 如果已選擇代幣，更新當前數據顯示
    const tokenId = document.getElementById('alertTokenSelect').value;
    if (tokenId) {
        await onAlertTokenChange(tokenId);
    }
}

// 處理代幣選擇改變
async function onAlertTokenChange(tokenId) {
    if (!tokenId) {
        document.getElementById('currentDataDisplay').style.display = 'none';
        return;
    }

    const alertType = document.getElementById('alertTypeSelect').value;
    const currentDataDisplay = document.getElementById('currentDataDisplay');
    const currentDataText = document.getElementById('currentDataText');
    const targetInput = document.getElementById('targetPriceInput');

    // 顯示載入中
    currentDataDisplay.style.display = 'block';
    currentDataText.textContent = '載入中...';

    try {
        // 獲取市場數據
        const response = await fetch(`${API_BASE}/market/${tokenId}`);
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error);
        }

        const data = result.data;

        if (alertType === 'price') {
            // 顯示當前價格
            currentDataText.innerHTML = `
                💰 當前價格: <strong>${data.formattedPrice}</strong>
            `;
            // 自動填入當前價格
            targetInput.value = data.price.toFixed(8);
        } else {
            // 顯示當前市值
            if (data.marketCap) {
                const marketCapK = data.marketCapK;
                const marketCapM = data.marketCapM;
                currentDataText.innerHTML = `
                    📊 當前市值: <strong>${data.formattedMarketCap}</strong>
                    <br><small>(${marketCapK}K 或 ${marketCapM}M)</small>
                `;
                // 自動填入當前市值（預設使用 K）
                targetInput.value = marketCapK;
            } else {
                currentDataText.innerHTML = `
                    ⚠️ 無法獲取市值資訊
                `;
                targetInput.value = '';
            }
        }
    } catch (error) {
        currentDataText.textContent = `錯誤: ${error.message}`;
        targetInput.value = '';
    }
}

// ==================== GMGN 監控功能 ====================

// 載入 GMGN 數據
async function loadGMGNData(checkForNew = false) {
    await Promise.all([
        loadGMGNStatus(),
        loadGMGNStatistics(),
        loadGMGNTokens(checkForNew)
    ]);
}

// GMGN 自動刷新（每 5 秒檢查一次）
function startGMGNAutoRefresh() {
    // 請求桌面通知權限
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                console.log('✅ 桌面通知已啟用');
            }
        });
    }

    // 每 5 秒自動檢查一次
    setInterval(async () => {
        // 只在 GMGN 標籤頁時檢查，並且監控已啟動
        const gmgnTab = document.getElementById('gmgn');
        if (gmgnTab && gmgnTab.classList.contains('active')) {
            try {
                // 檢查監控是否啟動
                const statusResponse = await axios.get(`${API_BASE}/gmgn/status`);
                if (statusResponse.data.data.isMonitoring) {
                    await loadGMGNStatistics();
                    await loadGMGNTokens(true);  // 檢查新代幣
                }
            } catch (error) {
                console.error('自動刷新失敗:', error);
            }
        }
    }, 500);  // 5 秒
}

// 獲取監控狀態
async function loadGMGNStatus() {
    try {
        const response = await axios.get(`${API_BASE}/gmgn/status`);
        const { isMonitoring, hasAuthToken } = response.data.data;

        const statusEl = document.getElementById('gmgnStatus');
        const authEl = document.getElementById('gmgnAuthStatus');
        const toggleBtn = document.getElementById('gmgnToggleBtn');
        const toggleText = document.getElementById('gmgnToggleText');

        // 更新狀態顯示
        if (isMonitoring) {
            statusEl.textContent = '● 運行中';
            statusEl.className = 'status-indicator active';
            toggleText.textContent = '停止監控';
            toggleBtn.className = 'btn btn-danger';
        } else {
            statusEl.textContent = '● 未啟動';
            statusEl.className = 'status-indicator';
            toggleText.textContent = '啟動監控';
            toggleBtn.className = 'btn btn-primary';
        }

        // 更新 Auth Token 狀態
        if (hasAuthToken) {
            authEl.textContent = 'Auth Token: 已設置 ✓';
            authEl.style.color = '#27ae60';
        } else {
            authEl.textContent = 'Auth Token: 未設置 ✗';
            authEl.style.color = '#e74c3c';
        }
    } catch (error) {
        console.error('載入 GMGN 狀態失敗:', error);
    }
}

// 獲取統計信息
async function loadGMGNStatistics() {
    try {
        const response = await axios.get(`${API_BASE}/gmgn/statistics`);
        const stats = response.data.data;

        document.getElementById('statsTotal').textContent = stats.total_monitored || 0;
        document.getElementById('statsLastHour').textContent = stats.last_hour || 0;
        document.getElementById('statsLast24h').textContent = stats.last_24h || 0;
        document.getElementById('statsFiltered').textContent = stats.filtered_high_holder || 0;
    } catch (error) {
        console.error('載入統計信息失敗:', error);
    }
}

// 獲取已監控的代幣列表
async function loadGMGNTokens(checkForNew = false) {
    try {
        const response = await axios.get(`${API_BASE}/gmgn/tokens?limit=50`);
        const tokens = response.data.data;

        // 檢查是否有新代幣（僅在自動刷新時）
        if (checkForNew && tokens.length > 0) {
            // 只計算未被過濾的代幣
            const validTokens = tokens.filter(t => {
                // 檢查基本條件
                if (!t.top_10_holder_rate || t.top_10_holder_rate > 0.4) return false;
                if (t.entrapment_ratio && t.entrapment_ratio > 0.4) return false;
                if (t.rat_trader_amount_rate && t.rat_trader_amount_rate > 0.4) return false;
                return true;
            });

            console.log(`📊 目前符合條件代幣數: ${validTokens.length}, 上次: ${state.lastGMGNTokenCount}`);
            console.log(`   總代幣數: ${tokens.length}`);

            if (state.lastGMGNTokenCount > 0 && validTokens.length > state.lastGMGNTokenCount) {
                // 有新的符合條件的代幣！
                const newCount = validTokens.length - state.lastGMGNTokenCount;
                console.log(`🎉🎉🎉 發現 ${newCount} 個新代幣！準備播放音效...`);

                // 立即播放音效
                try {
                    playNotificationSound();
                    console.log('✅ 音效播放成功');
                } catch (error) {
                    console.error('❌ 音效播放失敗:', error);
                }

                // 顯示桌面通知（如果用戶允許）
                if ('Notification' in window && Notification.permission === 'granted') {
                    new Notification('🚀 發現新代幣！', {
                        body: `發現 ${newCount} 個符合條件的新 BSC 代幣`,
                        icon: '/favicon.ico'
                    });
                }
            }
            state.lastGMGNTokenCount = validTokens.length;
        } else if (!checkForNew && tokens.length > 0) {
            // 首次載入時初始化計數
            const validTokens = tokens.filter(t => {
                if (!t.top_10_holder_rate || t.top_10_holder_rate > 0.4) return false;
                if (t.entrapment_ratio && t.entrapment_ratio > 0.4) return false;
                if (t.rat_trader_amount_rate && t.rat_trader_amount_rate > 0.4) return false;
                return true;
            });
            state.lastGMGNTokenCount = validTokens.length;
            console.log(`🎯 初始化代幣計數: ${validTokens.length} / ${tokens.length}`);
        }

        renderGMGNTokens(tokens);
    } catch (error) {
        console.error('載入 GMGN 代幣列表失敗:', error);
        document.getElementById('gmgnTokensList').innerHTML = '<p class="empty">載入失敗</p>';
    }
}

// 渲染代幣列表
function renderGMGNTokens(tokens) {
    const container = document.getElementById('gmgnTokensList');

    if (tokens.length === 0) {
        container.innerHTML = '<p class="empty">尚無發現新代幣</p>';
        return;
    }

    container.innerHTML = tokens.map(token => `
        <div class="card">
            <div class="card-header">
                <div>
                    <strong>${token.symbol}</strong> - ${token.name}
                    <span class="badge ${token.top_10_holder_rate > 0.4 ? 'badge-danger' : 'badge-success'}">
                        ${token.top_10_holder_rate > 0.4 ? '已過濾' : '✓'}
                    </span>
                </div>
                <span class="timestamp">${new Date(token.first_seen_at).toLocaleString('zh-TW')}</span>
            </div>
            <div class="card-body">
                <p><strong>地址:</strong> <code>${token.address}</code></p>
                <div class="stats-grid">
                    <div>
                        <small>市值</small>
                        <strong>$${(token.market_cap || 0).toLocaleString()}</strong>
                    </div>
                    <div>
                        <small>流動性</small>
                        <strong>$${(token.liquidity || 0).toLocaleString()}</strong>
                    </div>
                    <div>
                        <small>持有者</small>
                        <strong>${token.holder_count || 0}</strong>
                    </div>
                    <div>
                        <small>前10持倉率</small>
                        <strong class="${token.top_10_holder_rate > 0.4 ? 'text-danger' : ''}">
                            ${(token.top_10_holder_rate * 100).toFixed(2)}%
                        </strong>
                    </div>
                </div>
                ${token.launchpad || token.exchange ? `
                    <p style="margin-top: 10px;">
                        ${token.launchpad ? `<span class="badge">📱 ${token.launchpad}</span>` : ''}
                        ${token.exchange ? `<span class="badge">💱 ${token.exchange}</span>` : ''}
                    </p>
                ` : ''}
                <div class="safety-indicators">
                    <span class="badge ${token.open_source === 'yes' ? 'badge-success' : 'badge-warning'}">
                        開源: ${token.open_source || 'N/A'}
                    </span>
                    <span class="badge ${token.owner_renounced === 'yes' ? 'badge-success' : 'badge-warning'}">
                        放棄所有權: ${token.owner_renounced || 'N/A'}
                    </span>
                    <span class="badge ${token.is_honeypot === 'no' ? 'badge-success' : 'badge-danger'}">
                        蜜罐: ${token.is_honeypot || 'N/A'}
                    </span>
                </div>
            </div>
        </div>
    `).join('');
}

// 切換監控狀態
async function toggleGMGNMonitoring() {
    try {
        const statusResponse = await axios.get(`${API_BASE}/gmgn/status`);
        const currentStatus = statusResponse.data.data.isMonitoring;
        const hasAuthToken = statusResponse.data.data.hasAuthToken;

        if (!hasAuthToken && !currentStatus) {
            showNotification('請先設置 Auth Token', 'warning');
            return;
        }

        const response = await axios.post(`${API_BASE}/gmgn/toggle`, {
            enabled: !currentStatus
        });

        if (response.data.success) {
            showNotification(`監控已${!currentStatus ? '啟動' : '停止'}`, 'success');
            await loadGMGNStatus();
        }
    } catch (error) {
        console.error('切換監控失敗:', error);
        showNotification('操作失敗: ' + error.message, 'error');
    }
}

// 立即檢查
async function checkGMGNNow() {
    try {
        showNotification('正在檢查...', 'info');
        const response = await axios.post(`${API_BASE}/gmgn/check-now`);

        if (response.data.success) {
            const result = response.data.data;
            if (result.checked) {
                showNotification(`檢查完成！發現 ${result.new || 0} 個新代幣，過濾 ${result.filtered || 0} 個`, 'success');
                await loadGMGNData();
            } else {
                showNotification('檢查失敗: ' + (result.reason || '未知錯誤'), 'warning');
            }
        }
    } catch (error) {
        console.error('立即檢查失敗:', error);
        showNotification('檢查失敗: ' + error.message, 'error');
    }
}

// 刷新代幣列表
async function refreshGMGNTokens() {
    await loadGMGNData();
    showNotification('已刷新', 'success');
}

// 打開 Auth Token 模態框
function openAuthTokenModal() {
    document.getElementById('authTokenModal').style.display = 'flex';
}

// 關閉 Auth Token 模態框
function closeAuthTokenModal() {
    document.getElementById('authTokenModal').style.display = 'none';
    document.getElementById('authTokenForm').reset();
}

// 設定 Auth Token 表單
document.addEventListener('DOMContentLoaded', () => {
    const authTokenForm = document.getElementById('authTokenForm');
    if (authTokenForm) {
        authTokenForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const token = formData.get('token').trim();

            try {
                const response = await axios.post(`${API_BASE}/gmgn/auth-token`, { token });
                if (response.data.success) {
                    showNotification('Auth Token 已設置', 'success');
                    closeAuthTokenModal();
                    await loadGMGNStatus();
                }
            } catch (error) {
                console.error('設置 Auth Token 失敗:', error);
                showNotification('設置失敗: ' + error.message, 'error');
            }
        });
    }
});

// ==================== 錢包餘額功能 ====================

// 載入錢包餘額歷史
async function loadWalletBalance() {
    try {
        const response = await axios.get(`${API_BASE}/wallet/balance/history?limit=100`);
        if (response.data.success) {
            renderWalletBalance(response.data.data);
        }

        // 載入即時餘額
        const latestResponse = await axios.get(`${API_BASE}/wallet/balance/latest`);
        if (latestResponse.data.success && latestResponse.data.data) {
            renderLatestBalance(latestResponse.data.data);
        }

        // 載入上次記錄
        const lastRecordResponse = await axios.get(`${API_BASE}/wallet/balance/latest-history`);
        if (lastRecordResponse.data.success && lastRecordResponse.data.data) {
            renderLastRecord(lastRecordResponse.data.data);
        } else {
            document.getElementById('lastRecordContent').innerHTML = '<p class="no-data">尚無記錄</p>';
        }
    } catch (error) {
        console.error('載入錢包餘額失敗:', error);
        showNotification('載入錢包餘額失敗', 'error');
    }
}

// 渲染即時餘額
function renderLatestBalance(balance) {
    const container = document.getElementById('latestBalanceContent');
    if (!balance) {
        container.innerHTML = '<p class="no-data">無法獲取</p>';
        return;
    }

    const balanceUSD = balance.balance_usd ? `≈ $${formatNumber(balance.balance_usd)}` : '';
    container.innerHTML = `
        <div class="balance-display">
            <div class="balance-amount">
                <span class="balance-number">${Number(balance.balance).toFixed(6)}</span>
                <span class="balance-symbol">BNB</span>
            </div>
            ${balanceUSD ? `<div class="balance-usd">${balanceUSD}</div>` : ''}
            <div class="balance-time">查詢時間：${formatDate(balance.timestamp)}</div>
        </div>
    `;
}

// 渲染上次記錄
function renderLastRecord(record) {
    const container = document.getElementById('lastRecordContent');
    if (!record) {
        container.innerHTML = '<p class="no-data">尚無記錄</p>';
        return;
    }

    const balanceUSD = record.balance_usd ? `≈ $${formatNumber(record.balance_usd)}` : '';
    container.innerHTML = `
        <div class="last-record-display">
            <div class="record-row">
                <span class="record-label">餘額：</span>
                <span class="record-value">${Number(record.balance).toFixed(6)} BNB</span>
            </div>
            ${balanceUSD ? `
            <div class="record-row">
                <span class="record-label">價值：</span>
                <span class="record-value">${balanceUSD}</span>
            </div>
            ` : ''}
            <div class="record-row">
                <span class="record-label">時間：</span>
                <span class="record-value">${formatDate(record.timestamp)}</span>
            </div>
        </div>
    `;
}

// 渲染錢包餘額列表
function renderWalletBalance(balances) {
    const container = document.getElementById('walletBalanceList');

    if (balances.length === 0) {
        container.innerHTML = '<p class="no-data">尚無餘額記錄</p>';
        return;
    }

    container.innerHTML = balances.map(balance => {
        const balanceUSD = balance.balance_usd ? `≈ $${formatNumber(balance.balance_usd)}` : '';
        return `
            <div class="card balance-card">
                <div class="balance-header">
                    <span class="balance-chain">${balance.chain}</span>
                    <span class="balance-date">${formatDate(balance.timestamp)}</span>
                </div>
                <div class="balance-info">
                    <div class="balance-main">
                        <span class="balance-value">${Number(balance.balance).toFixed(6)} BNB</span>
                        ${balanceUSD ? `<span class="balance-usd-small">${balanceUSD}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// 立即記錄餘額
async function recordBalanceNow() {
    try {
        showNotification('正在記錄餘額...', 'info');
        const response = await axios.post(`${API_BASE}/wallet/balance/record`);
        if (response.data.success) {
            showNotification('✅ 餘額記錄成功', 'success');
            await loadWalletBalance();
        }
    } catch (error) {
        console.error('記錄餘額失敗:', error);
        showNotification('記錄餘額失敗: ' + error.message, 'error');
    }
}

// 刷新錢包餘額
async function refreshWalletBalance() {
    await loadWalletBalance();
    showNotification('已刷新', 'success');
}
