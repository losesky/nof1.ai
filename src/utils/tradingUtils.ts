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
 * 交易相关工具函数
 */
import { getCurrentExchange } from "../services/tradingClientFactory";

/**
 * 根据交易所格式化合约名称
 */
export function formatContract(symbol: string): string {
  const exchange = getCurrentExchange();
  if (exchange === "binance") {
    return `${symbol}USDT`;
  } else {
    return `${symbol}_USDT`;
  }
}

/**
 * 解析合约名称获取基础币种
 */
export function parseSymbolFromContract(contract: string): string {
  if (contract.includes('_')) {
    // Gate.io 格式: BTC_USDT
    return contract.split('_')[0];
  } else if (contract.endsWith('USDT')) {
    // 币安格式: BTCUSDT
    return contract.replace('USDT', '');
  }
  return contract;
}
