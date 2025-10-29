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
 * 交易循环 - 定时执行交易决策
 */
import cron from "node-cron";
import { createPinoLogger } from "@voltagent/logger";
import { createClient } from "@libsql/client";
import { createTradingAgent, generateTradingPrompt, getAccountRiskConfig } from "../agents/tradingAgent";
import { createTradingClient } from "../services/tradingClientFactory";
import { getChinaTimeISO } from "../utils/timeUtils";
import { RISK_PARAMS } from "../config/riskParams";

const logger = createPinoLogger({
  name: "trading-loop",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

// 支持的币种 - 从配置中读取
const SYMBOLS = [...RISK_PARAMS.TRADING_SYMBOLS] as string[];

// 交易开始时间
let tradingStartTime = new Date();
let iterationCount = 0;

// 账户风险配置
let accountRiskConfig = getAccountRiskConfig();

/**
 * 确保数值是有效的有限数字，否则返回默认值
 */
function ensureFinite(value: number, defaultValue: number = 0): number {
  if (!Number.isFinite(value)) {
    return defaultValue;
  }
  return value;
}

/**
 * 确保数值在指定范围内
 */
function ensureRange(value: number, min: number, max: number, defaultValue?: number): number {
  if (!Number.isFinite(value)) {
    return defaultValue !== undefined ? defaultValue : (min + max) / 2;
  }
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

import { MARKET_DATA_QUALITY } from "../config/riskParams";

/**
 * 验证市场数据有效性
 */
function validateMarketData(symbol: string, ticker: any, candles: any[]): { isValid: boolean; warnings: string[] } {
  const now = Date.now();
  const warnings: string[] = [];
  const isTestnet = process.env.BINANCE_USE_TESTNET === "true";
  
  // 基本数据验证
  if (!ticker || typeof ticker !== 'object') {
    return { isValid: false, warnings: ['行情数据无效'] };
  }

  // K线数据验证
  if (!Array.isArray(candles) || candles.length === 0) {
    return { isValid: false, warnings: ['K线数据无效'] };
  }

  const currentCandle = candles[candles.length - 1];
  const previousCandle = candles[candles.length - 2];
  
  if (!currentCandle || !currentCandle.timestamp) {
    return { isValid: false, warnings: ['K线时间戳无效'] };
  }      // 分析K线数据
      const currentCandleStartTime = currentCandle.timestamp;
      const currentCandleAge = now - currentCandleStartTime;
      const candleEndTime = currentCandleStartTime + 60000; // K线结束时间
      const isCurrentCandleClosed = now >= candleEndTime; // 是否已完结

      // 获取技术指标
      const indicators = calculateIndicators(candles);
      
      // 输出调试信息
      logger.debug(`${symbol} K线状态:
        当前时间: ${new Date(now).toISOString()}
        K线时间: ${new Date(currentCandleStartTime).toISOString()}
        已完结: ${isCurrentCandleClosed}
        延迟: ${Math.floor(currentCandleAge/1000)}秒
        成交量: ${currentCandle.volume}
        成交额: ${currentCandle.quoteVolume}
        成交笔数: ${currentCandle.trades}
        EMA20: ${indicators.ema20.toFixed(3)}
        MACD: ${indicators.macd.toFixed(3)}
        RSI14: ${indicators.rsi14.toFixed(3)}
      `);

  // 价格数据验证
  const price = Number(ticker.last);
  const markPrice = Number(ticker.markPrice);
  const volume24h = Number(ticker.volume_24h);
  const volumeUSD24h = Number(ticker.volume_24h_usd);
  
  // 验证价格数据
  if (!price || price <= 0) {
    warnings.push(`无效价格 (${price})`);
  }
  if (!markPrice || markPrice <= 0) {
    warnings.push(`无效标记价格 (${markPrice})`);
  }

  // 检查价格偏差
  if (price && markPrice) {
    const priceDiff = Math.abs(price - markPrice) / markPrice;
    const maxDeviation = isTestnet ? 0.01 : 0.005; // 测试网 1%，主网 0.5%
    if (priceDiff > maxDeviation) {
      warnings.push(`价格偏差过大: ${(priceDiff * 100).toFixed(2)}%`);
    }
  }

  // 成交量相关数据
  const currentCandleVolume = Number(currentCandle.volume);
  const currentCandleTrades = Number(currentCandle.trades);
  const currentCandleQuoteVolume = Number(currentCandle.quoteVolume);
  
  // 主网环境的市场数据验证
  if (!isTestnet) {
    // 1. 如果当前K线未完结，检查前一根K线的数据
    if (!isCurrentCandleClosed && previousCandle) {
      const previousVolume = Number(previousCandle.volume);
      const previousQuoteVolume = Number(previousCandle.quoteVolume);
      const previousTrades = Number(previousCandle.trades);
      
      if (previousVolume <= 0 || previousQuoteVolume <= 0 || previousTrades <= 0) {
        logger.debug(`${symbol} 前一K线异常 [${new Date(previousCandle.timestamp).toISOString()}]: 成交量=${previousVolume}, 成交额=${previousQuoteVolume}, 成交笔数=${previousTrades}`);
      }
    }
    // 2. 如果当前K线已完结，严格检查当前K线
    else if (isCurrentCandleClosed) {
      if (currentCandleVolume <= 0 || currentCandleQuoteVolume <= 0 || currentCandleTrades <= 0) {
        warnings.push(`当前已完结K线异常 [${new Date(currentCandleStartTime).toISOString()}]: 成交量=${currentCandleVolume}, 成交额=${currentCandleQuoteVolume}, 成交笔数=${currentCandleTrades}`);
      }
    }

    // 3. 检查24小时成交数据
    if (!volume24h || volume24h <= 0) {
      warnings.push(`24小时成交量异常 (${volume24h})`);
    }
    if (!volumeUSD24h || volumeUSD24h <= 0) {
      warnings.push(`24小时成交额异常 (${volumeUSD24h})`);
    }

    // 4. 检查最近K线活跃度
    const recentCandles = candles.slice(-5); // 最近5根K线
    const completedCandles = recentCandles.filter(c => now >= (c.timestamp + 60000));
    if (completedCandles.length > 0) {
      const inactiveCandles = completedCandles.filter(c => 
        !c.volume || Number(c.volume) <= 0 || 
        !c.quoteVolume || Number(c.quoteVolume) <= 0 ||
        !c.trades || Number(c.trades) <= 0
      );
      
      if (inactiveCandles.length === completedCandles.length) {
        warnings.push(`最近${completedCandles.length}根已完结K线均无交易`);
        // 输出详细信息用于调试
        completedCandles.forEach(c => {
          logger.debug(`${symbol} 已完结K线 [${new Date(c.timestamp).toISOString()}]: 成交量=${c.volume}, 成交额=${c.quoteVolume}, 成交笔数=${c.trades}`);
        });
      }
    }
  } else {
    // 测试网环境的宽松检查
    if (isCurrentCandleClosed && currentCandleVolume <= 0) {
      logger.debug(`[测试网] ${symbol} 已完结K线无成交 [${new Date(currentCandleStartTime).toISOString()}]`);
    }
  }

  // 检查K线时效性
  const maxCandleAge = isTestnet ? 180000 : 120000; // 测试网3分钟，主网2分钟
  if (currentCandleAge > maxCandleAge) {
    warnings.push(`K线数据延迟: ${Math.floor(currentCandleAge / 1000)}秒`);
  }

  // 处理警告信息
  if (warnings.length > 0) {
    warnings.forEach(warning => {
      if (isTestnet) {
        // 测试网环境全部用debug级别
        logger.debug(`${symbol} 数据质量问题 [${new Date(now).toISOString()}]: ${warning}`);
      } else {
        // 主网环境区分处理
        if (!isCurrentCandleClosed && warning.includes('当前K线')) {
          // 未完结K线用debug级别
          logger.debug(`${symbol} 数据质量问题 [${new Date(now).toISOString()}]: ${warning}`);
        } else {
          // 其他警告用warn级别
          logger.warn(`${symbol} 数据质量问题 [${new Date(now).toISOString()}]: ${warning}`);
        }
      }
    });
  }

  return {
    isValid: warnings.length === 0,
    warnings
  };
}

/**
 * 收集所有市场数据（包含多时间框架分析和时序数据）
 */
async function collectMarketData() {
  const tradingClient = createTradingClient();
  const marketData: Record<string, any> = {};

  for (const symbol of SYMBOLS) {
    try {
      const contract = `${symbol}_USDT`;
      
      // 获取价格（带重试）
      let ticker: any = null;
      let retryCount = 0;
      const maxRetries = 2;
      let lastError: any = null;
      
      while (retryCount <= maxRetries) {
        try {
          ticker = await tradingClient.getFuturesTicker(contract);
          break; // 成功，跳出重试循环
        } catch (error) {
          lastError = error;
          retryCount++;
          if (retryCount > maxRetries) {
            logger.error(`${symbol} 价格获取失败（${maxRetries}次重试）:`, error as any);
            throw error;
          }
          logger.warn(`${symbol} 价格获取失败，重试 ${retryCount}/${maxRetries}...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // 递增重试延迟
        }
      }
      
      // 获取所有时间框架的K线数据（分批请求，避免超时）
      // 第一批：短周期
      const [candles1m, candles3m, candles5m] = await Promise.all([
        tradingClient.getFuturesCandles(contract, "1m", 60),
        tradingClient.getFuturesCandles(contract, "3m", 60),
        tradingClient.getFuturesCandles(contract, "5m", 100),
      ]);
      
      // 小延迟后获取第二批：长周期
      await new Promise(resolve => setTimeout(resolve, 100));
      const [candles15m, candles30m, candles1h] = await Promise.all([
        tradingClient.getFuturesCandles(contract, "15m", 96),
        tradingClient.getFuturesCandles(contract, "30m", 90),
        tradingClient.getFuturesCandles(contract, "1h", 120)
      ]);

      // 确保K线数据正确排序（时间升序）
      const sortCandles = (candles: any[]) => {
        return [...candles].sort((a, b) => a.timestamp - b.timestamp);
      };

      const sortedCandles1m = sortCandles(candles1m);
      const now = Date.now();
      const latestCandle = sortedCandles1m[sortedCandles1m.length - 1];
      
      // 进行数据质量验证（使用1分钟K线）
      const dataValidation = validateMarketData(symbol, ticker, sortedCandles1m);
      
      // 计算各个时间框架的技术指标
      const timeframeIndicators = {
        m1: calculateIndicators(sortedCandles1m),
        m3: calculateIndicators(candles3m),
        m5: calculateIndicators(candles5m),
        m15: calculateIndicators(candles15m),
        m30: calculateIndicators(candles30m),
        h1: calculateIndicators(candles1h)
      };
      
      // 输出技术指标调试信息
      logger.debug(`${symbol} 技术指标:
        5分钟K线: EMA20=${timeframeIndicators.m5.ema20.toFixed(3)}, MACD=${timeframeIndicators.m5.macd.toFixed(3)}, RSI14=${timeframeIndicators.m5.rsi14.toFixed(3)}
        1分钟K线: EMA20=${timeframeIndicators.m1.ema20.toFixed(3)}, MACD=${timeframeIndicators.m1.macd.toFixed(3)}, RSI14=${timeframeIndicators.m1.rsi14.toFixed(3)}
      `);
      
      // 数据质量检查
      const isTestnet = process.env.BINANCE_USE_TESTNET === "true";
      const issues: string[] = [];
      
      if (latestCandle) {
        const candleTime = new Date(latestCandle.timestamp).toISOString();
        const age = Math.floor((now - latestCandle.timestamp) / 1000);
        const isClosed = age >= 60; // K线是否已完结
        
        // 构造详细的市场状态信息
        const marketStatus = {
          symbol,
          time: candleTime,
          age: `${age}秒`,
          isClosed: isClosed ? "是" : "否",
          kline: {
            volume: latestCandle.volume,
            quoteVolume: latestCandle.quoteVolume,
            trades: latestCandle.trades,
            indicators: {
              ema20: timeframeIndicators.m1.ema20.toFixed(3),
              macd: timeframeIndicators.m1.macd.toFixed(3),
              rsi14: timeframeIndicators.m1.rsi14.toFixed(3)
            }
          },
          ticker: {
            price: ticker.last,
            markPrice: ticker.markPrice,
            volume24h: ticker.volume_24h,
            volumeUsd24h: ticker.volume_24h_usd
          }
        };

        // 按环境进行相应的检查
        if (isTestnet) {
          // 测试网：记录所有情况但用debug级别
          if (isClosed && (!latestCandle.volume || Number(latestCandle.volume) <= 0)) {
            logger.debug(`[测试网] ${symbol} 市场状态: ${JSON.stringify(marketStatus)}`);
          }
        } else {
          // 主网：严格检查
          if (!latestCandle.volume || !latestCandle.quoteVolume || !latestCandle.trades) {
            issues.push(`数据格式无效 [${JSON.stringify(marketStatus)}]`);
          } else if (Number(latestCandle.volume) <= 0 || Number(latestCandle.quoteVolume) <= 0 || Number(latestCandle.trades) <= 0) {
            if (isClosed) {
              issues.push(`已完结K线交易异常 [${JSON.stringify(marketStatus)}]`);
            } else {
              logger.debug(`${symbol} 当前K线状态 [${JSON.stringify(marketStatus)}]`);
            }
          }
          
          // 24小时数据检查
          if (!ticker.volume_24h || Number(ticker.volume_24h) <= 0 || !ticker.volume_24h_usd || Number(ticker.volume_24h_usd) <= 0) {
            issues.push(`24小时成交异常 [${JSON.stringify(marketStatus)}]`);
          }
        }
      } else {
        issues.push(`无法获取最新K线数据 [${symbol}] - 请检查网络连接和API状态`);
      }
      
      // 记录发现的问题
      issues.forEach(issue => {
        if (isTestnet) {
          logger.debug(issue);
        } else {
          logger.warn(issue);
        }
      });

      // 保存市场数据
      marketData[symbol] = {
        ticker,
        candles1m: sortedCandles1m,
        candles3m,
        candles5m,
        candles15m,
        candles30m,
        candles1h,
        indicators: timeframeIndicators.m5, // 主要使用5分钟指标
        indicators1m: timeframeIndicators.m1,
        indicators3m: timeframeIndicators.m3,
        indicators5m: timeframeIndicators.m5,
        indicators15m: timeframeIndicators.m15,
        indicators30m: timeframeIndicators.m30,
        indicators1h: timeframeIndicators.h1,
        isValid: issues.length === 0,
        lastPrice: Number(ticker?.last || 0)
      };
      
    } catch (error) {
      logger.error(`${symbol} 市场数据获取失败:`, error as any);
      marketData[symbol] = { error: error as any };
    }
  }

  return marketData;
}

/**
 * 计算日内时序数据（3分钟级别）
 * 参照 1.md 格式
 * @param candles 全部历史数据（至少60个数据点）
 */
function calculateIntradaySeries(candles: any[]) {
  if (!candles || candles.length === 0) {
    return {
      midPrices: [],
      ema20Series: [],
      macdSeries: [],
      rsi7Series: [],
      rsi14Series: [],
    };
  }

  // 提取收盘价
  const closes = candles.map((c) => Number.parseFloat(c.c || "0")).filter(n => Number.isFinite(n));
  
  if (closes.length === 0) {
    return {
      midPrices: [],
      ema20Series: [],
      macdSeries: [],
      rsi7Series: [],
      rsi14Series: [],
    };
  }

  // 计算每个时间点的指标
  const midPrices = closes;
  const ema20Series: number[] = [];
  const macdSeries: number[] = [];
  const rsi7Series: number[] = [];
  const rsi14Series: number[] = [];

  // 为每个数据点计算指标（使用截至该点的所有历史数据）
  for (let i = 0; i < closes.length; i++) {
    const historicalPrices = closes.slice(0, i + 1);
    
    // EMA20 - 需要至少20个数据点
    ema20Series.push(historicalPrices.length >= 20 ? calcEMA(historicalPrices, 20) : historicalPrices[historicalPrices.length - 1]);
    
    // MACD - 需要至少26个数据点
    macdSeries.push(historicalPrices.length >= 26 ? calcMACD(historicalPrices) : 0);
    
    // RSI7 - 需要至少8个数据点
    rsi7Series.push(historicalPrices.length >= 8 ? calcRSI(historicalPrices, 7) : 50);
    
    // RSI14 - 需要至少15个数据点
    rsi14Series.push(historicalPrices.length >= 15 ? calcRSI(historicalPrices, 14) : 50);
  }

  // 只返回最近10个数据点
  const sliceIndex = Math.max(0, midPrices.length - 10);
  return {
    midPrices: midPrices.slice(sliceIndex),
    ema20Series: ema20Series.slice(sliceIndex),
    macdSeries: macdSeries.slice(sliceIndex),
    rsi7Series: rsi7Series.slice(sliceIndex),
    rsi14Series: rsi14Series.slice(sliceIndex),
  };
}

/**
 * 计算更长期的上下文数据（1小时级别 - 用于短线交易）
 * 参照 1.md 格式
 */
function calculateLongerTermContext(candles: any[]) {
  if (!candles || candles.length < 26) {
    return {
      ema20: 0,
      ema50: 0,
      atr3: 0,
      atr14: 0,
      currentVolume: 0,
      avgVolume: 0,
      macdSeries: [],
      rsi14Series: [],
    };
  }

  const closes = candles.map((c) => Number.parseFloat(c.c || "0")).filter(n => Number.isFinite(n));
  const highs = candles.map((c) => Number.parseFloat(c.h || "0")).filter(n => Number.isFinite(n));
  const lows = candles.map((c) => Number.parseFloat(c.l || "0")).filter(n => Number.isFinite(n));
  const volumes = candles.map((c) => Number.parseFloat(c.v || "0")).filter(n => Number.isFinite(n));

  // 计算 EMA
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);

  // 计算 ATR
  const atr3 = calcATR(highs, lows, closes, 3);
  const atr14 = calcATR(highs, lows, closes, 14);

  // 计算成交量
  const currentVolume = volumes.length > 0 ? volumes[volumes.length - 1] : 0;
  const avgVolume = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0;

  // 计算最近10个数据点的 MACD 和 RSI14
  const macdSeries: number[] = [];
  const rsi14Series: number[] = [];
  
  const recentPoints = Math.min(10, closes.length);
  for (let i = closes.length - recentPoints; i < closes.length; i++) {
    const historicalPrices = closes.slice(0, i + 1);
    macdSeries.push(calcMACD(historicalPrices));
    rsi14Series.push(calcRSI(historicalPrices, 14));
  }

  return {
    ema20,
    ema50,
    atr3,
    atr14,
    currentVolume,
    avgVolume,
    macdSeries,
    rsi14Series,
  };
}

/**
 * 计算 ATR (Average True Range)
 */
function calcATR(highs: number[], lows: number[], closes: number[], period: number) {
  if (highs.length < period + 1 || lows.length < period + 1 || closes.length < period + 1) {
    return 0;
  }

  const trueRanges: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const high = highs[i];
    const low = lows[i];
    const prevClose = closes[i - 1];
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }

  // 计算平均
  const recentTR = trueRanges.slice(-period);
  const atr = recentTR.reduce((sum, tr) => sum + tr, 0) / recentTR.length;
  
  return Number.isFinite(atr) ? atr : 0;
}

// 计算 EMA
function calcEMA(prices: number[], period: number) {
  if (prices.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return Number.isFinite(ema) ? ema : 0;
}

// 计算 RSI
function calcRSI(prices: number[], period: number) {
  if (prices.length < period + 1) return 50; // 数据不足，返回中性值
  
  let gains = 0;
  let losses = 0;

  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return avgGain > 0 ? 100 : 50;
  
  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);
  
  // 确保RSI在0-100范围内
  return ensureRange(rsi, 0, 100, 50);
}

// 计算 MACD
function calcMACD(prices: number[]) {
  if (prices.length < 26) return 0; // 数据不足
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  const macd = ema12 - ema26;
  return Number.isFinite(macd) ? macd : 0;
}

/**
 * 计算技术指标
 * 
 * K线数据格式：FuturesCandlestick 对象
 * {
 *   t: number,    // 时间戳
 *   v: number,    // 成交量
 *   c: string,    // 收盘价
 *   h: string,    // 最高价
 *   l: string,    // 最低价
 *   o: string,    // 开盘价
 *   sum: string   // 总成交额
 * }
 */
function calculateIndicators(candles: any[]) {
  if (!Array.isArray(candles) || candles.length === 0) {
    return {
      ema20: 0,
      macd: 0,
      rsi14: 50,
      volume: 0,
      trades: 0,
      quoteVolume: 0
    };
  }

  // 提取收盘价序列
  const closes = candles.map(c => Number(c.close)).filter(p => !isNaN(p) && isFinite(p));
  
  if (closes.length === 0) {
    return {
      ema20: 0,
      macd: 0,
      rsi14: 50,
      volume: 0,
      trades: 0,
      quoteVolume: 0
    };
  }

  // 计算EMA20
  const k = 2 / (20 + 1);
  let ema20 = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema20 = closes[i] * k + ema20 * (1 - k);
  }

  // 计算MACD
  const k12 = 2 / (12 + 1);
  const k26 = 2 / (26 + 1);
  let ema12 = closes[0];
  let ema26 = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema12 = closes[i] * k12 + ema12 * (1 - k12);
    ema26 = closes[i] * k26 + ema26 * (1 - k26);
  }
  const macd = ema12 - ema26;

  // 计算RSI14
  const changes = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }
  const period = 14;
  const gains = changes.filter(c => c > 0);
  const losses = changes.filter(c => c < 0).map(c => -c);
  
  let avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
  let avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;
  
  const rs = avgLoss === 0 ? (avgGain === 0 ? 1 : Infinity) : avgGain / avgLoss;
  const rsi14 = 100 - (100 / (1 + rs));

  // 获取最新K线的成交量数据
  const lastCandle = candles[candles.length - 1];
  
  return {
    ema20: Number.isFinite(ema20) ? ema20 : 0,
    macd: Number.isFinite(macd) ? macd : 0,
    rsi14: Number.isFinite(rsi14) ? Math.min(100, Math.max(0, rsi14)) : 50,
    volume: Number(lastCandle?.volume || 0),
    trades: Number(lastCandle?.trades || 0),
    quoteVolume: Number(lastCandle?.quoteVolume || 0)
  };
}

/**
 * 计算 Sharpe Ratio
 * 使用最近30天的账户历史数据
 */
async function calculateSharpeRatio(): Promise<number> {
  try {
    // 尝试获取所有账户历史数据（不限制30天）
    const result = await dbClient.execute({
      sql: `SELECT total_value, timestamp FROM account_history 
            ORDER BY timestamp ASC`,
      args: [],
    });
    
    if (!result.rows || result.rows.length < 2) {
      return 0; // 数据不足，返回0
    }
    
    // 计算每次交易的收益率（而不是每日）
    const returns: number[] = [];
    for (let i = 1; i < result.rows.length; i++) {
      const prevValue = Number.parseFloat(result.rows[i - 1].total_value as string);
      const currentValue = Number.parseFloat(result.rows[i].total_value as string);
      
      if (prevValue > 0) {
        const returnRate = (currentValue - prevValue) / prevValue;
        returns.push(returnRate);
      }
    }
    
    if (returns.length < 2) {
      return 0;
    }
    
    // 计算平均收益率
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    
    // 计算收益率的标准差
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    
    if (stdDev === 0) {
      return avgReturn > 0 ? 10 : 0; // 无波动但有收益，返回高值
    }
    
    // Sharpe Ratio = (平均收益率 - 无风险利率) / 标准差
    // 假设无风险利率为0
    const sharpeRatio = avgReturn / stdDev;
    
    return Number.isFinite(sharpeRatio) ? sharpeRatio : 0;
  } catch (error) {
    logger.error("计算 Sharpe Ratio 失败:", error as any);
    return 0;
  }
}

/**
 * 获取账户信息
 * 
 * Gate.io 的 account.total 包含了未实现盈亏
 * 总资产 = total - unrealisedPnl = available + positionMargin
 * 
 * 因此：
 * - totalBalance 不包含未实现盈亏
 * - returnPercent 反映已实现盈亏
 * - 监控页面的资金曲线实时更新
 */
async function getAccountInfo() {
  const tradingClient = createTradingClient();
  
  try {
    const account = await tradingClient.getFuturesAccount();
    
    // 从数据库获取初始资金
    const initialResult = await dbClient.execute(
      "SELECT total_value FROM account_history ORDER BY timestamp ASC LIMIT 1"
    );
    const initialBalance = initialResult.rows[0]
      ? Number.parseFloat(initialResult.rows[0].total_value as string)
      : 100;
    
    // 从 Gate.io API 返回的数据中提取字段
    const accountTotal = Number.parseFloat(account.total || "0");
    const availableBalance = Number.parseFloat(account.available || "0");
    const unrealisedPnl = Number.parseFloat(account.unrealisedPnl || "0");
    
    // Gate.io 的 account.total 包含了未实现盈亏
    // totalBalance 应该不包含未实现盈亏
    const totalBalance = accountTotal - unrealisedPnl;
    
    // 实时收益率 = (总资产 - 初始资金) / 初始资金 * 100
    // 总资产不包含未实现盈亏，收益率反映已实现盈亏
    const returnPercent = ((totalBalance - initialBalance) / initialBalance) * 100;
    
    // 计算 Sharpe Ratio
    const sharpeRatio = await calculateSharpeRatio();
    
    return {
      totalBalance,      // 总资产（不包含未实现盈亏）
      availableBalance,  // 可用余额
      unrealisedPnl,     // 未实现盈亏
      returnPercent,     // 收益率（不包含未实现盈亏）
      sharpeRatio,       // 夏普比率
    };
  } catch (error) {
    logger.error("获取账户信息失败:", error as any);
    return {
      totalBalance: 0,
      availableBalance: 0,
      unrealisedPnl: 0,
      returnPercent: 0,
      sharpeRatio: 0,
    };
  }
}

/**
 * 从 Gate.io 同步持仓到数据库
 * 🔥 优化：确保持仓数据的准确性和完整性
 * 数据库中的持仓记录主要用于：
 * 1. 保存止损止盈订单ID等元数据
 * 2. 提供历史查询和监控页面展示
 * 实时持仓数据应该直接从 Gate.io 获取
 */
async function syncPositionsFromGate(cachedPositions?: any[]) {
  const tradingClient = createTradingClient();
  
  try {
    // 如果提供了缓存数据，使用缓存；否则重新获取
    const gatePositions = cachedPositions || await tradingClient.getPositions();
    const dbResult = await dbClient.execute("SELECT symbol, sl_order_id, tp_order_id, stop_loss, profit_target, entry_order_id, opened_at FROM positions");
    const dbPositionsMap = new Map(
      dbResult.rows.map((row: any) => [row.symbol, row])
    );
    
    // 检查交易所是否有持仓（考虑不同交易所的格式）
    const exchangeType = process.env.EXCHANGE_TYPE || 'gate';
    const activeExchangePositions = exchangeType === 'binance'
      ? gatePositions.filter((p: any) => Math.abs(Number.parseFloat(p.size || "0")) > 0.00001)
      : gatePositions.filter((p: any) => Number.parseInt(p.size || "0") !== 0);
    
    // 如果交易所返回0个持仓但数据库有持仓，可能是 API 延迟或持仓已被平仓
    if (activeExchangePositions.length === 0 && dbResult.rows.length > 0) {
      logger.warn(`⚠️  交易所返回0个持仓，但数据库有 ${dbResult.rows.length} 个持仓`);
      logger.warn(`可能原因：1) API 延迟 2) 持仓已被平仓 3) 数据库未同步`);
      logger.warn(`将清空数据库持仓以保持同步`);
      // 清空数据库持仓，与交易所保持一致
      await dbClient.execute("DELETE FROM positions");
      logger.info(`已清空数据库持仓，与交易所同步`);
      return;
    }
    
    await dbClient.execute("DELETE FROM positions");
    
    let syncedCount = 0;
    
    for (const pos of gatePositions) {
      const size = exchangeType === 'binance' 
        ? Number.parseFloat(pos.size || "0")
        : Number.parseInt(pos.size || "0");
      
      if (exchangeType === 'binance' ? Math.abs(size) < 0.00001 : size === 0) continue;
      
      // 提取合约名称中的币种符号
      const contract = pos.contract || '';
      const symbol = contract.includes('_') 
        ? contract.replace("_USDT", "")  // Gate.io: BTC_USDT -> BTC
        : contract.replace("USDT", "");  // 币安: BTCUSDT -> BTC
      
      let entryPrice = Number.parseFloat(pos.entryPrice || "0");
      let currentPrice = Number.parseFloat(pos.markPrice || "0");
      const leverage = Number.parseInt(pos.leverage || "1");
      const side = size > 0 ? "long" : "short";
      const quantity = Math.abs(size);
      const unrealizedPnl = Number.parseFloat(pos.unrealisedPnl || pos.unrealizedPnl || "0");
      let liquidationPrice = Number.parseFloat(pos.liq_price || pos.liquidationPrice || "0");
      
      if (entryPrice === 0 || currentPrice === 0) {
        try {
          const ticker = await tradingClient.getFuturesTicker(pos.contract);
          if (currentPrice === 0) {
            currentPrice = Number.parseFloat(ticker.markPrice || ticker.last || "0");
          }
          if (entryPrice === 0) {
            entryPrice = currentPrice;
          }
        } catch (error) {
          logger.error(`获取 ${symbol} 行情失败:`, error as any);
        }
      }
      
      if (liquidationPrice === 0 && entryPrice > 0) {
        liquidationPrice = side === "long" 
          ? entryPrice * (1 - 0.9 / leverage)
          : entryPrice * (1 + 0.9 / leverage);
      }
      
      const dbPos = dbPositionsMap.get(symbol);
      
      // 保留原有的 entry_order_id，不要覆盖
      const entryOrderId = dbPos?.entry_order_id || `synced-${symbol}-${Date.now()}`;
      
      await dbClient.execute({
        sql: `INSERT INTO positions 
              (symbol, quantity, entry_price, current_price, liquidation_price, unrealized_pnl, 
               leverage, side, stop_loss, profit_target, sl_order_id, tp_order_id, entry_order_id, opened_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          symbol,
          quantity,
          entryPrice,
          currentPrice,
          liquidationPrice,
          unrealizedPnl,
          leverage,
          side,
          dbPos?.stop_loss || null,
          dbPos?.profit_target || null,
          dbPos?.sl_order_id || null,
          dbPos?.tp_order_id || null,
          entryOrderId, // 保留原有的订单ID
          dbPos?.opened_at || new Date().toISOString(), // 保留原有的开仓时间
        ],
      });
      
      syncedCount++;
    }
    
    const activeGatePositionsCount = gatePositions.filter((p: any) => Number.parseInt(p.size || "0") !== 0).length;
    if (activeGatePositionsCount > 0 && syncedCount === 0) {
      logger.error(`Gate.io 有 ${activeGatePositionsCount} 个持仓，但数据库同步失败！`);
    }
    
  } catch (error) {
    logger.error("同步持仓失败:", error as any);
  }
}

/**
 * 获取持仓信息 - 直接从 Gate.io 获取最新数据
 * @param cachedGatePositions 可选，已获取的原始Gate持仓数据，避免重复调用API
 * @returns 格式化后的持仓数据
 */
async function getPositions(cachedGatePositions?: any[]) {
  const tradingClient = createTradingClient();
  
  try {
    // 如果提供了缓存数据，使用缓存；否则重新获取
    const gatePositions = cachedGatePositions || await tradingClient.getPositions();
    
    // 识别交易所类型
    const exchangeType = process.env.EXCHANGE_TYPE || 'gate';
    
    // 过滤并格式化持仓
    const positions = gatePositions
      .filter((p: any) => {
        // 根据交易所类型判断持仓是否有效
        if (exchangeType === 'binance') {
          // 币安：浮点数数量
          const size = Number.parseFloat(p.size || "0");
          return Math.abs(size) > 0.00001; // 浮点数精度阈值
        } else {
          // Gate.io: 整数张数
          const size = Number.parseInt(p.size || "0");
          return size !== 0;
        }
      })
      .map((p: any) => {
        // 根据交易所类型解析持仓数量
        const size = exchangeType === 'binance' 
          ? Number.parseFloat(p.size || "0")
          : Number.parseInt(p.size || "0");
        
        // 提取合约名称中的币种符号
        const contract = p.contract || '';
        const symbol = contract.includes('_') 
          ? contract.replace("_USDT", "")  // Gate.io: BTC_USDT -> BTC
          : contract.replace("USDT", "");  // 币安: BTCUSDT -> BTC
        
        return {
          symbol,
          contract,
          quantity: Math.abs(size),
          side: size > 0 ? "long" : "short",
          entry_price: Number.parseFloat(p.entryPrice || "0"),
          current_price: Number.parseFloat(p.markPrice || "0"),
          liquidation_price: Number.parseFloat(p.liq_price || p.liquidationPrice || "0"),
          unrealized_pnl: Number.parseFloat(p.unrealisedPnl || p.unrealizedPnl || "0"),
          leverage: Number.parseInt(p.leverage || "1"),
          margin: Number.parseFloat(p.margin || "0"),
          opened_at: p.create_time || getChinaTimeISO(),
        };
      });
    
    return positions;
  } catch (error) {
    logger.error("获取持仓失败:", error as any);
    return [];
  }
}

/**
 * 获取历史成交记录（最近10条）
 * 从数据库获取历史交易记录（监控页的交易历史）
 */
async function getTradeHistory(limit: number = 10) {
  try {
    // 从数据库获取历史交易记录
    const result = await dbClient.execute({
      sql: `SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?`,
      args: [limit],
    });
    
    if (!result.rows || result.rows.length === 0) {
      return [];
    }
    
    // 转换数据库格式到提示词需要的格式
    const trades = result.rows.map((row: any) => {
      return {
        symbol: row.symbol,
        side: row.side, // long/short
        type: row.type, // open/close
        price: Number.parseFloat(row.price || "0"),
        quantity: Number.parseFloat(row.quantity || "0"),
        leverage: Number.parseInt(row.leverage || "1"),
        pnl: row.pnl ? Number.parseFloat(row.pnl) : null,
        fee: Number.parseFloat(row.fee || "0"),
        timestamp: row.timestamp,
        status: row.status,
      };
    });
    
    // 按时间正序排列（最旧 → 最新）
    trades.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    return trades;
  } catch (error) {
    logger.error("获取历史成交记录失败:", error as any);
    return [];
  }
}

/**
 * 获取最近N次的AI决策记录
 */
async function getRecentDecisions(limit: number = 3) {
  try {
    const result = await dbClient.execute({
      sql: `SELECT timestamp, iteration, decision, account_value, positions_count 
            FROM agent_decisions 
            ORDER BY timestamp DESC 
            LIMIT ?`,
      args: [limit],
    });
    
    if (!result.rows || result.rows.length === 0) {
      return [];
    }
    
    // 返回格式化的决策记录（从旧到新）
    return result.rows.reverse().map((row: any) => ({
      timestamp: row.timestamp,
      iteration: row.iteration,
      decision: row.decision,
      account_value: Number.parseFloat(row.account_value || "0"),
      positions_count: Number.parseInt(row.positions_count || "0"),
    }));
  } catch (error) {
    logger.error("获取最近决策记录失败:", error as any);
    return [];
  }
}

/**
 * 同步风险配置到数据库
 */
async function syncConfigToDatabase() {
  try {
    const config = getAccountRiskConfig();
    const timestamp = getChinaTimeISO();
    
    // 更新或插入配置
    await dbClient.execute({
      sql: `INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)`,
      args: ['account_stop_loss_usdt', config.stopLossUsdt.toString(), timestamp],
    });
    
    await dbClient.execute({
      sql: `INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)`,
      args: ['account_take_profit_usdt', config.takeProfitUsdt.toString(), timestamp],
    });
    
    logger.info(`配置已同步到数据库: 止损线=${config.stopLossUsdt} USDT, 止盈线=${config.takeProfitUsdt} USDT`);
  } catch (error) {
    logger.error("同步配置到数据库失败:", error as any);
  }
}

/**
 * 从数据库加载风险配置
 */
async function loadConfigFromDatabase() {
  try {
    const stopLossResult = await dbClient.execute({
      sql: `SELECT value FROM system_config WHERE key = ?`,
      args: ['account_stop_loss_usdt'],
    });
    
    const takeProfitResult = await dbClient.execute({
      sql: `SELECT value FROM system_config WHERE key = ?`,
      args: ['account_take_profit_usdt'],
    });
    
    if (stopLossResult.rows.length > 0 && takeProfitResult.rows.length > 0) {
      accountRiskConfig = {
        stopLossUsdt: Number.parseFloat(stopLossResult.rows[0].value as string),
        takeProfitUsdt: Number.parseFloat(takeProfitResult.rows[0].value as string),
        syncOnStartup: accountRiskConfig.syncOnStartup,
      };
      
      logger.info(`从数据库加载配置: 止损线=${accountRiskConfig.stopLossUsdt} USDT, 止盈线=${accountRiskConfig.takeProfitUsdt} USDT`);
    }
  } catch (error) {
    logger.warn("从数据库加载配置失败，使用环境变量配置:", error as any);
  }
}

/**
 * 清仓所有持仓
 */
async function closeAllPositions(reason: string): Promise<void> {
  const tradingClient = createTradingClient();
  
  try {
    logger.warn(`清仓所有持仓，原因: ${reason}`);
    
    const positions = await tradingClient.getPositions();
    const activePositions = positions.filter((p: any) => Number.parseInt(p.size || "0") !== 0);
    
    if (activePositions.length === 0) {
      return;
    }
    
    for (const pos of activePositions) {
      const size = Number.parseInt(pos.size || "0");
      const contract = pos.contract;
      const symbol = contract.replace("_USDT", "");
      
      try {
        await tradingClient.placeOrder({
          contract,
          size: 0 - size,
          price: 0, // 市价单必须传 price: 0
        });
        
        logger.info(`已平仓: ${symbol} ${Math.abs(size)}张`);
      } catch (error) {
        logger.error(`平仓失败: ${symbol}`, error as any);
      }
    }
    
    logger.warn(`清仓完成`);
  } catch (error) {
    logger.error("清仓失败:", error as any);
    throw error;
  }
}

/**
 * 检查账户余额是否触发止损或止盈
 * @returns true: 触发退出条件, false: 继续运行
 */
async function checkAccountThresholds(accountInfo: any): Promise<boolean> {
  const totalBalance = accountInfo.totalBalance;
  
  // 检查止损线
  if (totalBalance <= accountRiskConfig.stopLossUsdt) {
    logger.error(`触发止损线！余额: ${totalBalance.toFixed(2)} USDT <= ${accountRiskConfig.stopLossUsdt} USDT`);
    await closeAllPositions(`账户余额触发止损线 (${totalBalance.toFixed(2)} USDT)`);
    return true;
  }
  
  // 检查止盈线
  if (totalBalance >= accountRiskConfig.takeProfitUsdt) {
    logger.warn(`触发止盈线！余额: ${totalBalance.toFixed(2)} USDT >= ${accountRiskConfig.takeProfitUsdt} USDT`);
    await closeAllPositions(`账户余额触发止盈线 (${totalBalance.toFixed(2)} USDT)`);
    return true;
  }
  
  return false;
}

/**
 * 执行交易决策
 * 🔥 优化：增强错误处理和数据验证，确保数据实时准确
 */
async function executeTradingDecision() {
  iterationCount++;
  const minutesElapsed = Math.floor((Date.now() - tradingStartTime.getTime()) / 60000);
  const intervalMinutes = Number.parseInt(process.env.TRADING_INTERVAL_MINUTES || "5");
  
  logger.info(`\n${"=".repeat(80)}`);
  logger.info(`交易周期 #${iterationCount} (运行${minutesElapsed}分钟)`);
  logger.info(`${"=".repeat(80)}\n`);

  let marketData: any = {};
  let accountInfo: any = null;
  let positions: any[] = [];

  try {
    // 1. 收集市场数据
    try {
      marketData = await collectMarketData();
      const validSymbols = SYMBOLS.filter(symbol => {
        const data = marketData[symbol];
        if (!data || data.price === 0) {
          return false;
        }
        return true;
      });
      
      if (validSymbols.length === 0) {
        logger.error("市场数据获取失败，跳过本次循环");
        return;
      }
    } catch (error) {
      logger.error("收集市场数据失败:", error as any);
      return;
    }
    
    // 2. 获取账户信息
    try {
      accountInfo = await getAccountInfo();
      
      if (!accountInfo || accountInfo.totalBalance === 0) {
        logger.error("账户数据异常，跳过本次循环");
        return;
      }
      
      // 检查账户余额是否触发止损或止盈
      const shouldExit = await checkAccountThresholds(accountInfo);
      if (shouldExit) {
        logger.error("账户余额触发退出条件，系统即将停止！");
        setTimeout(() => {
          process.exit(0);
        }, 5000);
        return;
      }
      
    } catch (error) {
      logger.error("获取账户信息失败:", error as any);
      return;
    }
    
    // 3. 同步持仓信息（优化：只调用一次API，避免重复）
    try {
      const tradingClient = createTradingClient();
      const rawGatePositions = await tradingClient.getPositions();
      
      // 使用同一份数据进行处理和同步，避免重复调用API
      positions = await getPositions(rawGatePositions);
      await syncPositionsFromGate(rawGatePositions);
      
      const dbPositions = await dbClient.execute("SELECT COUNT(*) as count FROM positions");
      const dbCount = (dbPositions.rows[0] as any).count;
      
      if (positions.length !== dbCount) {
        logger.warn(`持仓同步不一致: Gate=${positions.length}, DB=${dbCount}`);
        // 再次同步，使用同一份数据
        await syncPositionsFromGate(rawGatePositions);
      }
    } catch (error) {
      logger.error("持仓同步失败:", error as any);
    }
    
    // 4. ====== 强制风控检查（在AI执行前） ======
    const tradingClient = createTradingClient();
    
    for (const pos of positions) {
      const symbol = pos.symbol;
      const side = pos.side;
      const leverage = pos.leverage;
      const entryPrice = pos.entry_price;
      const currentPrice = pos.current_price;
      
      // 计算盈亏百分比（考虑杠杆）
      const priceChangePercent = entryPrice > 0 
        ? ((currentPrice - entryPrice) / entryPrice * 100 * (side === 'long' ? 1 : -1))
        : 0;
      const pnlPercent = priceChangePercent * leverage;
      
      // 获取并更新峰值盈利
      let peakPnlPercent = 0;
      try {
        const dbPosResult = await dbClient.execute({
          sql: "SELECT peak_pnl_percent FROM positions WHERE symbol = ?",
          args: [symbol],
        });
        
        if (dbPosResult.rows.length > 0) {
          peakPnlPercent = Number.parseFloat(dbPosResult.rows[0].peak_pnl_percent as string || "0");
          
          // 如果当前盈亏超过历史峰值，更新峰值
          if (pnlPercent > peakPnlPercent) {
            peakPnlPercent = pnlPercent;
            await dbClient.execute({
              sql: "UPDATE positions SET peak_pnl_percent = ? WHERE symbol = ?",
              args: [peakPnlPercent, symbol],
            });
            logger.info(`${symbol} 峰值盈利更新: ${peakPnlPercent.toFixed(2)}%`);
          }
        }
      } catch (error: any) {
        logger.warn(`获取峰值盈利失败 ${symbol}: ${error.message}`);
      }
      
      let shouldClose = false;
      let closeReason = "";
      
      // a) 36小时强制平仓检查
      const openedTime = new Date(pos.opened_at);
      const now = new Date();
      const holdingHours = (now.getTime() - openedTime.getTime()) / (1000 * 60 * 60);
      
      if (holdingHours >= 36) {
        shouldClose = true;
        closeReason = `持仓时间已达 ${holdingHours.toFixed(1)} 小时，超过36小时限制`;
      }
      
      // b) 动态止损检查（根据杠杆）
      let stopLossPercent = -5; // 默认
      if (leverage >= 12) {
        stopLossPercent = -3;
      } else if (leverage >= 8) {
        stopLossPercent = -4;
      } else {
        stopLossPercent = -5;
      }
      
      if (pnlPercent <= stopLossPercent) {
        shouldClose = true;
        closeReason = `触发动态止损 (${pnlPercent.toFixed(2)}% ≤ ${stopLossPercent}%)`;
      }
      
      // c) 移动止盈检查
      if (!shouldClose) {
        let trailingStopPercent = stopLossPercent; // 默认使用初始止损
        
        if (pnlPercent >= 25) {
          trailingStopPercent = 15;
        } else if (pnlPercent >= 15) {
          trailingStopPercent = 8;
        } else if (pnlPercent >= 8) {
          trailingStopPercent = 3;
        }
        
        // 如果当前盈亏低于移动止盈线
        if (pnlPercent < trailingStopPercent && trailingStopPercent > stopLossPercent) {
          shouldClose = true;
          closeReason = `触发移动止盈 (当前 ${pnlPercent.toFixed(2)}% < 移动止损线 ${trailingStopPercent}%)`;
        }
      }
      
      // d) 峰值回撤保护（如果持仓曾盈利）
      if (!shouldClose && peakPnlPercent > 5) {
        // 只对曾经盈利超过5%的持仓启用峰值回撤保护
        const drawdownFromPeak = peakPnlPercent > 0 
          ? ((peakPnlPercent - pnlPercent) / peakPnlPercent) * 100 
          : 0;
        
        if (drawdownFromPeak >= 30) {
          shouldClose = true;
          closeReason = `触发峰值回撤保护 (峰值 ${peakPnlPercent.toFixed(2)}% → 当前 ${pnlPercent.toFixed(2)}%，回撤 ${drawdownFromPeak.toFixed(1)}% ≥ 30%)`;
        }
      }
      
      // 执行强制平仓
      if (shouldClose) {
        logger.warn(`【强制平仓】${symbol} ${side} - ${closeReason}`);
        try {
          const contract = `${symbol}_USDT`;
          const size = side === 'long' ? -pos.quantity : pos.quantity;
          
          await tradingClient.placeOrder({
            contract,
            size,
            price: 0,
            reduceOnly: true,
          });
          
          logger.info(`✅ 已强制平仓 ${symbol}，原因：${closeReason}`);
          
          // 从数据库删除持仓记录
          await dbClient.execute({
            sql: "DELETE FROM positions WHERE symbol = ?",
            args: [symbol],
          });
          
        } catch (closeError: any) {
          logger.error(`强制平仓失败 ${symbol}: ${closeError.message}`);
        }
      }
    }
    
    // 重新获取持仓（可能已经被强制平仓）
    positions = await getPositions();
    
    // 4. 不再保存账户历史（已移除资金曲线模块）
    // try {
    //   await saveAccountHistory(accountInfo);
    // } catch (error) {
    //   logger.error("保存账户历史失败:", error as any);
    //   // 不影响主流程
    // }
    
    // 5. 🔥 数据完整性最终检查
    const dataValid = 
      marketData && Object.keys(marketData).length > 0 &&
      accountInfo && accountInfo.totalBalance > 0 &&
      Array.isArray(positions);
    
    if (!dataValid) {
      logger.error("数据完整性检查失败，跳过本次循环");
      logger.error(`市场数据: ${Object.keys(marketData).length}, 账户: ${accountInfo?.totalBalance}, 持仓: ${positions.length}`);
      return;
    }
    
    // 6. 获取历史成交记录（最近10条）
    let tradeHistory: any[] = [];
    try {
      tradeHistory = await getTradeHistory(10);
    } catch (error) {
      logger.warn("获取历史成交记录失败:", error as any);
      // 不影响主流程，继续执行
    }
    
    // 7. 获取上一次的AI决策
    let recentDecisions: any[] = [];
    try {
      recentDecisions = await getRecentDecisions(1);
    } catch (error) {
      logger.warn("获取最近决策记录失败:", error as any);
      // 不影响主流程，继续执行
    }
    
    // 8. 生成提示词并调用 Agent
    const prompt = generateTradingPrompt({
      minutesElapsed,
      iteration: iterationCount,
      intervalMinutes,
      marketData,
      accountInfo,
      positions,
      tradeHistory,
      recentDecisions,
    });
    
    // 🔥 输出完整提示词到日志
    logger.info("【入参 - AI 提示词】");
    logger.info("=".repeat(80));
    logger.info(prompt);
    logger.info("=".repeat(80) + "\n");
    
    const agent = createTradingAgent(intervalMinutes);
    
    // 添加重试逻辑以处理网络超时
    let response: any;
    let retryCount = 0;
    const maxRetries = 2;
    let lastError: Error | null = null;
    
    while (retryCount <= maxRetries) {
      try {
        if (retryCount > 0) {
          logger.warn(`重试 AI 请求 (${retryCount}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, 5000 * retryCount)); // 递增延迟
        }
        
        response = await agent.generateText(prompt);
        break; // 成功，跳出循环
        
      } catch (error: any) {
        lastError = error;
        retryCount++;
        
        if (error.message?.includes('timeout') || error.message?.includes('ETIMEDOUT') || error.name === 'AbortError') {
          logger.error(`AI 请求超时 (尝试 ${retryCount}/${maxRetries + 1}): ${error.message}`);
          
          if (retryCount > maxRetries) {
            logger.error('AI 请求多次超时失败，本次交易周期跳过');
            logger.error('建议检查：');
            logger.error('1. 网络连接是否正常');
            logger.error('2. OpenRouter API 服务是否可用');
            logger.error('3. 是否需要配置代理（HTTP_PROXY/HTTPS_PROXY）');
            
            // 记录失败决策
            await dbClient.execute({
              sql: `INSERT INTO agent_decisions 
                    (timestamp, iteration, market_analysis, decision, actions_taken, account_value, positions_count)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
              args: [
                getChinaTimeISO(),
                iterationCount,
                "AI请求超时，无法完成市场分析",
                "由于网络超时，跳过本次交易周期",
                "[]",
                accountInfo.totalWalletBalance,
                positions.length,
              ],
            });
            
            return; // 跳过本次周期
          }
        } else {
          logger.error(`AI 请求失败: ${error.message}`);
          throw error; // 非超时错误，直接抛出
        }
      }
    }
    
    try {
      
      // 从响应中提取AI的最终决策结果，排除工具调用细节
      let decisionText = "";
      
      if (typeof response === 'string') {
        decisionText = response;
      } else if (response && typeof response === 'object') {
        const steps = (response as any).steps || [];
        
        // 查找最后一次AI的文本回复（这是真正的决策结果）
        for (let i = steps.length - 1; i >= 0; i--) {
          const step = steps[i];
          if (step.content) {
            for (let j = step.content.length - 1; j >= 0; j--) {
              const item = step.content[j];
              if (item.type === 'text' && item.text) {
                decisionText = item.text;
                break;
              }
            }
          }
          if (decisionText) break;
        }
        
        // 如果没有找到文本消息，尝试其他字段
        if (!decisionText) {
          decisionText = (response as any).text || (response as any).message || "";
        }
        
        // 如果还是没有文本回复，说明AI只是调用了工具，没有做出决策
        if (!decisionText && steps.length > 0) {
          decisionText = "AI调用了工具但未产生决策结果";
        }
      }
      
      logger.info("【输出 - AI 决策】");
      logger.info("=".repeat(80));
      logger.info(decisionText || "无决策输出");
      logger.info("=".repeat(80) + "\n");
      
      // 保存决策记录
      await dbClient.execute({
        sql: `INSERT INTO agent_decisions 
              (timestamp, iteration, market_analysis, decision, actions_taken, account_value, positions_count)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          new Date().toISOString(),
          iterationCount,
          JSON.stringify(marketData),
          decisionText,
          "[]",
          accountInfo.totalBalance,
          positions.length,
        ],
      });
      
      // Agent 执行后重新同步持仓数据（优化：只调用一次API）
      const updatedRawPositions = await tradingClient.getPositions();
      await syncPositionsFromGate(updatedRawPositions);
      const updatedPositions = await getPositions(updatedRawPositions);
      
      // 重新获取更新后的账户信息，包含最新的未实现盈亏
      const updatedAccountInfo = await getAccountInfo();
      const finalUnrealizedPnL = updatedPositions.reduce((sum: number, pos: any) => sum + (pos.unrealized_pnl || 0), 0);
      
      logger.info("【最终 - 持仓状态】");
      logger.info("=".repeat(80));
      logger.info(`账户: ${updatedAccountInfo.totalBalance.toFixed(2)} USDT (可用: ${updatedAccountInfo.availableBalance.toFixed(2)}, 收益率: ${updatedAccountInfo.returnPercent.toFixed(2)}%)`);
      
      if (updatedPositions.length === 0) {
        logger.info("持仓: 无");
      } else {
        const exchangeType = process.env.EXCHANGE_TYPE || 'gate';
        logger.info(`持仓: ${updatedPositions.length} 个`);
        updatedPositions.forEach((pos: any) => {
          // 计算盈亏百分比：考虑杠杆倍数
          // 对于杠杆交易：盈亏百分比 = (价格变动百分比) × 杠杆倍数
          const priceChangePercent = pos.entry_price > 0 
            ? ((pos.current_price - pos.entry_price) / pos.entry_price * 100 * (pos.side === 'long' ? 1 : -1))
            : 0;
          const pnlPercent = priceChangePercent * pos.leverage;
          
          // 根据交易所类型显示不同的数量单位
          const quantityDisplay = exchangeType === 'binance' 
            ? `${pos.quantity.toFixed(3)} ${pos.symbol}`  // 币安：0.620 ETH
            : `${pos.quantity}张`;  // Gate.io: 87张
          
          logger.info(`  ${pos.symbol} ${pos.side === 'long' ? '做多' : '做空'} ${quantityDisplay} (入场: ${pos.entry_price.toFixed(2)}, 当前: ${pos.current_price.toFixed(2)}, 盈亏: ${pos.unrealized_pnl >= 0 ? '+' : ''}${pos.unrealized_pnl.toFixed(2)} USDT / ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`);
        });
      }
      
      logger.info(`未实现盈亏: ${finalUnrealizedPnL >= 0 ? '+' : ''}${finalUnrealizedPnL.toFixed(2)} USDT`);
      logger.info("=".repeat(80) + "\n");
      
    } catch (agentError) {
      logger.error("Agent 执行失败:", agentError as any);
      try {
        await syncPositionsFromGate();
      } catch (syncError) {
        logger.error("同步失败:", syncError as any);
      }
    }
    
  } catch (error) {
    logger.error("交易循环执行失败:", error as any);
    try {
      await syncPositionsFromGate();
    } catch (recoveryError) {
      logger.error("恢复失败:", recoveryError as any);
    }
  }
}

/**
 * 初始化交易系统配置
 */
export async function initTradingSystem() {
  logger.info("初始化交易系统配置...");
  
  // 1. 加载配置
  accountRiskConfig = getAccountRiskConfig();
  logger.info(`环境变量配置: 止损线=${accountRiskConfig.stopLossUsdt} USDT, 止盈线=${accountRiskConfig.takeProfitUsdt} USDT`);
  
  // 2. 如果启用了启动时同步，则同步配置到数据库
  if (accountRiskConfig.syncOnStartup) {
    await syncConfigToDatabase();
  } else {
    // 否则从数据库加载配置
    await loadConfigFromDatabase();
  }
  
  logger.info(`最终配置: 止损线=${accountRiskConfig.stopLossUsdt} USDT, 止盈线=${accountRiskConfig.takeProfitUsdt} USDT`);
}

/**
 * 启动交易循环
 */
export function startTradingLoop() {
  const intervalMinutes = Number.parseInt(
    process.env.TRADING_INTERVAL_MINUTES || "5"
  );
  
  logger.info(`启动交易循环，间隔: ${intervalMinutes} 分钟`);
  logger.info(`支持币种: ${SYMBOLS.join(", ")}`);
  
  // 立即执行一次
  executeTradingDecision();
  
  // 设置定时任务
  const cronExpression = `*/${intervalMinutes} * * * *`;
  cron.schedule(cronExpression, () => {
    executeTradingDecision();
  });
  
  logger.info(`定时任务已设置: ${cronExpression}`);
}

/**
 * 重置交易开始时间（用于恢复之前的交易）
 */
export function setTradingStartTime(time: Date) {
  tradingStartTime = time;
}

/**
 * 重置迭代计数（用于恢复之前的交易）
 */
export function setIterationCount(count: number) {
  iterationCount = count;
}

