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
                this.loadTickerPrices(),
                this.loadStatsData()
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
            
            // 更新总权益
            const totalEquityEl = document.getElementById('total-equity');
            if (totalEquityEl) {
                totalEquityEl.textContent = totalEquity.toFixed(2) + ' USDT';
            }
            
            // 更新总权益（美元显示）
            const totalEquityUsdEl = document.getElementById('total-equity-usd');
            if (totalEquityUsdEl) {
                totalEquityUsdEl.textContent = '≈ $' + totalEquity.toFixed(2);
            }
            
            // 计算保证金比率（使用后端返回的精确值）
            const marginRatio = data.marginRatio || 0;
            
            // 更新保证金比率
            const marginRatioEl = document.getElementById('margin-ratio');
            if (marginRatioEl) {
                marginRatioEl.textContent = marginRatio.toFixed(2) + '%';
                // 根据比率设置颜色
                if (marginRatio < 50) {
                    marginRatioEl.className = 'risk-metric-value';
                    marginRatioEl.style.color = 'var(--accent-green)';
                } else if (marginRatio < 80) {
                    marginRatioEl.className = 'risk-metric-value';
                    marginRatioEl.style.color = 'var(--accent-yellow)';
                } else {
                    marginRatioEl.className = 'risk-metric-value';
                    marginRatioEl.style.color = 'var(--accent-red)';
                }
            }
            
            // 更新风险状态徽章
            // const riskBadgeEl = document.getElementById('risk-badge');
            // if (riskBadgeEl) {
            //     if (marginRatio < 50) {
            //         riskBadgeEl.textContent = '安全';
            //         riskBadgeEl.className = 'risk-status-badge safe';
            //     } else if (marginRatio < 80) {
            //         riskBadgeEl.textContent = '警惕';
            //         riskBadgeEl.className = 'risk-status-badge warning';
            //     } else {
            //         riskBadgeEl.textContent = '危险';
            //         riskBadgeEl.className = 'risk-status-badge danger';
            //     }
            // }
            
            // 更新可用余额（使用availableBalance字段）
            const availableBalanceEl = document.getElementById('available-balance');
            if (availableBalanceEl) {
                const availableBalance = data.availableBalance || data.totalBalance;
                availableBalanceEl.textContent = availableBalance.toFixed(2) + ' USDT';
            }
            
            // 更新未实现盈亏（带符号和颜色）
            const unrealisedPnlEl = document.getElementById('unrealised-pnl');
            if (unrealisedPnlEl) {
                const pnlValue = (data.unrealisedPnl >= 0 ? '+' : '') + data.unrealisedPnl.toFixed(2) + ' USDT';
                unrealisedPnlEl.textContent = pnlValue;
                unrealisedPnlEl.className = 'risk-metric-value pnl ' + (data.unrealisedPnl >= 0 ? 'positive' : 'negative');
            }
            
            // 更新风险状态条
            const riskStatusBarEl = document.getElementById('risk-status-bar');
            const riskIconEl = document.getElementById('risk-icon');
            const riskStatusLabelEl = document.getElementById('risk-status-label');
            
            if (riskStatusBarEl && riskIconEl && riskStatusLabelEl) {
                // 移除之前的状态类
                riskStatusBarEl.classList.remove('safe', 'warning', 'danger');
                
                if (marginRatio < 50) {
                    riskStatusBarEl.classList.add('safe');
                    riskIconEl.textContent = '✅';
                    riskStatusLabelEl.textContent = '风险状态: 安全';
                } else if (marginRatio < 80) {
                    riskStatusBarEl.classList.add('warning');
                    riskIconEl.textContent = '⚠️';
                    riskStatusLabelEl.textContent = '风险状态: 警惕';
                } else {
                    riskStatusBarEl.classList.add('danger');
                    riskIconEl.textContent = '🚨';
                    riskStatusLabelEl.textContent = '风险状态: 危险';
                }
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
                    positionsBody.innerHTML = '<tr><td colspan="8" class="no-data">暂无持仓</td></tr>';
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
                    const sideText = pos.side === 'long' ? 'LONG' : 'SHORT';
                    const sideClass = pos.side === 'long' ? 'long' : 'short';
                    // 开仓倍数 = 开仓价值 / (数量 * 开仓价格)，简化为显示 leverage 字段（如果API提供）
                    // 否则计算为：开仓价值 / (可用保证金)，这里假设 leverage 可从持仓信息中获取
                    const leverage = pos.leverage || '-';
                    return `
                        <tr>
                            <td>${pos.symbol}</td>
                            <td><span class="side-badge ${sideClass}">${sideText}</span></td>
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
            // 请求更多历史记录以便能配对开仓和平仓（避免只抓到平仓或只抓到开仓）
            const response = await fetch('/api/trades?limit=200');
            const data = await response.json();
            
            if (data.error) {
                console.error('API错误:', data.error);
                return;
            }

            const container = document.getElementById('tradesContainer');
            const countEl = document.getElementById('tradesCount');
            
            if (!data.trades || data.trades.length === 0) {
                if (container) {
                    container.innerHTML = '<tr><td colspan="10" class="no-data">暂无交易记录</td></tr>';
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
                // 配对开仓和平仓交易
                const pairedTrades = [];
                const trades = [...data.trades];
                
                // 先找出所有平仓交易，然后匹配对应的开仓交易
                const closeTrades = trades.filter(t => t.type === 'close');
                
                for (const closeTrade of closeTrades) {
                    // 查找对应的开仓交易（同symbol、同side、在平仓之前）
                    const openTrade = trades.find(t => 
                        t.type === 'open' && 
                        t.symbol === closeTrade.symbol && 
                        t.side === closeTrade.side &&
                        new Date(t.timestamp) < new Date(closeTrade.timestamp) &&
                        !pairedTrades.some(pt => pt.openTrade?.id === t.id)
                    );
                    
                    if (openTrade) {
                        pairedTrades.push({
                            openTrade,
                            closeTrade,
                            timestamp: closeTrade.timestamp
                        });
                    }
                }
                
                // 按平仓时间降序排序，只显示最近25条
                pairedTrades.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                const displayTrades = pairedTrades.slice(0, 25);
                
                if (displayTrades.length === 0) {
                    container.innerHTML = '<tr><td colspan="10" class="no-data">暂无完整交易记录</td></tr>';
                } else {
                    container.innerHTML = displayTrades.map(pair => {
                        const { openTrade, closeTrade } = pair;
                        
                        // 计算持仓时间
                        const openTime = new Date(openTrade.timestamp);
                        const closeTime = new Date(closeTrade.timestamp);
                        const holdingTimeMs = closeTime - openTime;
                        const hours = Math.floor(holdingTimeMs / (1000 * 60 * 60));
                        const minutes = Math.floor((holdingTimeMs % (1000 * 60 * 60)) / (1000 * 60));
                        const holdingTimeStr = `${hours}时 ${minutes}分`;
                        
                        // 总手续费
                        const totalFees = (openTrade.fee + closeTrade.fee).toFixed(2);
                        
                        // 净盈亏
                        const netPnl = closeTrade.pnl || 0;
                        const pnlClass = netPnl >= 0 ? 'profit' : 'loss';
                        const pnlSign = netPnl >= 0 ? '+' : '';
                        
                        // 方向和币种
                        const sideText = openTrade.side === 'long' ? 'LONG' : 'SHORT';
                        const sideClass = openTrade.side === 'long' ? 'long' : 'short';
                        
                        // 杠杆
                        const leverage = openTrade.leverage || '-';
                        
                        // 平仓时间（格式化为当地时间）
                        const closeTimeStr = new Date(closeTrade.timestamp).toLocaleString('zh-CN', {
                            timeZone: 'Asia/Shanghai',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                        
                        return `
                            <tr>
                                <td>${closeTimeStr}</td>
                                <td><strong>${openTrade.symbol}</strong></td>
                                <td><span class="side-badge ${sideClass}">${sideText}</span></td>
                                <td>${leverage}x</td>
                                <td>$${openTrade.price.toFixed(2)}</td>
                                <td>$${closeTrade.price.toFixed(2)}</td>
                                <td>${openTrade.quantity.toFixed(4)}</td>
                                <td>${holdingTimeStr}</td>
                                <td>$${totalFees}</td>
                                <td class="${pnlClass}">${pnlSign}$${netPnl.toFixed(2)}</td>
                            </tr>
                        `;
                 }).join('');
                }
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

    // 工具：数值格式化与类名设置
    fmtMoney(n, digits = 2) {
        if (n === null || n === undefined || Number.isNaN(n)) return '--';
        const sign = n > 0 ? '+' : (n < 0 ? '-' : '');
        const abs = Math.abs(n).toFixed(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return sign + '$' + abs;
    }
    fmtPct(n, digits = 1) {
        if (n === null || n === undefined || Number.isNaN(n)) return '--';
        return n.toFixed(digits) + '%';
    }
    fmtSharpe(n) {
        if (n === null || n === undefined || Number.isNaN(n)) return '--';
        const d = Math.abs(n) < 1 ? 4 : 2;
        return n.toFixed(d);
    }
    fmtDuration(ms) {
        if (!ms || ms <= 0) return '--';
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        if (h > 0) return `${h}小时${m}分`;
        return `${m}分钟`;
    }
    setSignClass(el, value, baseClass) {
        if (!el) return;
        const signClass = value > 0 ? 'positive' : (value < 0 ? 'negative' : '');
        el.className = `${baseClass || el.className}`.split(' ')[0] + (signClass ? ' ' + signClass : '');
    }

    // 渲染：KPI条
    renderKpi(data) {
        const totalPnl = data.totalPnl ?? 0;
        const totalTrades = data.totalTrades ?? 0;
        const avgPnl = totalTrades > 0 ? (totalPnl / totalTrades) : null;

        const kpiTotalPnl = document.getElementById('kpi-total-pnl');
        if (kpiTotalPnl) {
            kpiTotalPnl.textContent = this.fmtMoney(totalPnl);
            this.setSignClass(kpiTotalPnl, totalPnl, 'kpi-value');
        }
        const kpiWinRate = document.getElementById('kpi-win-rate');
        if (kpiWinRate) kpiWinRate.textContent = this.fmtPct(data.winRate ?? null, 1);
        const kpiSharpe = document.getElementById('kpi-sharpe');
        if (kpiSharpe) kpiSharpe.textContent = this.fmtSharpe(data.sharpeRatio ?? null);
        const kpiTotalTrades = document.getElementById('kpi-total-trades');
        if (kpiTotalTrades) kpiTotalTrades.textContent = totalTrades;
        const kpiAvgPnl = document.getElementById('kpi-avg-pnl');
        if (kpiAvgPnl) {
            kpiAvgPnl.textContent = avgPnl === null ? '--' : this.fmtMoney(avgPnl);
            if (avgPnl !== null) this.setSignClass(kpiAvgPnl, avgPnl, 'kpi-value');
        }
        // 新增：最大回撤（负向越大越差）
        const kpiMaxDd = document.getElementById('kpi-max-dd');
        if (kpiMaxDd) {
            const dd = data.maxDrawdown; // 期望为百分比数值 0-100 或 -xx
            if (dd === null || dd === undefined || Number.isNaN(dd)) {
                kpiMaxDd.textContent = '--';
            } else {
                const val = typeof dd === 'number' ? dd : Number(dd);
                const pct = (val <= 0 ? Math.abs(val) : val).toFixed(1) + '%';
                kpiMaxDd.textContent = '-' + pct;
                kpiMaxDd.classList.add('negative');
            }
        }
    }

    // 渲染：指标栈
    renderMetrics(data) {
        const avgLevEl = document.getElementById('metric-avg-leverage');
        if (avgLevEl) avgLevEl.textContent = (data.avgLeverage ?? null) !== null ? (data.avgLeverage).toFixed(1) + 'x' : '--';

        const feesEl = document.getElementById('metric-total-fees');
        if (feesEl) feesEl.textContent = this.fmtMoney(data.totalFees ?? 0);

        const maxWinEl = document.getElementById('metric-biggest-win');
        if (maxWinEl) {
            const v = data.maxWin ?? 0;
            maxWinEl.textContent = this.fmtMoney(Math.abs(v));
            this.setSignClass(maxWinEl, v || 1, 'metric-value');
        }
        const maxLossEl = document.getElementById('metric-biggest-loss');
        if (maxLossEl) {
            const v = -(Math.abs(data.maxLoss ?? 0));
            maxLossEl.textContent = this.fmtMoney(v);
            this.setSignClass(maxLossEl, v, 'metric-value');
        }

        const avgHoldingEl = document.getElementById('metric-avg-holding');
        const avgHoldingMs = data.avgHoldingMs ?? data.averageHoldingMs ?? null;
        if (avgHoldingEl) avgHoldingEl.textContent = this.fmtDuration(avgHoldingMs);

        const pfEl = document.getElementById('metric-profit-factor');
        if (pfEl) pfEl.textContent = (data.profitFactor !== undefined && data.profitFactor !== null) ? data.profitFactor.toFixed(2) : '--';
    }

    // 渲染：方向分布与交易对偏好
    renderDistributions(data) {
        // 方向分布 - 单行显示（不再需要进度条）
        const ht = data.holdTimes || {};
        const lp = Number(ht.long || 0).toFixed(1);
        const sp = Number(ht.short || 0).toFixed(1);
        const fp = Number(ht.flat || 0).toFixed(1);
        const longVal = document.getElementById('direction-long-value');
        const shortVal = document.getElementById('direction-short-value');
        const flatVal = document.getElementById('direction-flat-value');
        if (longVal) longVal.textContent = lp + '%';
        if (shortVal) shortVal.textContent = sp + '%';
        if (flatVal) flatVal.textContent = fp + '%';

        // 交易对偏好 Top5 紧凑列表
        this.renderPairsList(data.tradingPairs || []);
    }

    renderPairsList(pairs) {
        const list = document.getElementById('pairsList');
        const concentrationEl = document.getElementById('pairs-concentration');
        if (!list) return;
        if (!pairs || pairs.length === 0) {
            list.innerHTML = '<div class="empty-state">暂无数据</div>';
            if (concentrationEl) concentrationEl.textContent = '';
            return;
        }
        // 归一化并排序
        const norm = pairs.map(p => ({ symbol: p.symbol, percentage: Number(p.percentage) || 0 }))
                          .sort((a,b) => b.percentage - a.percentage);
        const top5 = norm.slice(0, 5);
        const other = Math.max(0, 100 - top5.reduce((s, p) => s + p.percentage, 0));
        if (other > 0.5) top5.push({ symbol: 'Other', percentage: Number(other.toFixed(2)) });

        // 紧凑列表：币种 + 百分比
        list.innerHTML = top5.map(p => `
            <div class="pair-compact-item">
              <span class="pair-symbol">${p.symbol}</span>
              <span class="pair-percentage">${p.percentage.toFixed(2)}%</span>
            </div>
        `).join('');

        // HHI 集中度
        const allPercents = norm.map(p => p.percentage);
        const hhi = allPercents.reduce((s, x) => s + Math.pow(x/100, 2), 0);
        let level = '分散';
        if (hhi >= 0.25) level = '集中'; else if (hhi >= 0.15) level = '中等';
        if (concentrationEl) concentrationEl.textContent = `HHI ${hhi.toFixed(2)} · ${level}`;
    }

    // 加载交易统计数据（重写）
    async loadStatsData() {
        try {
            const response = await fetch('/api/stats');
            const data = await response.json();
            if (data.error) {
                console.error('获取统计数据失败:', data.error);
                return;
            }
            this.renderKpi(data);
            this.renderMetrics(data);
            this.renderDistributions(data);
        } catch (error) {
            console.error('加载统计数据失败:', error);
        }
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

        // 每30秒更新交易记录、日志和统计数据
        setInterval(async () => {
            await Promise.all([
                this.loadTradesData(),
                this.loadLogsData(),
                this.loadStatsData()
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