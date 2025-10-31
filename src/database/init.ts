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
 * 数据库初始化脚本
 */
import "dotenv/config";
import { createClient } from "@libsql/client";
import { CREATE_TABLES_SQL } from "./schema";
import { createPinoLogger } from "@voltagent/logger";

const logger = createPinoLogger({
  name: "database-init",
  level: "info",
});

import { createTradingClient } from "../services/tradingClientFactory";

async function initDatabase() {
  try {
    const dbUrl = process.env.DATABASE_URL || "file:./.voltagent/trading.db";
    
    logger.info(`初始化数据库: ${dbUrl}`);

    const client = createClient({
      url: dbUrl,
    });

    // 执行建表语句
    logger.info("创建数据库表...");
    await client.executeMultiple(CREATE_TABLES_SQL);

    // 从交易所获取最新账户数据
    const tradingClient = createTradingClient();
    const accountInfo = await tradingClient.getFuturesAccount();
    
    const totalBalance = Number(accountInfo.total || 0);
    const availableBalance = Number(accountInfo.available || 0);
    const unrealizedPnl = Number(accountInfo.unrealizedPnl || 0);
    
    // 获取当前持仓
    const currentPositions = await tradingClient.getPositions();

    // 检查是否需要重新初始化
    const existingHistory = await client.execute(
      "SELECT COUNT(*) as count FROM account_history"
    );
    const count = (existingHistory.rows[0] as any).count as number;

    if (count > 0) {
      // 数据库已初始化，只检查状态不清空数据
      logger.info(`数据库已有 ${count} 条账户历史记录`);
      
      // 检查最新记录与当前账户的差异（仅用于日志显示）
      const latestRecord = await client.execute(
        "SELECT * FROM account_history ORDER BY timestamp DESC LIMIT 1"
      );
      const lastBalance = Number.parseFloat(latestRecord.rows[0]?.total_value as string || "0");
      
      if (Math.abs(lastBalance - totalBalance) > 0.01) {
        logger.info(`💰 账户余额变化: ${lastBalance.toFixed(2)} USDT -> ${totalBalance.toFixed(2)} USDT`);
      }
      
      logger.info("当前账户状态:");
      logger.info(`  总资产: ${totalBalance} USDT`);
      logger.info(`  可用资金: ${availableBalance} USDT`);
      logger.info(`  未实现盈亏: ${unrealizedPnl} USDT`);
      logger.info(`  总收益率: ${((totalBalance / 100 - 1) * 100).toFixed(2)}%`);
      
      if (currentPositions.length > 0) {
        logger.info(`\n当前持仓 (${currentPositions.length}):`);
        for (const pos of currentPositions) {
          logger.info(`  ${pos.contract}: ${pos.size} @ ${pos.entryPrice} (${pos.side}, ${pos.leverage}x)`);
        }
      } else {
        logger.info("\n当前无持仓");
      }
      
      logger.info("\n✅ 数据库检查完成（数据已保留）");
      client.close();
      return;
    }

    // 插入最新账户记录
    logger.info(`插入账户记录: ${totalBalance} USDT`);
    await client.execute({
      sql: `INSERT INTO account_history 
            (timestamp, total_value, available_cash, unrealized_pnl, realized_pnl, return_percent) 
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        new Date().toISOString(),
        totalBalance,
        availableBalance,
        unrealizedPnl,
        0,
        ((totalBalance / 100 - 1) * 100), // 相对于初始资金100 USDT的收益率
      ],
    });

    // 显示当前账户状态
    const latestAccount = await client.execute(
      "SELECT * FROM account_history ORDER BY timestamp DESC LIMIT 1"
    );

    if (latestAccount.rows.length > 0) {
      const account = latestAccount.rows[0] as any;
      logger.info("当前账户状态:");
      logger.info(`  总资产: ${account.total_value} USDT`);
      logger.info(`  可用资金: ${account.available_cash} USDT`);
      logger.info(`  未实现盈亏: ${account.unrealized_pnl} USDT`);
      logger.info(`  总收益率: ${account.return_percent}%`);
    }

    // 显示当前持仓
    const positions = await client.execute(
      "SELECT * FROM positions"
    );
    
    if (positions.rows.length > 0) {
      logger.info(`\n当前持仓 (${positions.rows.length}):`);
      for (const pos of positions.rows) {
        const p = pos as any;
        logger.info(`  ${p.symbol}: ${p.quantity} @ ${p.entry_price} (${p.side}, ${p.leverage}x)`);
      }
    } else {
      logger.info("\n当前无持仓");
    }

    logger.info("\n✅ 数据库初始化完成");
    client.close();
  } catch (error) {
    logger.error("❌ 数据库初始化失败:", error as any);
    process.exit(1);
  }
}

export { initDatabase };

