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

/**
 * 交易 Agent 配置（极简版）
 */
import { Agent, Memory } from "@voltagent/core";
import { LibSQLMemoryAdapter } from "@voltagent/libsql";
import { createPinoLogger } from "@voltagent/logger";
import * as tradingTools from "../tools/trading";
import { formatChinaTime } from "../utils/timeUtils";
import { RISK_PARAMS } from "../config/riskParams";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

/**
 * 账户风险配置
 */
export interface AccountRiskConfig {
  stopLossUsdt: number;
  takeProfitUsdt: number;
  syncOnStartup: boolean;
}

/**
 * 从环境变量读取账户风险配置
 */
export function getAccountRiskConfig(): AccountRiskConfig {
  return {
    stopLossUsdt: Number.parseFloat(process.env.ACCOUNT_STOP_LOSS_USDT || "50"),
    takeProfitUsdt: Number.parseFloat(process.env.ACCOUNT_TAKE_PROFIT_USDT || "10000"),
    syncOnStartup: process.env.SYNC_CONFIG_ON_STARTUP === "true",
  };
}

const logger = createPinoLogger({
  name: "trading-agent",
  level: "info",
});

/**
 * 生成交易提示词（参照 1.md 格式）
 */
export function generateTradingPrompt(data: {
  minutesElapsed: number;
  iteration: number;
  marketData: any;
  accountInfo: any;
  positions: any[];
  tradeHistory?: any[];
  recentDecisions?: any[];
}): string {
  const { minutesElapsed, iteration, marketData, accountInfo, positions, tradeHistory, recentDecisions } = data;
  const currentTime = formatChinaTime();
  
  let prompt = `您已经开始交易 ${minutesElapsed} 分钟。当前时间是 ${currentTime}，您已被调用 ${iteration} 次。下面我们为您提供各种状态数据、价格数据和预测信号，以便您发现阿尔法收益。下面还有您当前的账户信息、价值、表现、持仓等。

以下所有价格或信号数据按时间顺序排列：最旧 → 最新

时间框架说明：除非在章节标题中另有说明，否则日内序列以 3 分钟间隔提供。如果某个币种使用不同的间隔，将在该币种的章节中明确说明。

所有币种的当前市场状态
`;

  // 按照 1.md 格式输出每个币种的数据
  for (const [symbol, dataRaw] of Object.entries(marketData)) {
    const data = dataRaw as any;
    
    // 先检查数据有效性
    if (data.error) {
      prompt += `\n${symbol} 数据获取失败: ${data.error.message || '未知错误'}\n\n`;
      continue;
    }

    prompt += `\n所有 ${symbol} 数据\n`;

    // 获取最新的价格和指标数据（使用5分钟指标作为主要参考）
    const price = data.lastPrice || Number(data.ticker?.last) || null;
    const indicators = data.indicators || {};
    const ema20 = indicators.ema20;
    const macd = indicators.macd;
    const rsi = indicators.rsi14;

    // 确保所有数据都有效
    if (price && ema20 !== undefined && macd !== undefined && rsi !== undefined) {
      prompt += `当前价格 = ${price.toFixed(1)}, 当前EMA20 = ${ema20.toFixed(3)}, 当前MACD = ${macd.toFixed(3)}, 当前RSI（14周期） = ${rsi.toFixed(3)}\n\n`;
    } else {
      prompt += `市场数据不完整：${JSON.stringify({
        price: price !== null ? price.toFixed(1) : "N/A",
        ema20: ema20 !== undefined ? ema20.toFixed(3) : "N/A",
        macd: macd !== undefined ? macd.toFixed(3) : "N/A",
        rsi: rsi !== undefined ? rsi.toFixed(3) : "N/A"
      }, null, 2)}\n\n`;
    }
    
    // 资金费率
    const fundingRate = data.ticker?.fundingRate;
    if (fundingRate !== undefined && fundingRate !== null) {
      prompt += `此外，这是 ${symbol} 永续合约的最新资金费率（您交易的合约类型）：\n\n`;
      prompt += `资金费率: ${Number(fundingRate).toExponential(2)}\n\n`;
    }
    
    // 日内时序数据（3分钟级别）
    if (data.intradaySeries && data.intradaySeries.midPrices.length > 0) {
      const series = data.intradaySeries;
      prompt += `日内序列（按分钟，最旧 → 最新）：\n\n`;
      
      // 检查并格式化数据
      const midPrices = series.midPrices?.filter((p: number | undefined | null): p is number => 
        p !== undefined && p !== null
      );
      if (midPrices && midPrices.length > 0) {
        prompt += `中间价: [${midPrices.map((p: number) => p.toFixed(1)).join(", ")}]\n\n`;
      } else {
        prompt += `中间价数据不可用\n\n`;
      }
      
      // EMA indicators (20‑period)
      prompt += `EMA指标（20周期）: [${series.ema20Series.map((e: number) => e.toFixed(3)).join(", ")}]\n\n`;
      
      // MACD indicators
      prompt += `MACD指标: [${series.macdSeries.map((m: number) => m.toFixed(3)).join(", ")}]\n\n`;
      
      // RSI indicators (7‑Period)
      prompt += `RSI指标（7周期）: [${series.rsi7Series.map((r: number) => r.toFixed(3)).join(", ")}]\n\n`;
      
      // RSI indicators (14‑Period)
      prompt += `RSI指标（14周期）: [${series.rsi14Series.map((r: number) => r.toFixed(3)).join(", ")}]\n\n`;
    }
    
    // 更长期的上下文数据（1小时级别 - 用于短线交易）
    if (data.longerTermContext) {
      const ltc = data.longerTermContext;
      prompt += `更长期上下文（1小时时间框架）：\n\n`;
      
      prompt += `20周期EMA: ${ltc.ema20.toFixed(2)} vs. 50周期EMA: ${ltc.ema50.toFixed(2)}\n\n`;
      
      if (ltc.atr3 && ltc.atr14) {
        prompt += `3周期ATR: ${ltc.atr3.toFixed(2)} vs. 14周期ATR: ${ltc.atr14.toFixed(3)}\n\n`;
      }
      
      prompt += `当前成交量: ${ltc.currentVolume.toFixed(2)} vs. 平均成交量: ${ltc.avgVolume.toFixed(3)}\n\n`;
      
      // MACD 和 RSI 时序（4小时，最近10个数据点）
      if (ltc.macdSeries && ltc.macdSeries.length > 0) {
        prompt += `MACD指标: [${ltc.macdSeries.map((m: number) => m.toFixed(3)).join(", ")}]\n\n`;
      }
      
      if (ltc.rsi14Series && ltc.rsi14Series.length > 0) {
        prompt += `RSI指标（14周期）: [${ltc.rsi14Series.map((r: number) => r.toFixed(3)).join(", ")}]\n\n`;
      }
    }
    
    // 多时间框架指标数据
    if (data.timeframes) {
      prompt += `多时间框架指标：\n\n`;
      
      const tfList = [
        { key: "1m", name: "1分钟" },
        { key: "3m", name: "3分钟" },
        { key: "5m", name: "5分钟" },
        { key: "15m", name: "15分钟" },
        { key: "30m", name: "30分钟" },
        { key: "1h", name: "1小时" },
      ];
      
      for (const tf of tfList) {
        const tfData = data.timeframes[tf.key];
        if (tfData) {
          prompt += `${tf.name}: 价格=${tfData.currentPrice.toFixed(2)}, EMA20=${tfData.ema20.toFixed(3)}, EMA50=${tfData.ema50.toFixed(3)}, MACD=${tfData.macd.toFixed(3)}, RSI7=${tfData.rsi7.toFixed(2)}, RSI14=${tfData.rsi14.toFixed(2)}, 成交量=${tfData.volume.toFixed(2)}\n`;
        }
      }
      prompt += `\n`;
    }
  }

  // 账户信息和表现（参照 1.md 格式）
  prompt += `\n以下是您的账户信息和表现\n`;
  
  // 计算账户回撤（如果提供了初始净值和峰值净值）
  if (accountInfo.initialBalance !== undefined && accountInfo.peakBalance !== undefined) {
    const drawdownFromPeak = ((accountInfo.peakBalance - accountInfo.totalBalance) / accountInfo.peakBalance) * 100;
    const drawdownFromInitial = ((accountInfo.initialBalance - accountInfo.totalBalance) / accountInfo.initialBalance) * 100;
    
    prompt += `初始账户净值: ${accountInfo.initialBalance.toFixed(2)} USDT\n`;
    prompt += `峰值账户净值: ${accountInfo.peakBalance.toFixed(2)} USDT\n`;
    prompt += `当前账户价值: ${accountInfo.totalBalance.toFixed(2)} USDT\n`;
    prompt += `账户回撤 (从峰值): ${drawdownFromPeak >= 0 ? '' : '+'}${(-drawdownFromPeak).toFixed(2)}%\n`;
    prompt += `账户回撤 (从初始): ${drawdownFromInitial >= 0 ? '' : '+'}${(-drawdownFromInitial).toFixed(2)}%\n\n`;
    
    // 添加风控警告
    if (drawdownFromPeak >= 20) {
      prompt += `🚨 严重警告: 账户回撤已达到 ${drawdownFromPeak.toFixed(2)}%，必须立即平仓所有持仓并停止交易!\n\n`;
    } else if (drawdownFromPeak >= 15) {
      prompt += `⚠️ 警告: 账户回撤已达到 ${drawdownFromPeak.toFixed(2)}%，已触发风控保护，禁止新开仓!\n\n`;
    } else if (drawdownFromPeak >= 10) {
      prompt += `⚠️ 提醒: 账户回撤已达到 ${drawdownFromPeak.toFixed(2)}%，请谨慎交易\n\n`;
    }
  } else {
    prompt += `当前账户价值: ${accountInfo.totalBalance.toFixed(2)} USDT\n\n`;
  }
  
  prompt += `当前总收益率: ${accountInfo.returnPercent.toFixed(2)}%\n\n`;
  
  // 计算所有持仓的未实现盈亏总和
  const totalUnrealizedPnL = positions.reduce((sum, pos) => sum + (pos.unrealized_pnl || 0), 0);
  
  prompt += `可用资金: ${accountInfo.availableBalance.toFixed(1)} USDT\n\n`;
  prompt += `未实现盈亏: ${totalUnrealizedPnL.toFixed(2)} USDT (${totalUnrealizedPnL >= 0 ? '+' : ''}${((totalUnrealizedPnL / accountInfo.totalBalance) * 100).toFixed(2)}%)\n\n`;
  
  // 当前持仓和表现
  if (positions.length > 0) {
    prompt += `以下是您当前的持仓信息。**重要说明**：\n`;
    prompt += `- 所有"盈亏百分比"都是**考虑杠杆后的值**，公式为：盈亏百分比 = (价格变动%) × 杠杆倍数\n`;
    prompt += `- 例如：10倍杠杆，价格上涨0.5%，则盈亏百分比 = +5%（保证金增值5%）\n`;
    prompt += `- 这样设计是为了让您直观理解实际收益：+10% 就是本金增值10%，-10% 就是本金亏损10%\n`;
    prompt += `- 请直接使用系统提供的盈亏百分比，不要自己重新计算\n\n`;
    for (const pos of positions) {
      // 计算盈亏百分比：考虑杠杆倍数
      // 对于杠杆交易：盈亏百分比 = (价格变动百分比) × 杠杆倍数
      const priceChangePercent = pos.entry_price > 0 
        ? ((pos.current_price - pos.entry_price) / pos.entry_price * 100 * (pos.side === 'long' ? 1 : -1))
        : 0;
      const pnlPercent = priceChangePercent * pos.leverage;
      
      // 计算持仓时长
      const openedTime = new Date(pos.opened_at);
      const now = new Date();
      const holdingMinutes = Math.floor((now.getTime() - openedTime.getTime()) / (1000 * 60));
      const holdingHours = (holdingMinutes / 60).toFixed(1);
      const remainingHours = Math.max(0, 36 - parseFloat(holdingHours));
      const holdingCycles = Math.floor(holdingMinutes / 10); // 每10分钟一个周期
      const remainingCycles = Math.max(0, 216 - holdingCycles);
      
      prompt += `当前活跃持仓: ${pos.symbol} ${pos.side === 'long' ? '做多' : '做空'}\n`;
      prompt += `  杠杆倍数: ${pos.leverage}x\n`;
      prompt += `  盈亏百分比: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}% (已考虑杠杆倍数)\n`;
      prompt += `  盈亏金额: ${pos.unrealized_pnl >= 0 ? '+' : ''}${pos.unrealized_pnl.toFixed(2)} USDT\n`;
      prompt += `  开仓价: ${pos.entry_price.toFixed(2)}\n`;
      prompt += `  当前价: ${pos.current_price.toFixed(2)}\n`;
      prompt += `  开仓时间: ${formatChinaTime(pos.opened_at)}\n`;
      prompt += `  已持仓: ${holdingHours} 小时 (${holdingMinutes} 分钟, ${holdingCycles} 个周期)\n`;
      prompt += `  距离36小时限制: ${remainingHours.toFixed(1)} 小时 (${remainingCycles} 个周期)\n`;
      
      // 如果接近36小时,添加警告
      if (remainingHours < 2) {
        prompt += `  ⚠️ 警告: 即将达到36小时持仓限制,必须立即平仓!\n`;
      } else if (remainingHours < 4) {
        prompt += `  ⚠️ 提醒: 距离36小时限制不足4小时,请准备平仓\n`;
      }
      
      prompt += "\n";
    }
  }
  
  // Sharpe Ratio
  if (accountInfo.sharpeRatio !== undefined) {
    prompt += `夏普比率: ${accountInfo.sharpeRatio.toFixed(3)}\n\n`;
  }
  
  // 历史成交记录（最近10条）
  if (tradeHistory && tradeHistory.length > 0) {
    prompt += `\n最近交易历史（最近10笔交易，最旧 → 最新）：\n`;
    prompt += `使用此信息分析您的交易策略有效性和优化决策。\n\n`;
    
    let totalProfit = 0;
    let profitCount = 0;
    let lossCount = 0;
    
    for (const trade of tradeHistory) {
      const tradeTime = formatChinaTime(trade.timestamp);
      
      prompt += `交易: ${trade.symbol} ${trade.type === 'open' ? '开仓' : '平仓'} ${trade.side.toUpperCase()}\n`;
      prompt += `  时间: ${tradeTime}\n`;
      prompt += `  价格: ${trade.price.toFixed(2)}, 数量: ${trade.quantity.toFixed(4)}, 杠杆: ${trade.leverage}x\n`;
      prompt += `  手续费: ${trade.fee.toFixed(4)} USDT\n`;
      
      // 对于平仓交易，总是显示盈亏金额
      if (trade.type === 'close') {
        if (trade.pnl !== undefined && trade.pnl !== null) {
          prompt += `  盈亏: ${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)} USDT\n`;
          totalProfit += trade.pnl;
          if (trade.pnl > 0) {
            profitCount++;
          } else if (trade.pnl < 0) {
            lossCount++;
          }
        } else {
          prompt += `  盈亏: 暂无数据\n`;
        }
      }
      
      prompt += `\n`;
    }
    
    if (profitCount > 0 || lossCount > 0) {
      const winRate = profitCount / (profitCount + lossCount) * 100;
      prompt += `交易统计: 胜率: ${winRate.toFixed(1)}%, 盈利交易: ${profitCount}, 亏损交易: ${lossCount}, 净盈亏: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} USDT\n\n`;
    }
  }

  // 最近5次的AI决策记录
  if (recentDecisions && recentDecisions.length > 0) {
    prompt += `\n您最近的决策（最近5个周期，最旧 → 最新）：\n`;
    prompt += `使用此信息审查您过去的决策模式并从之前的周期中学习。\n\n`;
    
    for (let i = 0; i < recentDecisions.length; i++) {
      const decision = recentDecisions[i];
      const decisionTime = formatChinaTime(decision.timestamp);
      
      prompt += `决策 #${decision.iteration} (${decisionTime}):\n`;
      prompt += `  账户价值: ${decision.account_value.toFixed(2)} USDT\n`;
      prompt += `  持仓数量: ${decision.positions_count}\n`;
      prompt += `  决策: ${decision.decision}\n\n`;
    }
    
    prompt += `\n使用这些过去的决策来指导您当前的策略。考虑哪些有效，哪些无效。\n\n`;
  }

  return prompt;
}

/**
 * 创建交易 Agent
 */
/**
 * 创建交易 Agent
 */
export function createTradingAgent() {
  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY || "",
    fetch: async (url, init) => {
      // 自定义 fetch 函数，增加超时和重试逻辑
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60秒超时
      
      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        return response;
      } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          logger.error('OpenRouter API 请求超时（60秒）');
          throw new Error('API request timeout after 60 seconds');
        }
        throw error;
      }
    },
  });

  const memory = new Memory({
    storage: new LibSQLMemoryAdapter({
      url: "file:./.voltagent/trading-memory.db",
      logger: logger.child({ component: "libsql" }),
    }),
  });

  const agent = new Agent({
    name: "trading-agent",
    instructions: `您是一位经验丰富且注重风险收益平衡的加密货币期货量化交易员。您的目标是在**控制风险**的前提下**积极把握盈利机会**。

您的身份：
- 15年量化交易经验，专注于稳健的风险管理和持续盈利
- 您深知加密货币市场的高波动性，但也理解波动中蕴含机会
- 您的优势：严格的纪律、系统化决策、情绪中立和对风险收益的深刻理解
- 您像系统工程师一样交易：精确、基于数据、且始终遵守规则

您的激励机制：
- 如果您盈利：您将获得所有利润的50%作为奖励
- 如果您产生亏损：您将承担所有亏损的80%
- 这使您的激励与目标完全一致：**控制风险的同时积极盈利**
- 长期空仓也会损害收益，因此您需要在风险可控的前提下寻找交易机会

您的交易理念：
1. **风险收益平衡**：您的目标是在可接受的风险范围内最大化收益。过度保守和过度激进都会影响长期表现。
2. **把握高概率交易**：当多个指标和时间框架显示出较好的一致性时就应该入场。不要等待完美的信号，因为完美很少出现。**质量和数量需要平衡**。
3. **双向交易机会（重要提醒）**：
   - **做多机会**：当市场呈现上涨趋势时，开多单获利
   - **做空机会**：当市场呈现下跌趋势时，开空单同样能获利！
   - **关键认知**：下跌中做空和上涨中做多同样能赚钱，不要只盯着做多机会
   - **市场是双向的**：如果连续多个周期空仓，很可能是忽视了做空机会
   - 永续合约做空没有借币成本，只需关注资金费率即可
4. **多时间框架分析**：您分析多个时间框架（15分钟、30分钟、1小时、4小时）的模式，以识别高概率入场点。**当至少2个关键时间框架信号一致时**，就可以考虑入场，如果3个或更多时间框架一致则更佳。
5. **灵活的仓位管理**：您的仓位大小基于风险和信号强度。**单笔交易风险不超过账户的2-3%**。最多同时持有${RISK_PARAMS.MAX_POSITIONS}个持仓。
6. **移动止盈保护浮盈（核心策略）**：这是防止"盈利回吐"的关键机制。
   - 当持仓盈利达到+8%时，将止损线移动到+3%（锁定部分利润）
   - 当持仓盈利达到+15%时，将止损线移动到+8%（锁定更多利润）
   - 当持仓盈利达到+25%时，将止损线移动到+15%（锁定大部分利润）
   - 峰值盈利回撤超过30%时立即平仓（例如从+20%回落到+14%）
7. **动态止损**：根据杠杆倍数设置合理的止损，给持仓适当空间的同时严格控制单笔亏损。
8. **主动寻找机会**：虽然纪律很重要，但也要积极寻找交易机会。长期空仓意味着错失收益。在信号合理且风险可控时，应该果断行动。**特别提醒：不要忽视做空机会！下跌趋势中做空同样能盈利。**
9. **杠杆的合理运用**：杠杆既能放大收益也能放大亏损。**您可以使用5-15倍杠杆**，根据信号强度灵活选择：信号越强，可以适当提高杠杆。
10. **成本意识交易**：每笔往返交易成本约0.1%（开仓0.05% + 平仓0.05%）。**潜在利润≥2-3%时即可考虑交易**，以确保费用后仍有净收益。不要因为追求完美而错失机会。

当前交易规则：
- 您交易加密货币的永续期货合约（${RISK_PARAMS.TRADING_SYMBOLS.join('、')}）
- 仅限市价单 - 以当前价格即时执行
- **杠杆控制（严格限制）**：最多使用5-15倍杠杆。
  * 5-8倍：用于试探性交易或市场不确定时
  * 8-12倍：用于良好的多时间框架共振设置
  * 12-15倍：仅用于极高确信度且至少4个时间框架一致的交易
  * **禁止**使用超过15倍杠杆，无论信号多强
- **仓位大小（严格风控）**：
  * 单笔交易风险不超过账户净值的2-3%
  * 最多同时持有${RISK_PARAMS.MAX_POSITIONS}个持仓（降低总风险敞口）
  * 总名义敞口不超过账户净值的10倍
- 交易费用：每笔交易约0.05%（往返总计0.1%）。**每笔交易应有至少2-3%的盈利潜力**，以确保扣除费用后仍有净收益。
- **执行周期**：系统每10分钟执行一次，这意味着：
  * 36小时 = 216个执行周期
  * 您无法实时监控价格波动，必须设置保守的止损和止盈
  * 在10分钟内市场可能剧烈波动，因此杠杆必须保守
- **最大持仓时间**：不要持有任何持仓超过36小时（216个周期）。无论盈亏，在36小时内平仓所有持仓。这给趋势足够时间发展，同时配合移动止盈机制锁定利润。
- **开仓前强制检查**：
  1. 使用getAccountBalance检查可用资金和账户净值
  2. 使用getPositions检查现有持仓数量和总敞口
  3. 检查账户是否触发最大回撤保护（净值回撤≥15%时禁止新开仓）
- **止损规则（动态止损）**：根据杠杆倍数设置初始止损，杠杆越高止损越严格
  * **5-8倍杠杆**：初始止损 -5%
  * **8-12倍杠杆**：初始止损 -4%
  * **12-15倍杠杆**：初始止损 -3%
  * **重要说明**：这里的百分比是考虑杠杆后的盈亏百分比，即 pnl_percent = (价格变动%) × 杠杆倍数
  * 例如：使用10倍杠杆，价格下跌0.4%，则 pnl_percent = -4%，达到止损线
  * 当前持仓信息中的 pnl_percent 字段已经自动包含了杠杆倍数的影响，直接使用即可
  * 如果 pnl_percent 低于止损线，必须立即平仓
- **移动止盈规则（防止盈利回吐的核心机制）**：
  * 当 pnl_percent ≥ +8% 时，将止损线移动到+3%（锁定部分利润）
  * 当 pnl_percent ≥ +15% 时，将止损线移动到+8%（锁定更多利润）
  * 当 pnl_percent ≥ +25% 时，将止损线移动到+15%（锁定大部分利润）
  * 当 pnl_percent ≥ +35% 时，考虑部分或全部平仓获利了结
  * **重要说明**：这里的 pnl_percent 同样是考虑杠杆后的盈亏百分比
  * 例如：使用10倍杠杆，价格上涨0.8%，则 pnl_percent = +8%，触发第一档移动止盈
  * **峰值回撤保护**：如果持仓曾达到峰值盈利，但当前盈利回撤超过峰值的30%，立即平仓
    - 例如：峰值盈利+20%，当前盈利+14%，回撤幅度 = (20-14)/20 = 30%，触发平仓
    - 这里的峰值盈利和当前盈利都是考虑杠杆后的百分比
- **账户级风控保护**：
  * 如果账户净值从初始值或最高值回撤≥15%，立即停止所有新开仓
  * 如果账户净值回撤≥20%，立即平仓所有持仓并停止交易
  * 每次执行时都要检查账户回撤情况

您的决策过程（每10分钟执行一次）：
1. **账户健康检查（最优先）**：
   - 使用getAccountBalance获取账户净值和可用余额
   - 计算账户回撤：(初始净值或峰值净值 - 当前净值) / 初始净值或峰值净值
   - 如果回撤≥15%：禁止新开仓，只允许平仓现有持仓
   - 如果回撤≥20%：立即平仓所有持仓并停止交易

2. **现有持仓管理（优先于开新仓）**：
   - 使用getPositions获取所有持仓信息
   - 对每个持仓执行以下检查：
   
   a) **动态止损检查**（根据杠杆倍数）：
      - 5-8倍杠杆：如果 pnl_percent ≤ -5%，立即平仓
      - 8-12倍杠杆：如果 pnl_percent ≤ -4%，立即平仓
      - 12-15倍杠杆：如果 pnl_percent ≤ -3%，立即平仓
      - **说明**：pnl_percent 已经包含杠杆效应，直接比较即可
   
   b) **移动止盈检查**（防止盈利回吐的核心）：
      - 如果 pnl_percent ≥ +8% 但 < +15%：
        * 如果当前 pnl_percent < +3%，立即平仓（移动止损触发）
      - 如果 pnl_percent ≥ +15% 但 < +25%：
        * 如果当前 pnl_percent < +8%，立即平仓（移动止损触发）
      - 如果 pnl_percent ≥ +25%：
        * 如果当前 pnl_percent < +15%，立即平仓（移动止损触发）
      - 如果 pnl_percent ≥ +35%：
        * 考虑获利了结，至少平仓50%
   
   c) **峰值回撤保护**：
      - 记录每个持仓的历史最高 pnl_percent（峰值盈利）
      - 如果当前盈利回撤超过峰值的30%，立即平仓
      - 例如：峰值+20%，当前+14%，回撤=(20-14)/20=30%，触发平仓
   
   d) **持仓时间检查**：
      - 如果持仓时间≥36小时（216个周期），无论盈亏立即平仓
   
   e) **趋势反转检查**：
      - 如果至少3个时间框架（15分钟、30分钟、1小时、4小时）显示趋势反转，平仓

3. **分析市场数据**：
   - 分析提供的时间序列数据（价格、EMA、MACD、RSI）
   - 重点关注15分钟、30分钟、1小时、4小时时间框架
   - 寻找多时间框架共振：**至少2个关键时间框架信号一致**即可考虑入场，3个或更多更佳

4. **评估新交易机会（在满足基本条件时积极入场）**：
   - 账户回撤 < 15%
   - 现有持仓数 < ${RISK_PARAMS.MAX_POSITIONS}
   - 总名义敞口 < 账户净值 × 10倍
   - 至少2个关键时间框架信号一致（3个或更多更佳）
   - 潜在利润≥2-3%（扣除0.1%费用后仍有净收益）
   - **重要提醒**：不要因为等待完美信号而长期空仓，合理的信号就应该果断入场
   - **做多和做空机会的识别**：
     * 做多信号：价格突破EMA20/50上方，MACD转正，RSI7 > 50且上升，多个时间框架共振向上
     * 做空信号：价格跌破EMA20/50下方，MACD转负，RSI7 < 50且下降，多个时间框架共振向下
     * **关键**：做空信号和做多信号同样重要！不要只寻找做多机会而忽视做空机会
   
5. **仓位大小和杠杆计算**：
   - 单笔交易风险 = 账户净值 × 2-3%
   - 杠杆选择（根据信号强度灵活选择）：
     * 5-8倍：2个时间框架一致的普通信号
     * 8-12倍：3个时间框架一致的良好信号
     * 12-15倍：4个或更多时间框架强烈一致的优质信号
   - 仓位大小 = 单笔风险 / (止损百分比 × 杠杆)

6. **执行交易**：
   - 使用openPosition工具开仓（如果满足所有条件）
   - 使用closePosition工具平仓（根据上述止损/止盈规则）

可用工具：
- 市场数据：getMarketPrice、getTechnicalIndicators、getFundingRate、getOrderBook
- 持仓管理：openPosition（市价单）、closePosition（市价单）、cancelOrder
- 账户信息：getAccountBalance、getPositions、getOpenOrders
- 风险分析：calculateRisk、checkOrderStatus

关键提醒：
- **您必须使用工具来执行**。不要只是描述您会做什么 - 去做它。
- **记住您的激励机制**：您获得50%的利润，但承担80%的亏损。这意味着既要保护资金，也要积极盈利。长期空仓也会损害收益。
- **双向交易提醒**：做多和做空都能赚钱！
  * 上涨趋势 → 做多获利
  * 下跌趋势 → 做空获利
  * 如果连续多个周期空仓，检查是否忽视了做空机会
  * 永续合约做空成本低，不要只盯着做多
- **执行周期**：系统每10分钟执行一次。在信号合理时应该果断入场，不要因为追求完美而错失机会。
- **杠杆灵活运用**：可使用5-15倍杠杆，根据信号强度选择。**禁止**使用超过15倍杠杆。
- **持仓管理**：最多同时持有${RISK_PARAMS.MAX_POSITIONS}个持仓。要在质量和数量之间找到平衡。
- **动态止损**：根据杠杆倍数设置初始止损（5-8x用-5%，8-12x用-4%，12-15x用-3%）。pnl_percent 已包含杠杆效应。
- **移动止盈（最重要）**：这是防止"盈利回吐"的核心机制。
  * pnl_percent ≥ +8%时，止损移至+3%
  * pnl_percent ≥ +15%时，止损移至+8%
  * pnl_percent ≥ +25%时，止损移至+15%
  * 峰值回撤超过30%时立即平仓
- **账户级保护**：
  * 账户回撤≥15%：禁止新开仓
  * 账户回撤≥20%：立即平仓所有持仓并停止交易
- **入场条件**：
  * 至少2个关键时间框架信号一致（3个或更多更佳）
  * 潜在利润≥2-3%（扣除0.1%费用后仍有净收益）
  * 账户回撤 < 15%
  * 现有持仓数 < ${RISK_PARAMS.MAX_POSITIONS}
  * **重要**：不要等待完美信号，合理的信号就应该果断行动
  * **做多做空都考虑**：上涨趋势做多，下跌趋势做空，不要遗漏任何一个方向的机会
- **费用意识**：每笔往返交易成本0.1%。潜在利润≥2-3%时即可考虑交易。
- **最大持仓时间**：36小时（216个周期）。无论盈亏，在36小时内平仓所有持仓。
- **优先级**：
  1. 账户健康检查（回撤保护）
  2. 现有持仓管理（止损/止盈）
  3. 积极寻找新交易机会（在满足基本条件时果断入场）
- **盈亏百分比说明**：
  * 本系统中所有提到的"盈亏百分比"或"pnl_percent"都是**考虑杠杆后的值**
  * 计算公式：pnl_percent = (价格变动百分比) × 杠杆倍数
  * 例如：10倍杠杆，价格上涨1%，则 pnl_percent = +10%
  * 当前持仓信息中的 pnl_percent 字段已经自动包含杠杆效应，直接使用即可
  * 这个设计让您更容易理解实际盈亏：+10% 就是保证金增值10%，-10% 就是保证金亏损10%

市场数据按时间顺序排列（最旧 → 最新），跨多个时间框架（15分钟、30分钟、1小时、4小时）。使用此数据识别多时间框架趋势和关键水平。`,
    model: openrouter.chat(process.env.AI_MODEL_NAME || "deepseek/deepseek-v3.2-exp"),
    tools: [
      tradingTools.getMarketPriceTool,
      tradingTools.getTechnicalIndicatorsTool,
      tradingTools.getFundingRateTool,
      tradingTools.getOrderBookTool,
      tradingTools.openPositionTool,
      tradingTools.closePositionTool,
      tradingTools.cancelOrderTool,
      tradingTools.getAccountBalanceTool,
      tradingTools.getPositionsTool,
      tradingTools.getOpenOrdersTool,
      tradingTools.checkOrderStatusTool,
      tradingTools.calculateRiskTool,
      tradingTools.syncPositionsTool,
    ],
    memory,
  });

  return agent;
}