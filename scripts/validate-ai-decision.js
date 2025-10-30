#!/usr/bin/env node

/**
 * AI 决策输出验证工具
 * 用于快速检查 AI 是否正确输出决策文本
 */

import { createClient } from '@libsql/client';
import fs from 'fs';
import path from 'path';

const DB_PATH = 'file:./.voltagent/trading.db';

// 颜色代码
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function main() {
  log('🔍 AI 决策输出验证工具', 'cyan');
  log('================================', 'cyan');
  log('');

  // 检查数据库是否存在
  const dbFilePath = './.voltagent/trading.db';
  if (!fs.existsSync(dbFilePath)) {
    log('❌ 数据库文件不存在：./.voltagent/trading.db', 'red');
    log('请先运行系统生成数据', 'yellow');
    process.exit(1);
  }

  const client = createClient({ url: DB_PATH });

  try {
    // 查询最近 5 次决策
    log('📊 最近 5 次决策记录：', 'blue');
    log('--------------------------------');

    const recentResult = await client.execute({
      sql: `SELECT 
        datetime(timestamp, 'localtime') as time,
        decision,
        positions_count,
        round(account_value, 2) as account_value
      FROM agent_decisions 
      ORDER BY timestamp DESC 
      LIMIT 5`
    });

    if (recentResult.rows.length === 0) {
      log('❌ 没有找到决策记录', 'red');
      log('请运行系统至少一个交易周期', 'yellow');
      process.exit(1);
    }

    // 显示记录列表
    for (const row of recentResult.rows) {
      const preview = String(row.decision).substring(0, 60).replace(/\n/g, ' ');
      log(`时间: ${row.time}`, 'cyan');
      log(`  预览: ${preview}...`);
      log(`  持仓: ${row.positions_count} | 账户: ${row.account_value} USDT`);
      log('');
    }

    // 分析最近一次决策
    log('🔍 检查最近决策的文本质量：', 'blue');
    log('--------------------------------');

    const latestDecision = String(recentResult.rows[0].decision);

    if (!latestDecision) {
      log('❌ 最近决策为空', 'red');
      process.exit(1);
    }

    // 检查是否是错误决策
    const isEmptyDecision = latestDecision.includes('AI调用了工具但未产生决策结果');

    if (isEmptyDecision) {
      log('❌ 决策输出失败：AI调用了工具但未产生决策结果', 'red');
      log('');
      log('可能原因：', 'yellow');
      log('  1. Agent Instructions 未更新');
      log('  2. AI 模型超时或被截断');
      log('  3. 提示词过长');
      log('');
      log('建议：', 'yellow');
      log('  1. 检查 src/agents/tradingAgent.ts 是否包含"决策输出要求"');
      log('  2. 启用 debug 日志：LOG_LEVEL=debug npm run dev');
      log('  3. 查看详细错误：查看运行日志');
      process.exit(1);
    }

    // 检查章节完整性
    const hasMarketAnalysis = latestDecision.includes('账户') || latestDecision.includes('余额');
    const hasDecisionReason = latestDecision.includes('分析') || latestDecision.includes('信号');
    const hasActions = latestDecision.includes('决策') || latestDecision.includes('仓');

    let score = 0;

    log('最近一次决策检查结果：', 'yellow');
    log('');

    if (hasMarketAnalysis) {
      log('✅ 包含"账户健康"章节', 'green');
      score++;
    } else {
      log('❌ 缺少"账户健康"章节', 'red');
    }

    if (hasDecisionReason) {
      log('✅ 包含"行情分析"章节', 'green');
      score++;
    } else {
      log('❌ 缺少"行情分析"章节', 'red');
    }

    if (hasActions) {
      log('✅ 包含"决策执行"章节', 'green');
      score++;
    } else {
      log('❌ 缺少"决策执行"章节', 'red');
    }

    log('');
    log(`决策质量评分：${score} / 3`, score === 3 ? 'green' : 'yellow');
    log('');

    if (score === 3) {
      log('🎉 决策输出完整，验证通过！', 'green');
      log('');
      log('完整决策内容：', 'cyan');
      log('--------------------------------');
      console.log(latestDecision);
      log('--------------------------------');
      
      // 统计决策类型
      log('');
      log('📊 决策类型统计（最近10次）：', 'blue');
      log('--------------------------------');
      
      const statsResult = await client.execute({
        sql: `SELECT 
          CASE 
            WHEN decision LIKE '%开仓%' THEN '开仓'
            WHEN decision LIKE '%平仓%' THEN '平仓'
            ELSE '观望'
          END as decision_type,
          COUNT(*) as count
        FROM (
          SELECT decision FROM agent_decisions 
          ORDER BY timestamp DESC 
          LIMIT 10
        )
        GROUP BY decision_type`
      });
      
      for (const row of statsResult.rows) {
        log(`  ${row.decision_type}: ${row.count} 次`);
      }
      
      process.exit(0);
    } else if (score > 0) {
      log('⚠️ 决策输出不完整，需要优化', 'yellow');
      log('');
      log('当前决策内容：', 'cyan');
      log('--------------------------------');
      console.log(latestDecision);
      log('--------------------------------');
      process.exit(1);
    } else {
      log('❌ 决策输出格式错误', 'red');
      log('');
      log('当前决策内容：', 'cyan');
      log('--------------------------------');
      console.log(latestDecision);
      log('--------------------------------');
      process.exit(1);
    }

  } catch (error) {
    log(`❌ 验证过程出错：${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

main();
