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
 * API 路由
 */
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { createClient } from "@libsql/client";
import { createTradingClient } from "../services/tradingClientFactory";
import { createPinoLogger } from "@voltagent/logger";

const logger = createPinoLogger({
  name: "api-routes",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

export function createApiRoutes() {
  const app = new Hono();

  // 静态文件服务 - 需要使用绝对路径
  app.use("/*", serveStatic({ root: "./public" }));

  /**
   * 获取账户总览
   * 
   * 账户结构说明：
   * Binance USDT-M：
   * - totalWalletBalance: 钱包总余额（包含未实现盈亏）
   * - availableBalance: 可用余额
   * - totalInitialMargin: 所有持仓的起始保证金之和
   * - totalMaintMargin: 所有持仓的维持保证金之和
   * - totalUnrealizedProfit: 未实现盈亏
   * 
   * Gate.io：
   * - total = available + positionMargin + unrealisedPnl
   * - total 包含未实现盈亏
   */
  app.get("/api/account", async (c) => {
    try {
      const EXCHANGE_TYPE = process.env.EXCHANGE_TYPE || 'binance';
      const tradingClient = createTradingClient();
      const account = await tradingClient.getFuturesAccount();
      
      // 从数据库获取初始资金
      const initialResult = await dbClient.execute(
        "SELECT total_value FROM account_history ORDER BY timestamp ASC LIMIT 1"
      );
      const initialBalance = initialResult.rows[0]
        ? Number.parseFloat(initialResult.rows[0].total_value as string)
        : 100;
      
      let totalBalance: number;
      let available: number;
      let positionMargin: number;
      let unrealisedPnl: number;
      let maintenanceMargin: number;
      let marginBalance: number;
      let marginRatio: number;
      
      if (EXCHANGE_TYPE === 'binance') {
        // === Binance U本位合约精确计算 ===
        // binanceClient 已经返回了映射后的字段
        
        // 总资产（从 account.total 获取，这是 totalWalletBalance）
        totalBalance = Number.parseFloat(account.total || "0");
        
        // 可用余额
        available = Number.parseFloat(account.available || "0");
        
        // 起始保证金（所有持仓占用的保证金）
        positionMargin = Number.parseFloat(account.initialMargin || "0");
        
        // 未实现盈亏
        unrealisedPnl = Number.parseFloat(account.unrealizedPnl || "0");
        
        // 维持保证金（所有持仓的维持保证金之和）
        maintenanceMargin = Number.parseFloat(account.maintenanceMargin || "0");
        
        // 保证金余额（从 marginBalance 字段获取，这是 totalMarginBalance）
        marginBalance = Number.parseFloat(account.marginBalance || totalBalance || "0");
        
        // 保证金比例 = 维持保证金 / 保证金余额（按 Binance 口径）
        // 当保证金比例达到100%时会被强平
        marginRatio = marginBalance > 0 ? (maintenanceMargin / marginBalance) * 100 : 0;
        
        // logger.info(`Binance账户数据: 钱包余额=${totalBalance.toFixed(2)}, 可用=${available.toFixed(2)}, 起始保证金=${positionMargin.toFixed(2)}, 维持保证金=${maintenanceMargin.toFixed(2)}, 保证金余额=${marginBalance.toFixed(2)}, 保证金比例=${marginRatio.toFixed(2)}%`);
        
      } else {
        // === Gate.io 或其他交易所 ===
        const total = Number.parseFloat(account.total || "0");
        available = Number.parseFloat(account.available || "0");
        positionMargin = Number.parseFloat(
          account.initialMargin || account.position_margin || account.positionMargin || "0"
        );
        unrealisedPnl = Number.parseFloat(
          account.unrealizedPnl || account.unrealised_pnl || account.unrealisedPnl || "0"
        );
        
        // Gate.io: total 包含未实现盈亏，需要减去
        totalBalance = total - unrealisedPnl;
        
        // Gate.io 维持保证金估算（10%）
        maintenanceMargin = positionMargin * 0.1;
        marginBalance = totalBalance;
        marginRatio = marginBalance > 0 ? (maintenanceMargin / marginBalance) * 100 : 0;
      }
      
      // 收益率 = (总资产 - 初始资金) / 初始资金 * 100
      const returnPercent = ((totalBalance - initialBalance) / initialBalance) * 100;
      
      return c.json({
        totalBalance,           // 总资产（钱包余额，不包含未实现盈亏）
        availableBalance: available,
        positionMargin,         // 起始保证金/持仓保证金
        maintenanceMargin,      // 维持保证金（精确值）
        marginBalance,          // 保证金余额（用于计算比例）
        marginRatio,            // 保证金比例（%）
        unrealisedPnl,
        returnPercent,
        initialBalance,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      logger.error("获取账户信息失败:", error);
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * 获取当前持仓 - 从 Gate.io 获取实时数据
   */
  app.get("/api/positions", async (c) => {
    try {
      const gateClient = createTradingClient();
      const gatePositions = await gateClient.getPositions();
      
      // 从数据库获取止损止盈信息
      const dbResult = await dbClient.execute("SELECT symbol, stop_loss, profit_target FROM positions");
      const dbPositionsMap = new Map(
        dbResult.rows.map((row: any) => [row.symbol, row])
      );
      
      // 过滤并格式化持仓
      const positions = gatePositions
        .filter((p: any) => Math.abs(Number.parseFloat(p.size || "0")) > 0)
        .map((p: any) => {
          const size = Number.parseFloat(p.size || "0");
          const symbol = p.contract.replace(/_USDT|USDT/g, "");
          const dbPos = dbPositionsMap.get(symbol);
          
          // 统一字段名处理（兼容 Binance 和 Gate.io）
          // Binance: entryPrice, markPrice, unrealizedPnl
          // Gate.io: entry_price/entryPrice, mark_price/markPrice, unrealised_pnl/unrealisedPnl
          const entryPrice = Number.parseFloat(p.entryPrice || p.entry_price || "0");
          const markPrice = Number.parseFloat(p.markPrice || p.mark_price || "0");
          const liqPrice = Number.parseFloat(p.liquidationPrice || p.liq_price || p.liqPrice || "0");
          const unrealizedPnl = Number.parseFloat(p.unrealizedPnl || p.unrealised_pnl || p.unrealisedPnl || "0");
          const margin = Number.parseFloat(p.margin || "0");
          
          const quantity = Math.abs(size);
          const leverage = Number.parseInt(p.leverage || "1");
          
          // 开仓价值（保证金）计算
          // Gate.io 有 margin 字段，Binance 需要计算
          const openValue = margin > 0 ? margin : (quantity * entryPrice / leverage);
          
          return {
            symbol,
            quantity,
            entryPrice,
            currentPrice: markPrice,
            liquidationPrice: liqPrice,
            unrealizedPnl,
            leverage,
            side: size > 0 ? "long" : "short",
            openValue,
            profitTarget: dbPos?.profit_target ? Number(dbPos.profit_target) : null,
            stopLoss: dbPos?.stop_loss ? Number(dbPos.stop_loss) : null,
            openedAt: p.create_time || new Date().toISOString(),
          };
        });
      
      return c.json({ positions });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * 获取账户价值历史（用于绘图）
   */
  app.get("/api/history", async (c) => {
    try {
      const limit = c.req.query("limit") || "100";
      
      const result = await dbClient.execute({
        sql: `SELECT timestamp, total_value, unrealized_pnl, return_percent 
              FROM account_history 
              ORDER BY timestamp DESC 
              LIMIT ?`,
        args: [Number.parseInt(limit)],
      });
      
      const history = result.rows.map((row: any) => ({
        timestamp: row.timestamp,
        totalValue: Number.parseFloat(row.total_value as string) || 0,
        unrealizedPnl: Number.parseFloat(row.unrealized_pnl as string) || 0,
        returnPercent: Number.parseFloat(row.return_percent as string) || 0,
      })).reverse(); // 反转，使时间从旧到新
      
      return c.json({ history });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * 获取交易记录 - 从数据库获取历史仓位（已平仓的记录）
   */
  app.get("/api/trades", async (c) => {
    try {
      const limit = Number.parseInt(c.req.query("limit") || "10");
      const symbol = c.req.query("symbol"); // 可选，筛选特定币种
      
      // 从数据库获取历史交易记录
      let sql = `SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?`;
      let args: any[] = [limit];
      
      if (symbol) {
        sql = `SELECT * FROM trades WHERE symbol = ? ORDER BY timestamp DESC LIMIT ?`;
        args = [symbol, limit];
      }
      
      const result = await dbClient.execute({
        sql,
        args,
      });
      
      if (!result.rows || result.rows.length === 0) {
        return c.json({ trades: [] });
      }
      
      // 转换数据库格式到前端需要的格式
      const trades = result.rows.map((row: any) => {
        return {
          id: row.id,
          orderId: row.order_id,
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
      
      return c.json({ trades });
    } catch (error: any) {
      logger.error("获取历史仓位失败:", error);
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * 获取 Agent 决策日志
   */
  app.get("/api/logs", async (c) => {
    try {
      const limit = c.req.query("limit") || "20";
      
      const result = await dbClient.execute({
        sql: `SELECT * FROM agent_decisions 
              ORDER BY timestamp DESC 
              LIMIT ?`,
        args: [Number.parseInt(limit)],
      });
      
      const logs = result.rows.map((row: any) => ({
        id: row.id,
        timestamp: row.timestamp,
        iteration: row.iteration,
        decision: row.decision,
        actionsTaken: row.actions_taken,
        accountValue: row.account_value,
        positionsCount: row.positions_count,
      }));
      
      return c.json({ logs });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * 获取交易对分布统计
   */
  async function getTradingPairsDistribution() {
    try {
      // 统计每个交易对的交易次数（只统计已完成的交易）
      const result = await dbClient.execute(
        `SELECT symbol, COUNT(*) as count 
         FROM trades 
         WHERE type = 'close' AND pnl IS NOT NULL 
         GROUP BY symbol 
         ORDER BY count DESC 
         LIMIT 10`
      );
      
      const totalCount = result.rows.reduce((sum, row: any) => sum + Number(row.count), 0);
      
      return result.rows.map((row: any) => {
        const count = Number(row.count);
        const percentage = totalCount > 0 ? (count / totalCount) * 100 : 0;
        return {
          symbol: (row.symbol as string).replace('USDT', ''),
          count,
          percentage: Number(percentage.toFixed(2)),
        };
      });
    } catch (error) {
      logger.error("获取交易对分布失败:", error as any);
      return [];
    }
  }

  /**
   * 获取交易统计
   */
  app.get("/api/stats", async (c) => {
    try {
      // 统计总交易次数 - 使用 pnl IS NOT NULL 来确保这是已完成的平仓交易
      const totalTradesResult = await dbClient.execute(
        "SELECT COUNT(*) as count FROM trades WHERE type = 'close' AND pnl IS NOT NULL"
      );
      const totalTrades = (totalTradesResult.rows[0] as any).count;
      
      // 统计盈利交易
      const winTradesResult = await dbClient.execute(
        "SELECT COUNT(*) as count FROM trades WHERE type = 'close' AND pnl IS NOT NULL AND pnl > 0"
      );
      const winTrades = (winTradesResult.rows[0] as any).count;
      
      // 计算胜率
      const winRate = totalTrades > 0 ? (winTrades / totalTrades) * 100 : 0;
      
      // 计算总盈亏
      const pnlResult = await dbClient.execute(
        "SELECT SUM(pnl) as total_pnl FROM trades WHERE type = 'close' AND pnl IS NOT NULL"
      );
      const totalPnl = (pnlResult.rows[0] as any).total_pnl || 0;
      
      // 计算总手续费 - 包含所有交易（开仓和平仓）
      const feesResult = await dbClient.execute(
        "SELECT SUM(fee) as total_fees FROM trades WHERE fee IS NOT NULL"
      );
      const totalFees = (feesResult.rows[0] as any).total_fees || 0;
      
      // 获取最大单笔盈利和亏损（包含时间和币种信息）
      const maxWinResult = await dbClient.execute(
        "SELECT pnl, symbol, timestamp FROM trades WHERE type = 'close' AND pnl IS NOT NULL ORDER BY pnl DESC LIMIT 1"
      );
      const maxWinRow = maxWinResult.rows[0] as any;
      const maxWin = maxWinRow?.pnl || 0;
      const maxWinSymbol = maxWinRow?.symbol || "";
      const maxWinTime = maxWinRow?.timestamp || "";
      
      const maxLossResult = await dbClient.execute(
        "SELECT pnl, symbol, timestamp FROM trades WHERE type = 'close' AND pnl IS NOT NULL ORDER BY pnl ASC LIMIT 1"
      );
      const maxLossRow = maxLossResult.rows[0] as any;
      const maxLoss = maxLossRow?.pnl || 0;
      const maxLossSymbol = maxLossRow?.symbol || "";
      const maxLossTime = maxLossRow?.timestamp || "";
      
      // 计算平均杠杆 - 从所有开仓交易中计算
      const avgLeverageResult = await dbClient.execute(
        "SELECT AVG(CAST(leverage AS REAL)) as avg_leverage FROM trades WHERE type = 'open'"
      );
      const avgLeverage = (avgLeverageResult.rows[0] as any).avg_leverage || 0;
      
      // 获取持仓时间分布统计
      const tradesWithTimeResult = await dbClient.execute(
        `SELECT o.side, o.timestamp as open_time, c.timestamp as close_time
         FROM trades o
         JOIN trades c ON o.symbol = c.symbol AND o.order_id != c.order_id
         WHERE o.type = 'open' AND c.type = 'close' 
         AND c.timestamp > o.timestamp
         AND c.pnl IS NOT NULL
         ORDER BY o.timestamp DESC`
      );
      
      let longCount = 0;
      let shortCount = 0;
      let totalHoldingTimeMs = 0;
      let holdingTimeCount = 0;
      const rows = tradesWithTimeResult.rows;
      
      for (const row of rows) {
        const rowData = row as any;
        if (rowData.side === 'long') {
          longCount++;
        } else if (rowData.side === 'short') {
          shortCount++;
        }
        
        // 计算持仓时间
        if (rowData.open_time && rowData.close_time) {
          const openTime = new Date(rowData.open_time).getTime();
          const closeTime = new Date(rowData.close_time).getTime();
          const holdingTime = closeTime - openTime;
          if (holdingTime > 0) {
            totalHoldingTimeMs += holdingTime;
            holdingTimeCount++;
          }
        }
      }
      
      const totalPositions = longCount + shortCount;
      const longPercent = totalPositions > 0 ? (longCount / totalPositions) * 100 : 0;
      const shortPercent = totalPositions > 0 ? (shortCount / totalPositions) * 100 : 0;
      const flatPercent = 100 - longPercent - shortPercent; // 平仓状态时间
      
      // 计算平均持仓时长（毫秒）
      const avgHoldingMs = holdingTimeCount > 0 ? totalHoldingTimeMs / holdingTimeCount : null;
      
      // 计算夏普比率 (Sharpe Ratio)
      // 夏普比率 = (平均收益 - 无风险收益率) / 收益标准差
      // 注意：这里计算的是每笔交易的夏普比率，实际应用中通常需要年化
      let sharpeRatio = 0;
      if (totalTrades > 0) {
        // 获取所有已平仓交易的盈亏
        const pnlListResult = await dbClient.execute(
          "SELECT pnl FROM trades WHERE type = 'close' AND pnl IS NOT NULL ORDER BY timestamp DESC"
        );
        
        if (pnlListResult.rows.length > 1) {
          const pnls = pnlListResult.rows.map((row: any) => Number.parseFloat(row.pnl || "0"));
          
          // 计算平均收益
          const avgPnl = pnls.reduce((sum, pnl) => sum + pnl, 0) / pnls.length;
          
          // 计算标准差
          const variance = pnls.reduce((sum, pnl) => sum + Math.pow(pnl - avgPnl, 2), 0) / pnls.length;
          const stdDev = Math.sqrt(variance);
          
          // 计算夏普比率（假设无风险收益率为0）
          if (stdDev > 0) {
            sharpeRatio = avgPnl / stdDev;
          }
        }
      }
      
      // 计算利润因子 (Profit Factor)
      // 利润因子 = 总盈利 / 总亏损（绝对值）
      let profitFactor = null;
      const profitResult = await dbClient.execute(
        "SELECT SUM(pnl) as total_profit FROM trades WHERE type = 'close' AND pnl IS NOT NULL AND pnl > 0"
      );
      const lossResult = await dbClient.execute(
        "SELECT SUM(pnl) as total_loss FROM trades WHERE type = 'close' AND pnl IS NOT NULL AND pnl < 0"
      );
      const totalProfit = Number((profitResult.rows[0] as any)?.total_profit || 0);
      const totalLoss = Math.abs(Number((lossResult.rows[0] as any)?.total_loss || 0));
      
      if (totalLoss > 0) {
        profitFactor = totalProfit / totalLoss;
      } else if (totalProfit > 0) {
        profitFactor = 999; // 如果没有亏损但有盈利，设为一个很大的值
      }
      
      // 计算最大回撤 (Max Drawdown)
      // 从账户历史记录中计算
      let maxDrawdown = null;
      const historyResult = await dbClient.execute(
        "SELECT total_value, unrealized_pnl, timestamp FROM account_history ORDER BY timestamp ASC"
      );
      
      if (historyResult.rows.length > 1) {
        let peak = 0;
        let maxDD = 0;
        
        for (const row of historyResult.rows) {
          const rowData = row as any;
          const equity = Number(rowData.total_value || 0) + Number(rowData.unrealized_pnl || 0);
          
          // 更新峰值
          if (equity > peak) {
            peak = equity;
          }
          
          // 计算当前回撤
          if (peak > 0) {
            const drawdown = ((peak - equity) / peak) * 100;
            if (drawdown > maxDD) {
              maxDD = drawdown;
            }
          }
        }
        
        maxDrawdown = maxDD;
      }
      
      return c.json({
        totalTrades,
        winTrades,
        lossTrades: totalTrades - winTrades,
        winRate,
        totalPnl: Number(totalPnl),
        totalFees: Number(totalFees),
        maxWin,
        maxWinSymbol,
        maxWinTime,
        maxLoss,
        maxLossSymbol,
        maxLossTime,
        avgLeverage: Number(avgLeverage.toFixed(1)),
        // 保留4位小数以显示小数值，避免四舍五入为0
        sharpeRatio: Number(sharpeRatio.toFixed(4)),
        holdTimes: {
          long: Number(longPercent.toFixed(1)),
          short: Number(shortPercent.toFixed(1)),
          flat: Number(flatPercent.toFixed(1)),
        },
        tradingPairs: await getTradingPairsDistribution(),
        // 新增字段
        maxDrawdown: maxDrawdown !== null ? Number(maxDrawdown.toFixed(2)) : null,
        profitFactor: profitFactor !== null ? Number(profitFactor.toFixed(2)) : null,
        avgHoldingMs: avgHoldingMs !== null ? Math.round(avgHoldingMs) : null,
      });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * 获取多个币种的实时价格
   */
  app.get("/api/prices", async (c) => {
    try {
      const symbolsParam = c.req.query("symbols") || "BTC,ETH,SOL,BNB,DOGE,XRP";
      const symbols = symbolsParam.split(",").map(s => s.trim());
      
      const gateClient = createTradingClient();
      const prices: Record<string, number> = {};
      
      // 并发获取所有币种价格
      await Promise.all(
        symbols.map(async (symbol) => {
          try {
            const contract = `${symbol}_USDT`;
            const ticker = await gateClient.getFuturesTicker(contract);
            prices[symbol] = Number.parseFloat(ticker.last || "0");
          } catch (error: any) {
            logger.error(`获取 ${symbol} 价格失败:`, error);
            prices[symbol] = 0;
          }
        })
      );
      
      return c.json({ prices });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  return app;
}

