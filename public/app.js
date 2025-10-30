/**
 * open-nof1.ai - AI 加密货币自动交易系统
 * Copyright (C) 2025 195440
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    loadAllData();
    
    // 每3秒刷新账户和持仓数据，实时显示变化
    setInterval(async () => {
        await Promise.all([
            loadAccountData(),
            loadPositionsData()
        ]);
        updateLastUpdateTime();
    }, 3000);
    
    // AI决策和交易历史每5分钟更新一次
    setInterval(async () => {
        await Promise.all([
            loadLogsData(),
            loadTradesData()
        ]);
    }, 5 * 60 * 1000); // 5分钟 = 300000毫秒
    
    // 移动端优化：添加触摸滚动优化
    initMobileOptimizations();
    
    // 页面可见性API - 当页面不可见时暂停更新
    initVisibilityControl();
});

// 移动端优化
function initMobileOptimizations() {
    // 防止双击缩放（仅在非输入元素上）
    let lastTouchEnd = 0;
    document.addEventListener('touchend', (event) => {
        const now = Date.now();
        if (now - lastTouchEnd <= 300) {
            // 不阻止输入框等元素的默认行为
            if (!event.target.matches('input, textarea, select')) {
                event.preventDefault();
            }
        }
        lastTouchEnd = now;
    }, { passive: false });
    
    // 移动端滚动优化 - 让浏览器自己处理滚动
    // 移除了过度优化的代码，让面板可以正常滚动
}

// 页面可见性控制
let updateInterval = null;
function initVisibilityControl() {
    let hidden, visibilityChange;
    
    if (typeof document.hidden !== "undefined") {
        hidden = "hidden";
        visibilityChange = "visibilitychange";
    } else if (typeof document.msHidden !== "undefined") {
        hidden = "msHidden";
        visibilityChange = "msvisibilitychange";
    } else if (typeof document.webkitHidden !== "undefined") {
        hidden = "webkitHidden";
        visibilityChange = "webkitvisibilitychange";
    }
    
    if (typeof document[hidden] !== "undefined") {
        document.addEventListener(visibilityChange, () => {
            if (document[hidden]) {
                // 页面隐藏时，减少更新频率或暂停
                console.log('页面隐藏，暂停更新');
            } else {
                // 页面可见时，立即更新一次
                console.log('页面可见，恢复更新');
                loadAllData();
            }
        }, false);
    }
}

// 加载所有数据
async function loadAllData() {
    await Promise.all([
        loadAccountData(),
        loadPositionsData(),
        loadLogsData(),
        loadTradesData()
    ]);
    
    updateLastUpdateTime();
}

// 加载账户数据
async function loadAccountData() {
    try {
        const response = await fetch('/api/account');
        const data = await response.json();
        
        // 计算总权益（总资产 + 未实现盈亏）
        const totalEquity = data.totalBalance + data.unrealisedPnl;
        
        // 更新收益率（ROI）
        const roiPercentEl = document.getElementById('roi-percent');
        const roiPercent = ((totalEquity - data.initialBalance) / data.initialBalance) * 100;
        const roiValue = (roiPercent >= 0 ? '' : '') + roiPercent.toFixed(2) + '%';
        updateValueWithAnimation('roi-percent', roiValue);
        if (roiPercentEl) {
            roiPercentEl.className = roiPercent >= 0 ? 'positive' : 'negative';
        }
        
        // 更新总权益
        updateValueWithAnimation('total-equity', totalEquity.toFixed(4) + ' USDT');
        
        // 更新总权益（美元显示，与USDT相同）
        updateValueWithAnimation('total-equity-usd', totalEquity.toFixed(4) + ' USDT');
        
        // 更新钱包余额（可用余额 + 持仓保证金）
        const walletBalance = data.availableBalance + data.positionMargin;
        updateValueWithAnimation('wallet-balance', walletBalance.toFixed(4) + ' USDT');
        
        // 更新未实现盈亏（带符号和颜色）
        const unrealisedPnlEl = document.getElementById('unrealised-pnl');
        const pnlValue = (data.unrealisedPnl >= 0 ? '' : '') + data.unrealisedPnl.toFixed(4) + ' USDT';
        updateValueWithAnimation('unrealised-pnl', pnlValue);
        if (unrealisedPnlEl) {
            unrealisedPnlEl.className = 'detail-value pnl ' + (data.unrealisedPnl >= 0 ? 'positive' : 'negative');
        }
        
    } catch (error) {
        console.error('加载账户数据失败:', error);
    }
}

// 带动画效果的数值更新
function updateValueWithAnimation(elementId, newValue) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    const oldValue = element.textContent;
    
    // 如果值没有变化，不更新
    if (oldValue === newValue) return;
    
    // 添加闪烁效果表示数据更新
    element.style.transition = 'background-color 0.3s ease';
    element.style.backgroundColor = 'rgba(59, 130, 246, 0.2)';
    
    // 更新数值
    element.textContent = newValue;
    
    // 恢复背景色
    setTimeout(() => {
        element.style.backgroundColor = '';
    }, 300);
}

// 加载持仓数据
async function loadPositionsData() {
    try {
        const response = await fetch('/api/positions');
        const data = await response.json();
        
        const container = document.getElementById('positionsContainer');
        const countEl = document.getElementById('positionsCount');
        
        if (!data.positions || data.positions.length === 0) {
            container.innerHTML = '<p class="no-data">当前无持仓</p>';
            countEl.textContent = '';
            return;
        }
        
        countEl.textContent = `(${data.positions.length})`;
        
        container.innerHTML = data.positions.map(pos => `
            <div class="position-item ${pos.side}">
                <div class="position-header">
                    <div class="position-symbol">${pos.symbol}</div>
                    <div class="position-side ${pos.side}">${pos.side === 'long' ? '多' : '空'}</div>
                </div>
                <div class="position-grid">
                    <div class="position-field">
                        <div class="label">数量</div>
                        <div class="value">${pos.quantity}</div>
                    </div>
                    <div class="position-field">
                        <div class="label">开仓价</div>
                        <div class="value">${pos.entryPrice.toFixed(4)}</div>
                    </div>
                    <div class="position-field">
                        <div class="label">开仓价值</div>
                        <div class="value">${pos.openValue.toFixed(2)} USDT</div>
                    </div>
                    <div class="position-field">
                        <div class="label">当前价</div>
                        <div class="value">${pos.currentPrice.toFixed(4)}</div>
                    </div>
                    <div class="position-field">
                        <div class="label">杠杆</div>
                        <div class="value">${pos.leverage}x</div>
                    </div>
                    <div class="position-field">
                        <div class="label">盈亏</div>
                        <div class="value ${pos.unrealizedPnl >= 0 ? 'positive' : 'negative'}">
                            ${(pos.unrealizedPnl >= 0 ? '+' : '')}${pos.unrealizedPnl.toFixed(2)}
                        </div>
                    </div>
                    <div class="position-field">
                        <div class="label">强平价</div>
                        <div class="value">${pos.liquidationPrice.toFixed(4)}</div>
                    </div>
                    ${pos.stopLoss ? `
                    <div class="position-field">
                        <div class="label">止损</div>
                        <div class="value">${pos.stopLoss.toFixed(4)}</div>
                    </div>
                    ` : ''}
                    ${pos.profitTarget ? `
                    <div class="position-field">
                        <div class="label">止盈</div>
                        <div class="value">${pos.profitTarget.toFixed(4)}</div>
                    </div>
                    ` : ''}
                </div>
            </div>
        `).join('');
        
    } catch (error) {
        console.error('加载持仓数据失败:', error);
    }
}

// 加载决策日志
async function loadLogsData() {
    try {
        const response = await fetch('/api/logs?limit=1');
        const data = await response.json();
        
        const container = document.getElementById('logsContainer');
        
        if (!data.logs || data.logs.length === 0) {
            container.innerHTML = '<p class="no-data">暂无决策日志</p>';
            return;
        }
        
        container.innerHTML = data.logs.map((log, index) => {
            const date = new Date(log.timestamp);
            const timeStr = date.toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            return `
                <div class="log-item">
                    <div class="log-header">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div class="log-time">${timeStr}</div>
                            <div class="log-iteration">#${log.iteration}</div>
                        </div>
                        <button class="copy-btn" onclick="copyLog(${index})" title="复制决策内容">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </button>
                    </div>
                    <div class="log-decision" id="log-decision-${index}">${log.decision}</div>
                </div>
            `;
        }).join('');
        
        // 保存日志数据供复制功能使用
        window.logsData = data.logs;
        
    } catch (error) {
        console.error('加载日志失败:', error);
    }
}

// 加载交易历史
async function loadTradesData() {
    try {
        // 获取最近25条完整的交易记录
        const response = await fetch('/api/trades?limit=50');
        const data = await response.json();
        
        const container = document.getElementById('tradesContainer');
        const countEl = document.getElementById('tradesCount');
        
        if (!data.trades || data.trades.length === 0) {
            container.innerHTML = '<tr><td colspan="10" class="no-data">暂无交易记录</td></tr>';
            countEl.textContent = '';
            return;
        }
        
        // 将交易配对（开仓+平仓）
        const completedTrades = [];
        const openTrades = new Map();
        
        // 按时间倒序处理，先遇到平仓，再找对应的开仓
        for (const trade of data.trades) {
            if (trade.type === 'close') {
                completedTrades.push({
                    closeData: trade,
                    openData: null
                });
            } else if (trade.type === 'open') {
                // 尝试匹配最近的未配对平仓
                const unmatchedClose = completedTrades.find(t => 
                    !t.openData && 
                    t.closeData.symbol === trade.symbol && 
                    t.closeData.side === trade.side
                );
                if (unmatchedClose) {
                    unmatchedClose.openData = trade;
                }
            }
        }
        
        // 只显示完整配对的交易，最多25条
        const pairedTrades = completedTrades
            .filter(t => t.openData && t.closeData)
            .slice(0, 25);
        
        if (pairedTrades.length === 0) {
            container.innerHTML = '<p class="no-data">暂无完整交易记录</p>';
            countEl.textContent = '';
            return;
        }
        
        countEl.textContent = `(${pairedTrades.length})`;
        
        // 创建表格显示
        container.innerHTML = `
            <div class="trades-table-wrapper">
                <table class="trades-table">
                    <thead>
                        <tr>
                            <th>方向</th>
                            <th>币种</th>
                            <th>开仓价格</th>
                            <th>平仓价格</th>
                            <th>数量</th>
                            <th>持仓时间</th>
                            <th>开仓价值</th>
                            <th>平仓价值</th>
                            <th>总手续费</th>
                            <th>净盈亏</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${pairedTrades.map(trade => {
                            const { openData, closeData } = trade;
                            
                            // 计算持仓时间
                            const openTime = new Date(openData.timestamp);
                            const closeTime = new Date(closeData.timestamp);
                            const holdingMs = closeTime.getTime() - openTime.getTime();
                            const holdingHours = Math.floor(holdingMs / (1000 * 60 * 60));
                            const holdingMinutes = Math.floor((holdingMs % (1000 * 60 * 60)) / (1000 * 60));
                            const holdingTimeStr = holdingHours > 0 
                                ? `${holdingHours}H ${holdingMinutes}M`
                                : `${holdingMinutes}M`;
                            
                            // 计算价值和盈亏
                            const openValue = openData.price * openData.quantity;
                            const closeValue = closeData.price * closeData.quantity;
                            const totalFee = (openData.fee || 0) + (closeData.fee || 0);
                            const netPnl = closeData.pnl || 0;
                            
                            // 方向显示
                            const sideText = openData.side === 'long' ? 'LONG' : 'SHORT';
                            const sideClass = openData.side === 'long' ? 'long' : 'short';
                            
                            return `
                                <tr class="trade-row">
                                    <td><span class="side-badge ${sideClass}">${sideText}</span></td>
                                    <td class="coin-cell">
                                        <span class="coin-icon">●</span>
                                        <span class="coin-name">${openData.symbol}</span>
                                    </td>
                                    <td>$${openData.price.toFixed(openData.price >= 1000 ? 1 : 4)}</td>
                                    <td>$${closeData.price.toFixed(closeData.price >= 1000 ? 1 : 4)}</td>
                                    <td>${openData.quantity.toFixed(2)}</td>
                                    <td>${holdingTimeStr}</td>
                                    <td>$${openValue.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</td>
                                    <td>$${closeValue.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</td>
                                    <td>$${totalFee.toFixed(2)}</td>
                                    <td class="${netPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}">
                                        ${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(2)}
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
        
    } catch (error) {
        console.error('加载交易历史失败:', error);
    }
}

// 更新最后更新时间
function updateLastUpdateTime() {
    const now = new Date();
    document.getElementById('lastUpdate').textContent = now.toLocaleTimeString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// 复制日志决策内容
function copyLog(index) {
    if (!window.logsData || !window.logsData[index]) {
        console.error('日志数据不存在');
        return;
    }
    
    const log = window.logsData[index];
    const logText = `时间: ${new Date(log.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n迭代: #${log.iteration}\n\n决策:\n${log.decision}`;
    
    navigator.clipboard.writeText(logText).then(() => {
        // 显示复制成功提示
        const btn = event.target.closest('.copy-btn');
        if (btn) {
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            btn.style.color = '#10b981';
            
            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.style.color = '';
            }, 2000);
        }
    }).catch(err => {
        console.error('复制失败:', err);
        alert('复制失败，请手动复制');
    });
}
