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

import "dotenv/config";
import { createPinoLogger } from "@voltagent/logger";
import { serve } from "@hono/node-server";
import { createApiRoutes } from "./api/routes";
import { startTradingLoop, initTradingSystem } from "./scheduler/tradingLoop";
import { startAccountRecorder } from "./scheduler/accountRecorder";
import { initDatabase } from "./database/init";
import { RISK_PARAMS } from "./config/riskParams";

// 设置时区为中国时间（Asia/Shanghai，UTC+8）
process.env.TZ = 'Asia/Shanghai';

// 创建日志实例（使用中国时区）
const logger = createPinoLogger({
  name: "ai-btc",
  level: "info",
  formatters: {
    timestamp: () => {
      // 使用系统时区设置，已经是 Asia/Shanghai
      const now = new Date();
      // 正确格式化：使用 toLocaleString 获取中国时间，然后转换为 ISO 格式
      const chinaOffset = 8 * 60; // 中国时区偏移（分钟）
      const utc = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
      const chinaTime = new Date(utc + (chinaOffset * 60 * 1000));
      return `, "time": "${chinaTime.toISOString().replace('Z', '+08:00')}"`;
    }
  }
});

// 全局服务器实例
let server: any = null;

/**
 * 主函数
 */
async function main() {
  logger.info("启动 AI 加密货币自动交易系统");
  
  // 1. 初始化数据库
  logger.info("初始化数据库...");
  await initDatabase();
  
  // 2. 初始化交易系统配置（读取环境变量并同步到数据库）
  await initTradingSystem();
  
  // 3. 启动 API 服务器
  logger.info("🌐 启动 Web 服务器...");
  const apiRoutes = createApiRoutes();
  
  const port = Number.parseInt(process.env.PORT || "3141");
  
  server = serve({
    fetch: apiRoutes.fetch,
    port,
  });
  
  logger.info(`Web 服务器已启动: http://localhost:${port}`);
  logger.info(`监控界面: http://localhost:${port}/`);
  
  // 4. 启动交易循环
  logger.info("启动交易循环...");
  startTradingLoop();
  
  // 5. 启动账户资产记录器
  logger.info("启动账户资产记录器...");
  startAccountRecorder();
  
  logger.info("\n" + "=".repeat(80));
  logger.info("系统启动完成！");
  logger.info("=".repeat(80));
  logger.info(`\n监控界面: http://localhost:${port}/`);
  logger.info(`交易间隔: ${process.env.TRADING_INTERVAL_MINUTES || 5} 分钟`);
  logger.info(`账户记录间隔: ${process.env.ACCOUNT_RECORD_INTERVAL_MINUTES || 10} 分钟`);
  logger.info(`支持币种: ${RISK_PARAMS.TRADING_SYMBOLS.join(', ')}`);
  logger.info(`最大杠杆: ${RISK_PARAMS.MAX_LEVERAGE}x`);
  logger.info(`最大持仓数: ${RISK_PARAMS.MAX_POSITIONS}`);
  logger.info(`🔴 账户止损线: ${process.env.ACCOUNT_STOP_LOSS_USDT || 50} USDT (触发后全部清仓并退出)`);
  logger.info(`🟢 账户止盈线: ${process.env.ACCOUNT_TAKE_PROFIT_USDT || 10000} USDT (触发后全部清仓并退出)`);
  logger.info("\n按 Ctrl+C 停止系统\n");
}

// 错误处理
process.on("uncaughtException", (error) => {
  logger.error("未捕获的异常:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown) => {
  logger.error("未处理的 Promise 拒绝:", { reason });
});

// 优雅退出处理
async function gracefulShutdown(signal: string) {
  logger.info(`\n\n收到 ${signal} 信号，正在关闭系统...`);
  
  try {
    // 关闭服务器
    if (server) {
      logger.info("正在关闭 Web 服务器...");
      server.close();
      logger.info("Web 服务器已关闭");
    }
    
    logger.info("系统已安全关闭");
    process.exit(0);
  } catch (error) {
    logger.error("关闭系统时出错:", error as any);
    process.exit(1);
  }
}

// 监听退出信号
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// 启动应用
await main();
