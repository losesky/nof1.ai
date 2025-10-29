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

// AI Trading Monitor - 使用真实 API
class TradingMonitor {
    constructor() {
        this.cryptoPrices = new Map();
        this.accountData = null;
        this.equityChart = null;
        this.chartTimeframe = '24'; // 固定24小时
        this.init();
    }

    async init() {
        await this.loadInitialData();
        this.initEquityChart();
        this.initTimeframeSelector();
        this.startDataUpdates();
        this.initTabs();
        this.initChat();
        this.duplicateTicker();
    }

    // 加载初始数据
    async loadInitialData() {
        try {
            await Promise.all([
                this.loadAccountData(),
                this.loadPositionsData(),
                this.loadTradesData(),
                this.loadLogsData(),
                this.loadTickerPrices()
            ]);
        } catch (error) {
            console.error('加载初始数据失败:', error);
        }
    }

    // 加载账户数据
    async loadAccountData() {
        try {
            const response = await fetch('/api/account');
            const data = await response.json();
            
            if (data.error) {
                console.error('API错误:', data.error);
                return;
            }

            this.accountData = data;
            
            // 计算总权益（总资产 + 未实现盈亏）
            const totalEquity = data.totalBalance + data.unrealisedPnl;
            
            // 更新收益率（ROI）
            const roiPercentEl = document.getElementById('roi-percent');
            if (roiPercentEl) {
                const roiPercent = ((totalEquity - data.initialBalance) / data.initialBalance) * 100;
                const roiValue = (roiPercent >= 0 ? '' : '') + roiPercent.toFixed(2) + '%';
                roiPercentEl.textContent = roiValue;
                roiPercentEl.className = roiPercent >= 0 ? 'positive' : 'negative';
            }
            
            // 更新维持保证金（估算为持仓保证金的10%，实际应从API获取）
            const maintenanceMarginEl = document.getElementById('maintenance-margin');
            if (maintenanceMarginEl) {
                const maintenanceMargin = data.positionMargin * 0.1; // 简化计算
                maintenanceMarginEl.textContent = maintenanceMargin.toFixed(4) + ' USDT';
            }
            
            // 更新保证金余额（总资产）
            const marginBalanceEl = document.getElementById('margin-balance');
            if (marginBalanceEl) {
                marginBalanceEl.textContent = data.totalBalance.toFixed(4) + ' USDT';
            }
            
            // 更新总权益
            const totalEquityEl = document.getElementById('total-equity');
            if (totalEquityEl) {
                totalEquityEl.textContent = totalEquity.toFixed(4) + ' USDT';
            }
            
            // 更新总权益（美元显示，与USDT相同）
            const totalEquityUsdEl = document.getElementById('total-equity-usd');
            if (totalEquityUsdEl) {
                totalEquityUsdEl.textContent = totalEquity.toFixed(4) + ' USDT';
            }
            
            // 更新钱包余额（总资产，不含未实现盈亏）
            const walletBalanceEl = document.getElementById('wallet-balance');
            if (walletBalanceEl) {
                walletBalanceEl.textContent = data.totalBalance.toFixed(4) + ' USDT';
            }
            
            // 更新未实现盈亏（带符号和颜色）
            const unrealisedPnlEl = document.getElementById('unrealised-pnl');
            if (unrealisedPnlEl) {
                const pnlValue = (data.unrealisedPnl >= 0 ? '' : '') + data.unrealisedPnl.toFixed(4) + ' USDT';
                unrealisedPnlEl.textContent = pnlValue;
                unrealisedPnlEl.className = 'detail-value pnl ' + (data.unrealisedPnl >= 0 ? 'positive' : 'negative');
            }
            
        } catch (error) {
            console.error('加载账户数据失败:', error);
        }
    }

    // 加载持仓数据
    async loadPositionsData() {
        try {
            const response = await fetch('/api/positions');
            const data = await response.json();
            
            if (data.error) {
                console.error('API错误:', data.error);
                return;
            }

            const positionsBody = document.getElementById('positions-body');
            
            if (!data.positions || data.positions.length === 0) {
                if (positionsBody) {
                    positionsBody.innerHTML = '<tr><td colspan="8" class="empty-state">暂无持仓</td></tr>';
                }
                return;
            }

            // 更新加密货币价格
            data.positions.forEach(pos => {
                this.cryptoPrices.set(pos.symbol, pos.currentPrice);
            });
            this.updateTickerPrices();

            // 更新持仓表格
            if (positionsBody) {
                positionsBody.innerHTML = data.positions.map(pos => {
                    const profitPercent = ((pos.unrealizedPnl / pos.openValue) * 100).toFixed(2);
                    const sideText = pos.side === 'long' ? '做多' : '做空';
                    const sideClass = pos.side === 'long' ? 'positive' : 'negative';
                    // 开仓倍数 = 开仓价值 / (数量 * 开仓价格)，简化为显示 leverage 字段（如果API提供）
                    // 否则计算为：开仓价值 / (可用保证金)，这里假设 leverage 可从持仓信息中获取
                    const leverage = pos.leverage || '-';
                    return `
                        <tr>
                            <td>${pos.symbol}</td>
                            <td class="${sideClass}">${sideText}</td>
                            <td>${leverage}x</td>
                            <td>$${pos.entryPrice.toFixed(4)}</td>
                            <td>$${pos.openValue.toFixed(2)}</td>
                            <td>$${pos.currentPrice.toFixed(4)}</td>
                            <td class="${pos.unrealizedPnl >= 0 ? 'positive' : 'negative'}">
                                ${pos.unrealizedPnl >= 0 ? '+' : ''}$${pos.unrealizedPnl.toFixed(2)}
                            </td>
                            <td class="${pos.unrealizedPnl >= 0 ? 'positive' : 'negative'}">
                                ${pos.unrealizedPnl >= 0 ? '+' : ''}${profitPercent}%
                            </td>
                        </tr>
                    `;
                }).join('');
            }
            
        } catch (error) {
            console.error('加载持仓数据失败:', error);
        }
    }

    // 加载交易记录 - 使用和 index.html 相同的布局
    async loadTradesData() {
        try {
            const response = await fetch('/api/trades?limit=10');
            const data = await response.json();
            
            if (data.error) {
                console.error('API错误:', data.error);
                return;
            }

            const container = document.getElementById('tradesContainer');
            const countEl = document.getElementById('tradesCount');
            
            if (!data.trades || data.trades.length === 0) {
                if (container) {
                    container.innerHTML = '<p class="no-data">暂无交易记录</p>';
                }
                if (countEl) {
                    countEl.textContent = '';
                }
                return;
            }
            
            if (countEl) {
                countEl.textContent = `(${data.trades.length})`;
            }
            
            if (container) {
                container.innerHTML = data.trades.map(trade => {
                    const date = new Date(trade.timestamp);
                    const timeStr = date.toLocaleString('zh-CN', {
                        timeZone: 'Asia/Shanghai',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                    });
                    
                    // 对于平仓交易，显示盈亏
                    const pnlHtml = trade.type === 'close' && trade.pnl !== null && trade.pnl !== undefined
                        ? `<div class="trade-field">
                            <span class="label">盈亏</span>
                            <span class="value ${trade.pnl >= 0 ? 'profit' : 'loss'}">${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)} USDT</span>
                           </div>`
                        : '';
                    
                    return `
                        <div class="trade-item">
                            <div class="trade-header">
                                <div class="trade-symbol">${trade.symbol}</div>
                                <div class="trade-time">${timeStr}</div>
                            </div>
                            <div class="trade-info">
                                <div class="trade-field">
                                    <span class="label">方向</span>
                                    <span class="value ${trade.side}">${trade.side === 'long' ? '做多' : trade.side === 'short' ? '做空' : '-'}</span>
                                </div>
                                <div class="trade-field">
                                    <span class="label">类型</span>
                                    <span class="value">${trade.type === 'open' ? '开仓' : '平仓'}</span>
                                </div>
                                <div class="trade-field">
                                    <span class="label">数量</span>
                                    <span class="value">${trade.quantity.toFixed(4)}</span>
                                </div>
                                <div class="trade-field">
                                    <span class="label">价格</span>
                                    <span class="value">${trade.price.toFixed(4)}</span>
                                </div>
                                <div class="trade-field">
                                    <span class="label">杠杆</span>
                                    <span class="value">${trade.leverage}x</span>
                                </div>
                                <div class="trade-field">
                                    <span class="label">手续费</span>
                                    <span class="value">${trade.fee.toFixed(4)}</span>
                                </div>
                                ${pnlHtml}
                            </div>
                        </div>
                    `;
                }).join('');
            }
            
        } catch (error) {
            console.error('加载交易记录失败:', error);
        }
    }

    // 加载 AI 决策日志 - 显示最新一条完整内容
    async loadLogsData() {
        try {
            const response = await fetch('/api/logs?limit=1');
            const data = await response.json();
            
            if (data.error) {
                console.error('API错误:', data.error);
                return;
            }

            const decisionContent = document.getElementById('decision-content');
            const decisionMeta = document.getElementById('decision-meta');
            
            if (data.logs && data.logs.length > 0) {
                const log = data.logs[0]; // 只取最新一条
                
                // 更新决策元信息
                if (decisionMeta) {
                    const timestamp = new Date(log.timestamp).toLocaleString('zh-CN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                    });
                    
                    decisionMeta.innerHTML = `
                        <span class="decision-time">${timestamp}</span>
                        <span class="decision-iteration">#${log.iteration}</span>
                    `;
                }
                
                // 更新决策详细内容
                if (decisionContent) {
                    const decision = log.decision || log.actionsTaken || '暂无决策内容';
                    // 保留换行和格式，转换为HTML
                    const formattedDecision = decision
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/\n/g, '<br>');
                    
                    decisionContent.innerHTML = `<div class="decision-text">${formattedDecision}</div>`;
                }
            } else {
                if (decisionContent) {
                    decisionContent.innerHTML = '<p class="no-data">暂无 AI 决策记录</p>';
                }
                if (decisionMeta) {
                    decisionMeta.innerHTML = '<span class="decision-time">无数据</span>';
                }
            }
            
        } catch (error) {
            console.error('加载日志失败:', error);
            const decisionContent = document.getElementById('decision-content');
            if (decisionContent) {
                decisionContent.innerHTML = `<p class="error">加载失败: ${error.message}</p>`;
            }
        }
    }

    // 加载顶部 Ticker 价格（从 API 获取）
    async loadTickerPrices() {
        try {
            const response = await fetch('/api/prices?symbols=BTC,ETH,SOL,BNB,DOGE,XRP');
            const data = await response.json();
            
            if (data.error) {
                console.error('获取价格失败:', data.error);
                return;
            }
            
            // 更新价格缓存
            Object.entries(data.prices).forEach(([symbol, price]) => {
                this.cryptoPrices.set(symbol, price);
            });
            
            // 更新显示
            this.updateTickerPrices();
        } catch (error) {
            console.error('加载 Ticker 价格失败:', error);
        }
    }

    // 更新价格滚动条
    updateTickerPrices() {
        this.cryptoPrices.forEach((price, symbol) => {
                const priceElements = document.querySelectorAll(`[data-symbol="${symbol}"]`);
                priceElements.forEach(el => {
                const decimals = price < 1 ? 4 : 2;
                el.textContent = '$' + price.toFixed(decimals);
            });
        });
    }

    // 启动数据更新
    startDataUpdates() {
        // 每3秒更新账户和持仓（实时数据）
        setInterval(async () => {
            await Promise.all([
                this.loadAccountData(),
                this.loadPositionsData()
            ]);
        }, 3000);

        // 每10秒更新价格（实时价格）
        setInterval(async () => {
            await this.loadTickerPrices();
        }, 10000);

        // 每30秒更新交易记录和日志
        setInterval(async () => {
            await Promise.all([
                this.loadTradesData(),
                this.loadLogsData()
            ]);
        }, 30000);

        // 每30秒更新资产曲线图表
        setInterval(async () => {
            await this.updateEquityChart();
        }, 30000);
    }

    // 复制ticker内容实现无缝滚动
    duplicateTicker() {
        const ticker = document.getElementById('ticker');
        if (ticker) {
            const tickerContent = ticker.innerHTML;
            ticker.innerHTML = tickerContent + tickerContent + tickerContent;
        }
    }

    // 初始化选项卡（简化版，只有一个选项卡）
    initTabs() {
        // 已经只有一个选项卡，不需要切换功能
    }

    // 初始化聊天功能（已移除）
    initChat() {
        // 聊天功能已移除
    }

    // 初始化资产曲线图表
    async initEquityChart() {
        const ctx = document.getElementById('equityChart');
        if (!ctx) {
            console.error('未找到图表canvas元素');
            return;
        }

        // 加载历史数据
        const historyData = await this.loadEquityHistory();
        
        console.log('资产历史数据:', historyData);
        
        if (!historyData || historyData.length === 0) {
            console.log('暂无历史数据，图表将在有数据后显示');
            // 显示提示信息
            const container = ctx.parentElement;
            if (container) {
                const message = document.createElement('div');
                message.className = 'no-data';
                message.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #00cc88; text-align: center;';
                message.innerHTML = '暂无历史数据<br><small style="color: #008866;">系统将每10分钟自动记录账户资产</small>';
                container.appendChild(message);
            }
            return;
        }

        // 创建图表
        this.equityChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: historyData.map(d => {
                    const date = new Date(d.timestamp);
                    return date.toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                }),
                datasets: [
                    {
                        label: '总资产 (USDT)',
                        data: historyData.map(d => parseFloat((d.totalValue + d.unrealizedPnl).toFixed(2))),
                        borderColor: 'rgb(0, 255, 170)',
                        backgroundColor: 'rgba(0, 255, 170, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            color: '#fff',
                            usePointStyle: true,
                            padding: 15
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(17, 24, 39, 0.95)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        borderColor: 'rgb(59, 130, 246)',
                        borderWidth: 1,
                        padding: 12,
                        displayColors: true,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.y !== null) {
                                    label += '$' + context.parsed.y;
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        display: true,
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#9ca3af',
                            maxRotation: 45,
                            minRotation: 0,
                            maxTicksLimit: 10
                        }
                    },
                    y: {
                        display: true,
                        position: 'left',
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#9ca3af',
                            callback: function(value) {
                                return '$' + value.toFixed(2);
                            }
                        }
                    }
                }
            }
        });
    }

    // 加载资产历史数据
    async loadEquityHistory() {
        try {
            // 固定获取最近24小时的数据
            // 假设每10分钟一个数据点，24小时 = 144个数据点
            const limit = 144;
            
            const response = await fetch(`/api/history?limit=${limit}`);
            const data = await response.json();
            
            if (data.error) {
                console.error('API错误:', data.error);
                return [];
            }
            
            return data.history || [];
        } catch (error) {
            console.error('加载资产历史数据失败:', error);
            return [];
        }
    }

    // 更新资产曲线图表
    async updateEquityChart() {
        if (!this.equityChart) {
            await this.initEquityChart();
            return;
        }

        const historyData = await this.loadEquityHistory();
        
        if (!historyData || historyData.length === 0) {
            return;
        }

        // 更新图表数据
        this.equityChart.data.labels = historyData.map(d => {
            const date = new Date(d.timestamp);
            return date.toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        });
        
        this.equityChart.data.datasets[0].data = historyData.map(d => 
            parseFloat((d.totalValue + d.unrealizedPnl).toFixed(2))
        );
        
        // 固定不显示圆点
        this.equityChart.data.datasets[0].pointRadius = 0;
        
        this.equityChart.update('none'); // 无动画更新
    }

    // 初始化时间范围选择器（已禁用切换功能）
    initTimeframeSelector() {
        // 时间范围已固定为24小时，不再支持切换
    }
}

// 初始化监控系统
document.addEventListener('DOMContentLoaded', () => {
    const monitor = new TradingMonitor();
});