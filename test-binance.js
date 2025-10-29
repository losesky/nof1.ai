#!/usr/bin/env node

/**
 * 币安客户端测试脚本
 */

import { config } from "dotenv";
import { createTradingClient, getCurrentExchange } from "./src/services/tradingClientFactory";

// 加载环境变量
config();

async function testBinanceClient() {
  console.log(`🚀 测试交易客户端 (${getCurrentExchange()})`);
  
  try {
    const client = createTradingClient();
    console.log("✅ 客户端创建成功");
    
    // 测试获取账户余额
    console.log("\n📊 测试获取账户余额...");
    const account = await client.getFuturesAccount();
    console.log("账户余额:", {
      总余额: account.total,
      可用余额: account.available,
      未实现盈亏: account.unrealizedPnl,
    });
    
    // 测试所有支持币种的市场数据质量
    console.log("\n� 测试市场数据质量...");
    const symbols = ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE"];
    
    for (const symbol of symbols) {
      console.log(`\n检查 ${symbol} 市场数据...`);
      const contract = `${symbol}USDT`;
      
      // 获取24小时行情和K线数据
      const [ticker, klines] = await Promise.all([
        client.getFuturesTicker(contract),
        client.getFuturesCandles(contract, "1m", 2) // 获取最近2根1分钟K线
      ]);

      // 格式化数字显示
      const formatNumber = (num) => {
        if (!num) return "无数据";
        const n = Number(num);
        return Number.isFinite(n) ? n.toString() : "无效数据";
      };

      // 检查K线数据
      const currentCandle = klines[klines.length - 1];
      const previousCandle = klines[klines.length - 2];

      // 打印完整的市场数据
      console.log(`${symbol} 市场数据诊断:`);
      console.log("\n1. 实时价格数据:");
      console.log({
        "最新价": `${formatNumber(ticker.last)} [${ticker.last ? "✓" : "✗"}]`,
        "标记价": `${formatNumber(ticker.markPrice)} [${ticker.markPrice ? "✓" : "✗"}]`,
        "指数价": `${formatNumber(ticker.indexPrice)} [${ticker.indexPrice ? "✓" : "✗"}]`,
      });

      console.log("\n2. 24小时统计数据:");
      console.log({
        "24h最高价": `${formatNumber(ticker.highest_24h)} [${ticker.highest_24h ? "✓" : "✗"}]`,
        "24h最低价": `${formatNumber(ticker.lowest_24h)} [${ticker.lowest_24h ? "✓" : "✗"}]`,
        "24h成交量": `${formatNumber(ticker.volume_24h)} [${ticker.volume_24h && Number(ticker.volume_24h) > 0 ? "✓" : "✗"}]`,
        "24h成交额": `${formatNumber(ticker.volume_24h_usd)} [${ticker.volume_24h_usd && Number(ticker.volume_24h_usd) > 0 ? "✓" : "✗"}]`,
        "24h涨跌幅": `${formatNumber(ticker.priceChangePercent)}% [${ticker.priceChangePercent ? "✓" : "✗"}]`
      });

      console.log("\n3. 最新K线数据:");
      if (currentCandle) {
        console.log("当前K线:", {
          "时间戳": new Date(currentCandle.timestamp).toISOString(),
          "开盘价": formatNumber(currentCandle.open),
          "最高价": formatNumber(currentCandle.high),
          "最低价": formatNumber(currentCandle.low),
          "收盘价": formatNumber(currentCandle.close),
          "成交量": `${formatNumber(currentCandle.volume)} [${currentCandle.volume && Number(currentCandle.volume) > 0 ? "✓" : "✗"}]`,
          "成交额": `${formatNumber(currentCandle.quoteVolume)} [${currentCandle.quoteVolume && Number(currentCandle.quoteVolume) > 0 ? "✓" : "✗"}]`,
          "成交笔数": `${formatNumber(currentCandle.trades)} [${currentCandle.trades && Number(currentCandle.trades) > 0 ? "✓" : "✗"}]`
        });
      }

      if (previousCandle) {
        console.log("\n上一根K线:", {
          "时间戳": new Date(previousCandle.timestamp).toISOString(),
          "开盘价": formatNumber(previousCandle.open),
          "最高价": formatNumber(previousCandle.high),
          "最低价": formatNumber(previousCandle.low),
          "收盘价": formatNumber(previousCandle.close),
          "成交量": `${formatNumber(previousCandle.volume)} [${previousCandle.volume && Number(previousCandle.volume) > 0 ? "✓" : "✗"}]`,
          "成交额": `${formatNumber(previousCandle.quoteVolume)} [${previousCandle.quoteVolume && Number(previousCandle.quoteVolume) > 0 ? "✓" : "✗"}]`,
          "成交笔数": `${formatNumber(previousCandle.trades)} [${previousCandle.trades && Number(previousCandle.trades) > 0 ? "✓" : "✗"}]`
        });
      }
      
      // 验证数据质量
      const isTestnet = process.env.BINANCE_USE_TESTNET === "true";
      const hasError = [];
      const warnings = [];

      // 数据质量诊断
      console.log("\n4. K线数据分析:");
      const now = Date.now();
      const klineAge = now - currentCandle.timestamp;
      console.log({
        "K线延迟": `${(klineAge / 1000).toFixed(1)}秒`,
        "K线是否已完结": klineAge >= 60000 ? "是" : "否",
        "连续K线": previousCandle && (previousCandle.timestamp + 60000 === currentCandle.timestamp) ? "✓" : "✗",
        "上一K线有效性": previousCandle && Number(previousCandle.volume) > 0 ? "✓" : "✗"
      });

      // 市场活跃度诊断
      const volumeThreshold = isTestnet ? 0 : 1; // 测试网允许零成交量
      const tradesThreshold = isTestnet ? 0 : 1;
      
      console.log("\n5. 市场活跃度:");
      console.log({
        "当前K线活跃": Number(currentCandle.volume) > volumeThreshold ? "活跃" : "不活跃",
        "上一K线活跃": previousCandle && Number(previousCandle.volume) > volumeThreshold ? "活跃" : "不活跃",
        "当前成交笔数": currentCandle.trades,
        "上一K线成交笔数": previousCandle ? previousCandle.trades : "N/A",
        "24小时成交量": ticker.volume_24h
      });
      
      // 验证价格
      if (!ticker.last || Number(ticker.last) <= 0) {
        hasError.push("无效价格");
      }
      if (!ticker.markPrice || Number(ticker.markPrice) <= 0) {
        hasError.push("无效标记价格");
      }
      
      // 检查价格偏差
      const price = Number(ticker.last);
      const markPrice = Number(ticker.markPrice);
      if (price && markPrice) {
        const priceDiff = Math.abs(price - markPrice) / markPrice;
        const maxDeviation = isTestnet ? 0.01 : 0.005; // 测试网 1%，主网 0.5%
        if (priceDiff > maxDeviation) {
          warnings.push(`价格偏差: ${(priceDiff * 100).toFixed(2)}%`);
        }
      }
      
      // K线数据验证
      if (!isTestnet && klineAge >= 60000) { // 已完结的K线
        if (Number(currentCandle.volume) <= 0) {
          hasError.push("已完结K线成交量为0");
        } else if (Number(currentCandle.volume) < 1) {
          warnings.push("已完结K线成交量过低");
        }
      }

      // K线连续性检查
      if (previousCandle && currentCandle.timestamp - previousCandle.timestamp !== 60000) {
        warnings.push("K线不连续");
      }

      // 验证交易量（主网环境）
      if (!isTestnet) {
        // 24小时数据验证
        if (!ticker.volume_24h || Number(ticker.volume_24h) <= 0) {
          hasError.push("24小时无交易量");
        }
        if (!ticker.volume_24h_usd || Number(ticker.volume_24h_usd) <= 0) {
          hasError.push("24小时无成交额");
        }

        // K线数据验证
        if (!currentCandle.quoteVolume || Number(currentCandle.quoteVolume) <= 0) {
          warnings.push("当前K线无成交额");
        }
        if (!currentCandle.trades || Number(currentCandle.trades) <= 0) {
          warnings.push("当前K线无成交笔数");
        }
      } else {
        // 测试网环境下的提示
        if (!ticker.volume_24h || Number(ticker.volume_24h) <= 0) {
          warnings.push("[测试网] 24小时无交易量");
        }
        if (!ticker.volume_24h_usd || Number(ticker.volume_24h_usd) <= 0) {
          warnings.push("[测试网] 24小时无成交额");
        }
        if (Number(currentCandle.volume) <= 0) {
          warnings.push("[测试网] 当前K线无成交量");
        }
      }
      
      if (hasError.length > 0) {
        console.log(`❌ ${symbol} 严重问题:`, hasError.join(", "));
      } else if (warnings.length > 0) {
        console.log(`⚠️  ${symbol} 提示:`, warnings.join(", "));
      } else {
        console.log(`✅ ${symbol} 数据质量正常`);
      }
    }
    
    // 测试获取持仓
    console.log("\n📈 测试获取持仓...");
    const positions = await client.getPositions();
    console.log(`持仓数量: ${positions.length}`);
    if (positions.length > 0) {
      positions.forEach((pos, index) => {
        console.log(`持仓${index + 1}:`, {
          合约: pos.contract,
          数量: pos.size,
          入场价: pos.entryPrice,
          方向: pos.side,
        });
      });
    }
    
    console.log("\n🎉 所有测试通过!");
    
  } catch (error) {
    console.error("❌ 测试失败:", error.message);
    process.exit(1);
  }
}

testBinanceClient();
