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
 * 基础风险参数配置（从环境变量读取，支持灵活配置）
 */

// 从环境变量读取交易币种列表（逗号分隔）
const DEFAULT_TRADING_SYMBOLS = 'BTC,ETH,SOL,XRP,BNB,DOGE';
const tradingSymbolsStr = process.env.TRADING_SYMBOLS || DEFAULT_TRADING_SYMBOLS;
const tradingSymbols = tradingSymbolsStr.split(',').map(s => s.trim()).filter(s => s.length > 0);

// 从环境变量读取配置，提供默认值
export const RISK_PARAMS = {
  // 最大持仓数
  MAX_POSITIONS: Number.parseInt(process.env.MAX_POSITIONS || '5', 10),
  
  // 最大杠杆倍数
  MAX_LEVERAGE: Number.parseInt(process.env.MAX_LEVERAGE || '15', 10),
  
  // 交易币种列表（作为元组以支持 zod.enum）
  TRADING_SYMBOLS: tradingSymbols as [string, ...string[]],
  
  // 最大持仓小时数
  MAX_HOLDING_HOURS: Number.parseInt(process.env.MAX_HOLDING_HOURS || '36', 10),
  
  // 最大持仓周期数（根据持仓小时数自动计算：小时数 * 6，因为每10分钟一个周期）
  get MAX_HOLDING_CYCLES() {
    return this.MAX_HOLDING_HOURS * 6;
  },
  
  // 账户最大回撤百分比（触发后停止交易）
  ACCOUNT_MAX_DRAWDOWN_PERCENT: Number.parseInt(process.env.ACCOUNT_MAX_DRAWDOWN_PERCENT || '15', 10),
} as const;

// 市场数据质量参数
export const MARKET_DATA_QUALITY = {
  // 最大价格偏差（现货价格与标记价格的最大允许偏差）
  MAX_PRICE_DEVIATION: 0.005, // 0.5%
  
  // K线数据最大允许延迟（毫秒）
  MAX_CANDLE_AGE: {
    MAINNET: 5 * 60 * 1000,   // 主网 5 分钟
    TESTNET: 15 * 60 * 1000   // 测试网 15 分钟
  },
  
  // 重试设置
  RETRY: {
    MAX_ATTEMPTS: 3,          // 最大重试次数
    BASE_DELAY: 1000,         // 基础延迟（毫秒）
    MAX_DELAY: 5000          // 最大延迟（毫秒）
  }
} as const;

