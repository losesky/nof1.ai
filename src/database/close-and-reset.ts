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
 * 平仓并重置数据库脚本
 * 用于在运行时快速重置系统状态
 */
import { createClient } from "@libsql/client";
import { createPinoLogger } from "@voltagent/logger";
import { createTradingClient } from "../services/tradingClientFactory";
import { CREATE_TABLES_SQL } from "./schema";
import "dotenv/config";

const logger = createPinoLogger({
  name: "close-and-reset",
  level: "info",
});

// 获取交易所类型
const EXCHANGE_TYPE = process.env.EXCHANGE_TYPE || 'binance';

/**
 * 解析持仓大小（统一处理币安浮点数和Gate.io整数）
 */
function parsePositionSize(size: string | number): number {
  if (EXCHANGE_TYPE === 'binance') {
    return Math.abs(Number.parseFloat(size?.toString() || "0"));
  }
  return Math.abs(Number.parseInt(size?.toString() || "0"));
}

/**
 * 平仓所有持仓
 */
async function closeAllPositions(): Promise<void> {
  const tradingClient = createTradingClient();
  
  try {
    logger.info("📊 获取当前持仓...");
    
    const positions = await tradingClient.getPositions();
    const activePositions = positions.filter((p: any) => parsePositionSize(p.size || "0") !== 0);
    
    if (activePositions.length === 0) {
      logger.info("✅ 当前无持仓，跳过平仓");
      return;
    }
    
    logger.warn(`⚠️  发现 ${activePositions.length} 个持仓，开始平仓...`);
    
    for (const pos of activePositions) {
      const rawSize = EXCHANGE_TYPE === 'binance' 
        ? Number.parseFloat(pos.size || "0")
        : Number.parseInt(pos.size || "0");
      const size = parsePositionSize(pos.size || "0");
      const contract = pos.contract;
      const symbol = contract.replace(/_USDT|USDT/g, "");
      const side = rawSize > 0 ? "多头" : "空头";
      const quantity = size;
      const unit = EXCHANGE_TYPE === 'binance' ? symbol : '张';
      
      try {
        logger.info(`🔄 平仓中: ${symbol} ${side} ${quantity.toFixed(EXCHANGE_TYPE === 'binance' ? 3 : 0)}${unit}`);
        
        await tradingClient.placeOrder({
          contract,
          size: -rawSize, // 反向平仓
          price: 0, // 市价单
          reduceOnly: true, // 只减仓
        });
        
        logger.info(`✅ 已平仓: ${symbol} ${side} ${quantity.toFixed(EXCHANGE_TYPE === 'binance' ? 3 : 0)}${unit}`);
      } catch (error: any) {
        logger.error(`❌ 平仓失败: ${symbol} - ${error.message}`);
      }
    }
    
    logger.info("✅ 所有持仓平仓完成");
  } catch (error: any) {
    logger.error(`❌ 平仓过程出错: ${error.message}`);
    throw error;
  }
}

/**
 * 重置数据库
 */
async function resetDatabase(): Promise<void> {
  try {
    const dbUrl = process.env.DATABASE_URL || "file:./.voltagent/trading.db";
    const initialBalance = Number.parseFloat(process.env.INITIAL_BALANCE || "1000");

    logger.info("🗄️  开始重置数据库...");
    logger.info(`数据库路径: ${dbUrl}`);
    logger.info(`初始资金: ${initialBalance} USDT`);

    const client = createClient({
      url: dbUrl,
    });

    // 删除所有表
    logger.info("🗑️  删除现有表...");
    await client.execute("DROP TABLE IF EXISTS trade_logs");
    await client.execute("DROP TABLE IF EXISTS agent_decisions");
    await client.execute("DROP TABLE IF EXISTS trading_signals");
    await client.execute("DROP TABLE IF EXISTS positions");
    await client.execute("DROP TABLE IF EXISTS account_history");
    logger.info("✅ 现有表已删除");

    // 重新创建表
    logger.info("📦 创建新表...");
    await client.executeMultiple(CREATE_TABLES_SQL);
    logger.info("✅ 表创建完成");

    // 插入初始资金记录
    logger.info(`💰 插入初始资金记录: ${initialBalance} USDT`);
    await client.execute({
      sql: `INSERT INTO account_history 
            (timestamp, total_value, available_cash, unrealized_pnl, realized_pnl, return_percent) 
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        new Date().toISOString(),
        initialBalance,
        initialBalance,
        0,
        0,
        0,
      ],
    });

    // 验证初始化结果
    const latestAccount = await client.execute(
      "SELECT * FROM account_history ORDER BY timestamp DESC LIMIT 1"
    );

    if (latestAccount.rows.length > 0) {
      const account = latestAccount.rows[0] as any;
      logger.info("\n" + "=".repeat(60));
      logger.info("✅ 数据库重置成功！");
      logger.info("=".repeat(60));
      logger.info("\n📊 初始账户状态:");
      logger.info(`  总资产: ${account.total_value} USDT`);
      logger.info(`  可用资金: ${account.available_cash} USDT`);
      logger.info(`  未实现盈亏: ${account.unrealized_pnl} USDT`);
      logger.info(`  已实现盈亏: ${account.realized_pnl} USDT`);
      logger.info(`  总收益率: ${account.return_percent}%`);
      logger.info("\n当前无持仓");
      logger.info("\n" + "=".repeat(60));
    }

    client.close();
    
  } catch (error) {
    logger.error("❌ 数据库重置失败:", error as any);
    throw error;
  }
}

/**
 * 主执行函数
 */
async function closeAndReset() {
  logger.info("=".repeat(80));
  logger.info("🔄 开始执行平仓并重置数据库");
  logger.info("=".repeat(80));
  logger.info("");
  
  try {
    // 步骤1：平仓所有持仓
    logger.info("【步骤 1/2】平仓所有持仓");
    logger.info("-".repeat(80));
    await closeAllPositions();
    logger.info("");
    
    // 等待2秒确保平仓完成
    logger.info("⏱️  等待2秒确保平仓完成...");
    await new Promise(resolve => setTimeout(resolve, 2000));
    logger.info("");
    
    // 步骤2：重置数据库
    logger.info("【步骤 2/2】重置数据库");
    logger.info("-".repeat(80));
    await resetDatabase();
    logger.info("");
    
    logger.info("=".repeat(80));
    logger.info("🎉 平仓并重置完成！系统已恢复到初始状态");
    logger.info("=".repeat(80));
    logger.info("");
    logger.info("💡 提示：可以重新启动交易系统开始新的交易");
    
  } catch (error) {
    logger.error("=".repeat(80));
    logger.error("❌ 执行失败:", error as any);
    logger.error("=".repeat(80));
    process.exit(1);
  }
}

// 执行主函数
closeAndReset();
