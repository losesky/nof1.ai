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
 * 交易客户端工厂 - 支持多个交易所
 */
import { createPinoLogger } from "@voltagent/logger";
import { createBinanceClient, BinanceClient } from "./binanceClient";

const logger = createPinoLogger({
  name: "trading-client-factory",
  level: "info",
});

// 通用交易接口
export interface TradingClient {
  getFuturesTicker(contract: string, retries?: number): Promise<any>;
  getFuturesCandles(contract: string, interval?: string, limit?: number, retries?: number): Promise<any>;
  getFuturesAccount(retries?: number): Promise<any>;
  getPositions(retries?: number): Promise<any>;
  placeOrder(params: {
    contract: string;
    size: number;
    price?: number;
    tif?: string;
    reduceOnly?: boolean;
    autoSize?: string;
    stopLoss?: number;
    takeProfit?: number;
  }): Promise<any>;
  getOrder(orderId: string, symbol?: string): Promise<any>;
  cancelOrder(orderId: string, symbol?: string): Promise<any>;
  getOpenOrders(contract?: string): Promise<any>;
  setLeverage(contract: string, leverage: number): Promise<any>;
  getFundingRate(contract: string): Promise<any>;
  getContractInfo(contract: string): Promise<any>;
  getOrderBook(contract: string, limit?: number): Promise<any>;
  getMyTrades(contract?: string, limit?: number): Promise<any>;
  getPositionHistory(contract?: string, limit?: number, offset?: number): Promise<any>;
  getSettlementHistory(contract?: string, limit?: number, offset?: number): Promise<any>;
  getOrderHistory(contract?: string, limit?: number): Promise<any>;
}

/**
 * 全局交易客户端实例（单例模式）
 */
let tradingClientInstance: TradingClient | null = null;

/**
 * 创建全局交易客户端实例（单例模式）
 * 根据环境变量自动选择交易所
 */
export function createTradingClient(): TradingClient {
  // 如果已存在实例，直接返回
  if (tradingClientInstance) {
    return tradingClientInstance;
  }

  // 根据环境变量决定使用哪个交易所
  const exchange = process.env.EXCHANGE_TYPE || "binance"; // 默认使用币安
  
  switch (exchange.toLowerCase()) {
    case "binance":
      logger.info("初始化币安交易客户端");
      tradingClientInstance = createBinanceClient();
      break;
    
    case "gate":
    case "gateio":
      logger.warn("当前仅支持币安交易所，Gate.io交易所功能正在开发中...");
      logger.info("默认使用币安交易客户端");
      tradingClientInstance = createBinanceClient();
      break;
    
    default:
      logger.error(`不支持的交易所类型: ${exchange}`);
      throw new Error(`不支持的交易所类型: ${exchange}`);
  }

  if (!tradingClientInstance) {
    throw new Error("交易客户端初始化失败");
  }

  return tradingClientInstance;
}

/**
 * 重置客户端实例（用于测试或重新配置）
 */
export function resetTradingClient(): void {
  tradingClientInstance = null;
}

/**
 * 获取当前使用的交易所名称
 */
export function getCurrentExchange(): string {
  return process.env.EXCHANGE_TYPE || "binance";
}
