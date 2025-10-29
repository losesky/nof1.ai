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
 * 币安 U本位合约 API 客户端封装
 */
import { createPinoLogger } from "@voltagent/logger";
import { RISK_PARAMS } from "../config/riskParams";
import crypto from "crypto";
import { TradingClient } from "./tradingClientFactory";

const logger = createPinoLogger({
  name: "binance-client",
  level: "info",
});

export class BinanceClient implements TradingClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;
  private timeOffset = 0;
  private readonly defaultRecvWindow = 5000;

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    
    const isTestnet = process.env.BINANCE_USE_TESTNET === "true";
    this.baseUrl = isTestnet 
      ? "https://testnet.binancefuture.com" 
      : "https://fapi.binance.com";
    
    if (isTestnet) {
      logger.info("使用币安 U本位合约测试网");
    } else {
      logger.info("使用币安 U本位合约正式网");
    }
    
    logger.info("币安 API 客户端初始化完成");

    // 初始化时同步服务器时间
    this.syncServerTime().catch(error => {
      logger.warn("同步服务器时间失败:", error as Error);
    });
  }

  /**
   * 同步服务器时间
   */
  private async syncServerTime(): Promise<void> {
    try {
      const response = await this.publicRequest("/fapi/v1/time");
      const serverTime = response.serverTime;
      this.timeOffset = serverTime - Date.now();
      logger.info(`服务器时间同步完成，偏差: ${this.timeOffset}ms`);
    } catch (error) {
      logger.error("同步服务器时间失败:", error as Error);
      throw error;
    }
  }

  /**
   * 获取当前服务器时间
   */
  private getServerTime(): number {
    return Date.now() + this.timeOffset;
  }

  /**
   * 生成签名
   */
  private generateSignature(data: any): string {
    const queryString = Object.keys(data)
      .map(key => `${key}=${data[key]}`)
      .join("&");
    return crypto
      .createHmac("sha256", this.apiSecret)
      .update(queryString)
      .digest("hex");
  }

  /**
   * 处理API请求，包含重试、超时和错误处理逻辑
   */
  private async handleRequest(url: URL, options: RequestInit, retries = 3): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒超时

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        options.signal = controller.signal;
        const response = await fetch(url.toString(), options);
        clearTimeout(timeoutId);

        if (!response.ok) {
          const error = await response.json();
          if (attempt === retries) {
            logger.error(`API请求失败(${attempt}/${retries}):`, error);
            throw new Error(`API请求失败: ${error.msg || error.message || response.statusText}`);
          }
          logger.warn(`API请求失败(${attempt}/${retries}):`, error);
          await new Promise(resolve => setTimeout(resolve, Math.min(1000 * attempt, 3000)));
          continue;
        }

        return response.json();

      } catch (error: any) {
        clearTimeout(timeoutId);

        const isTimeout = error.name === 'AbortError' || 
                         error.message?.includes('timeout') ||
                         error.message?.includes('network error');

        if (attempt === retries) {
          logger.error(`API请求失败(${attempt}/${retries}):`, error);
          throw error;
        }

        logger.warn(`API请求失败(${attempt}/${retries}), ${isTimeout ? '超时' : '错误'}:`, error);
        
        const delay = isTimeout ? 
          Math.min(2000 * attempt, 5000) : // 超时情况：2秒、4秒、5秒
          Math.min(1000 * attempt, 3000);  // 其他错误：1秒、2秒、3秒
          
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error(`API请求失败，已重试${retries}次`);
  }

  /**
   * 发送公共请求
   */
  private async publicRequest(endpoint: string, params: any = {}, retries = 3): Promise<any> {
    const url = new URL(this.baseUrl + endpoint);
    Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

    return this.handleRequest(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 NOF1.AI Crypto Bot',
      }
    }, retries);
  }

  /**
   * 发送私有请求（需要签名）
   */
  private async privateRequest(endpoint: string, params: any = {}, method = "GET", retries = 3): Promise<any> {
    const timestamp = this.getServerTime();
    const data = {
      ...params,
      timestamp,
      recvWindow: this.defaultRecvWindow
    };
    
    // 生成签名
    const signature = this.generateSignature(data);
    data.signature = signature;

    // 准备请求URL和选项
    const url = new URL(this.baseUrl + endpoint);
    const options: RequestInit = {
      method,
      headers: {
        "X-MBX-APIKEY": this.apiKey,
        'User-Agent': 'Mozilla/5.0 NOF1.AI Crypto Bot',
      }
    };

    if (method === "GET" || method === "DELETE") {
      Object.keys(data).forEach(key => url.searchParams.append(key, data[key]));
    } else {
      options.body = new URLSearchParams(data);
      options.headers = {
        ...options.headers,
        "Content-Type": "application/x-www-form-urlencoded"
      };
    }

    return this.handleRequest(url, options, retries);
  }
  
  async getFuturesTicker(contract: string): Promise<any> {
    const symbol = contract.replace("_", "");
    const [ticker, markPrice] = await Promise.all([
      this.publicRequest("/fapi/v1/ticker/24hr", { symbol }),
      this.publicRequest("/fapi/v1/premiumIndex", { symbol })
    ]);
    
    return {
      last: ticker.lastPrice,
      markPrice: markPrice.markPrice,
      lowest_24h: ticker.lowPrice,
      highest_24h: ticker.highPrice,
      volume_24h: ticker.volume,
      volume_24h_usd: ticker.quoteVolume,
      priceChangePercent: ticker.priceChangePercent
    };
  }

  async getFuturesCandles(contract: string, interval = "1h", limit = 100): Promise<any> {
    const symbol = contract.replace("_", "");
    const response = await this.publicRequest("/fapi/v1/klines", {
      symbol,
      interval,
      limit,
      // 确保获取最新的K线数据
      endTime: Date.now()
    });

    return response.map((k: any[]) => ({
      timestamp: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      quoteVolume: parseFloat(k[7]), // 新增：计价资产成交量（USDT）
      trades: parseInt(k[8], 10),    // 新增：成交笔数
      isClosed: true                 // 标记是否是已完成的K线
    }));
  }

  async getFuturesAccount(retries = 2): Promise<any> {
    const account = await this.privateRequest("/fapi/v2/account");
    return {
      total: account.totalWalletBalance,
      available: account.availableBalance,
      unrealizedPnl: account.totalUnrealizedProfit,
      maintenanceMargin: account.totalMaintMargin,
      marginBalance: account.totalMarginBalance,
      initialMargin: account.totalInitialMargin,
    };
  }

  async getPositions(retries = 2): Promise<any> {
    const positions = await this.privateRequest("/fapi/v2/positionRisk");
    return positions
      .filter((p: any) => parseFloat(p.positionAmt) !== 0)
      .map((p: any) => {
        const posAmount = parseFloat(p.positionAmt);
        return {
          contract: p.symbol,
          size: posAmount,
          entryPrice: parseFloat(p.entryPrice),
          markPrice: parseFloat(p.markPrice),
          unrealizedPnl: parseFloat(p.unRealizedProfit),
          leverage: parseInt(p.leverage),
          marginType: p.marginType,
          side: posAmount > 0 ? "long" : "short",
          liquidationPrice: parseFloat(p.liquidationPrice),
          liq_price: p.liquidationPrice // 添加 Gate.io 风格的字段名
        };
      });
  }

  async placeOrder(params: {
    contract: string;
    size: number;
    price?: number;
    tif?: string;
    reduceOnly?: boolean;
    autoSize?: string;
    stopLoss?: number;
    takeProfit?: number;
  }): Promise<any> {
    const symbol = params.contract.replace("_", "");
    const orderType = params.price ? "LIMIT" : "MARKET";
    
    // 币安使用 quantity 字段（币种数量），而不是 size
    // size 参数已经是正确的币种数量（带正负号表示方向）
    const quantity = Math.abs(params.size);
    
    const data: any = {
      symbol,
      side: params.size > 0 ? "BUY" : "SELL",
      type: orderType,
      quantity: quantity.toString() // 转为字符串确保精度
    };

    if (params.price) {
      data.price = params.price.toString();
      data.timeInForce = params.tif || "GTC";
    }

    if (params.reduceOnly) {
      data.reduceOnly = true;
    }

    const response = await this.privateRequest("/fapi/v1/order", data, "POST");
    
    // 适配返回格式以匹配 Gate.io 的结构
    return {
      id: response.orderId,
      status: response.status === 'FILLED' ? 'finished' : 
              response.status === 'NEW' ? 'open' : 
              response.status.toLowerCase(),
      contract: response.symbol,
      size: params.size,
      price: response.avgPrice || response.price || "0",
      fill_price: response.avgPrice || "0",
      left: (parseFloat(response.origQty || "0") - parseFloat(response.executedQty || "0")).toString()
    };
  }

  async getOrder(orderId: string, symbol?: string): Promise<any> {
    if (!symbol) {
      throw new Error("Symbol is required for getting order");
    }
    const response = await this.privateRequest("/fapi/v1/order", {
      symbol: symbol.replace("_", ""),
      orderId
    });
    
    // 适配返回格式以匹配 Gate.io 的结构
    return {
      id: response.orderId,
      status: response.status === 'FILLED' ? 'finished' : 
              response.status === 'NEW' ? 'open' : 
              response.status === 'CANCELED' ? 'cancelled' :
              response.status.toLowerCase(),
      contract: response.symbol,
      size: (response.side === 'BUY' ? 1 : -1) * parseFloat(response.origQty || "0"),
      price: response.price || "0",
      fill_price: response.avgPrice || "0",
      left: (parseFloat(response.origQty || "0") - parseFloat(response.executedQty || "0")).toString()
    };
  }

  async cancelOrder(orderId: string, symbol?: string): Promise<any> {
    if (!symbol) {
      throw new Error("Symbol is required for canceling order");
    }
    return this.privateRequest("/fapi/v1/order", {
      symbol: symbol.replace("_", ""),
      orderId
    }, "DELETE");
  }

  async getOpenOrders(contract?: string): Promise<any> {
    const params: any = {};
    if (contract) {
      params.symbol = contract.replace("_", "");
    }
    return this.privateRequest("/fapi/v1/openOrders", params);
  }

  async setLeverage(contract: string, leverage: number): Promise<any> {
    return this.privateRequest("/fapi/v1/leverage", {
      symbol: contract.replace("_", ""),
      leverage
    }, "POST");
  }

  async getFundingRate(contract: string): Promise<any> {
    const response = await this.publicRequest("/fapi/v1/premiumIndex", {
      symbol: contract.replace("_", "")
    });
    return {
      funding_rate: response.lastFundingRate,
      next_funding_time: response.nextFundingTime
    };
  }

  async getContractInfo(contract: string): Promise<any> {
    const response = await this.publicRequest("/fapi/v1/exchangeInfo");
    const symbol = contract.replace("_", "");
    const symbolInfo = response.symbols.find((s: any) => s.symbol === symbol);
    if (!symbolInfo) {
      throw new Error(`Contract ${contract} not found`);
    }
    
    // 适配 Gate.io 格式，添加常用字段
    return {
      ...symbolInfo,
      quantoMultiplier: "1", // 币安不使用 quantoMultiplier，直接使用币种数量
      orderSizeMin: symbolInfo.filters?.find((f: any) => f.filterType === 'LOT_SIZE')?.minQty || "0.001",
      orderSizeMax: symbolInfo.filters?.find((f: any) => f.filterType === 'LOT_SIZE')?.maxQty || "1000000"
    };
  }

  async getOrderBook(contract: string, limit?: number): Promise<any> {
    return this.publicRequest("/fapi/v1/depth", {
      symbol: contract.replace("_", ""),
      limit: limit || 100
    });
  }

  async getMyTrades(contract?: string, limit?: number): Promise<any> {
    const params: any = {};
    if (contract) {
      params.symbol = contract.replace("_", "");
    }
    if (limit) {
      params.limit = limit;
    }
    return this.privateRequest("/fapi/v1/userTrades", params);
  }

  async getPositionHistory(contract?: string, limit?: number, offset?: number): Promise<any> {
    // Binance doesn't have a direct position history endpoint, return empty array
    return [];
  }

  async getSettlementHistory(contract?: string, limit?: number, offset?: number): Promise<any> {
    // Binance doesn't have a direct settlement history endpoint, return empty array
    return [];
  }

  async getOrderHistory(contract?: string, limit?: number): Promise<any> {
    const params: any = {};
    if (contract) {
      params.symbol = contract.replace("_", "");
    }
    if (limit) {
      params.limit = limit;
    }
    return this.privateRequest("/fapi/v1/allOrders", params);
  }
}

/**
 * 全局币安客户端实例（单例模式）
 */
let binanceClientInstance: BinanceClient | null = null;

/**
 * 创建全局币安客户端实例（单例模式）
 */
export function createBinanceClient(): BinanceClient {
  // 如果已存在实例，直接返回
  if (binanceClientInstance) {
    return binanceClientInstance;
  }

  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error("BINANCE_API_KEY 和 BINANCE_API_SECRET 必须在环境变量中设置");
  }

  // 创建并缓存实例
  binanceClientInstance = new BinanceClient(apiKey, apiSecret);
  return binanceClientInstance;
}
