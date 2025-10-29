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
   * Gate.io 账户结构：
   * - account.total = available + positionMargin + unrealisedPnl
   * - account.total 包含未实现盈亏
   * 
   * 总资产计算：
   * - totalBalance = total - unrealisedPnl = available + positionMargin
   * - 总资产不包含未实现盈亏
   * 
   * 监控页面显示：
   * - 总资产显示 = totalBalance + unrealisedPnl（实时反映持仓盈亏）
   */
  app.get("/api/account", async (c) => {
    try {
      const gateClient = createTradingClient();
      const account = await gateClient.getFuturesAccount();
      
      // 从数据库获取初始资金
      const initialResult = await dbClient.execute(
        "SELECT total_value FROM account_history ORDER BY timestamp ASC LIMIT 1"
      );
      const initialBalance = initialResult.rows[0]
        ? Number.parseFloat(initialResult.rows[0].total_value as string)
        : 100;
      
      // 统一字段名处理（兼容 Binance 和 Gate.io）
      // Binance: total, available, unrealizedPnl, initialMargin
      // Gate.io: total, available, unrealised_pnl/unrealisedPnl, position_margin/positionMargin
      const total = Number.parseFloat(account.total || "0");
      const available = Number.parseFloat(account.available || "0");
      const positionMargin = Number.parseFloat(
        account.initialMargin || account.position_margin || account.positionMargin || "0"
      );
      const unrealisedPnl = Number.parseFloat(
        account.unrealizedPnl || account.unrealised_pnl || account.unrealisedPnl || "0"
      );
      
      // 总资产计算
      // Binance: total 已经不包含未实现盈亏，total = available + initialMargin
      // Gate.io: total 包含未实现盈亏，需要减去 unrealisedPnl
      const totalBalance = total;
      
      // 收益率 = (总资产 - 初始资金) / 初始资金 * 100
      // 总资产不包含未实现盈亏，收益率反映已实现盈亏
      const returnPercent = ((totalBalance - initialBalance) / initialBalance) * 100;
      
      return c.json({
        totalBalance,  // 总资产（不包含未实现盈亏）
        availableBalance: available,
        positionMargin,
        unrealisedPnl,
        returnPercent,  // 收益率（不包含未实现盈亏）
        initialBalance,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
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
      
      // 获取最大单笔盈利和亏损
      const maxWinResult = await dbClient.execute(
        "SELECT MAX(pnl) as max_win FROM trades WHERE type = 'close' AND pnl IS NOT NULL"
      );
      const maxWin = (maxWinResult.rows[0] as any).max_win || 0;
      
      const maxLossResult = await dbClient.execute(
        "SELECT MIN(pnl) as max_loss FROM trades WHERE type = 'close' AND pnl IS NOT NULL"
      );
      const maxLoss = (maxLossResult.rows[0] as any).max_loss || 0;
      
      return c.json({
        totalTrades,
        winTrades,
        lossTrades: totalTrades - winTrades,
        winRate,
        totalPnl,
        maxWin,
        maxLoss,
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

