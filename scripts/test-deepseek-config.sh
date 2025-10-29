#!/bin/bash

# DeepSeek API 配置测试脚本
# 用于验证 API 配置是否正确

echo "======================================"
echo "  DeepSeek API 配置测试"
echo "======================================"
echo ""

# 检查 .env 文件
if [ ! -f .env ]; then
    echo "❌ 错误: 未找到 .env 文件"
    exit 1
fi

# 加载环境变量
source .env

echo "📋 当前配置："
echo "---"
echo "USE_DEEPSEEK_DIRECT: ${USE_DEEPSEEK_DIRECT:-未设置}"
echo "DEEPSEEK_API_KEY: ${DEEPSEEK_API_KEY:+已设置 (${#DEEPSEEK_API_KEY} 字符)}"
echo "OPENROUTER_API_KEY: ${OPENROUTER_API_KEY:+已设置 (${#OPENROUTER_API_KEY} 字符)}"
echo "AI_MODEL_NAME: ${AI_MODEL_NAME:-未设置（将使用默认值）}"
echo "---"
echo ""

# 检查配置状态
if [ "$USE_DEEPSEEK_DIRECT" = "true" ]; then
    if [ -z "$DEEPSEEK_API_KEY" ]; then
        echo "❌ 错误: USE_DEEPSEEK_DIRECT=true 但 DEEPSEEK_API_KEY 未设置"
        echo "请运行: npm run setup:deepseek"
        exit 1
    else
        echo "✅ 配置正确: 将使用 DeepSeek 官方 API"
        echo "💰 预计每月可节省 90%+ 的 AI 费用"
    fi
elif [ -n "$OPENROUTER_API_KEY" ]; then
    echo "⚠️  当前使用: OpenRouter API"
    echo "💡 建议: 切换到 DeepSeek 官方 API 以节省 90% 成本"
    echo "   运行: npm run setup:deepseek"
else
    echo "❌ 错误: 未配置任何 AI API"
    echo "请运行: npm run setup:deepseek"
    exit 1
fi

echo ""
echo "🧪 测试 API 连接..."

# 获取脚本所在目录的父目录（项目根目录）
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 创建测试脚本（在项目目录中）
cat > "$PROJECT_ROOT/.test-deepseek-api.mjs" << 'EOF'
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai';
import * as dotenv from 'dotenv';

// 加载 .env 文件
dotenv.config();

async function testAPI() {
  try {
    const useDeepSeek = process.env.USE_DEEPSEEK_DIRECT === 'true';
    const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
    const openrouterApiKey = process.env.OPENROUTER_API_KEY;
    
    let model;
    
    if (useDeepSeek && deepseekApiKey) {
      console.log('测试 DeepSeek 官方 API...');
      const deepseek = createOpenAI({
        apiKey: deepseekApiKey,
        baseURL: 'https://api.deepseek.com/v1',
      });
      model = deepseek.chat(process.env.AI_MODEL_NAME || 'deepseek-chat');
    } else if (openrouterApiKey) {
      console.log('测试 OpenRouter API...');
      const openrouter = createOpenRouter({
        apiKey: openrouterApiKey,
      });
      model = openrouter.chat(process.env.AI_MODEL_NAME || 'deepseek/deepseek-v3.2-exp');
    } else {
      throw new Error('未配置 API 密钥');
    }
    
    const { text } = await generateText({
      model,
      prompt: '请用一句话说明你是什么模型。',
      maxTokens: 50,
    });
    
    console.log('✅ API 测试成功！');
    console.log('模型响应:', text);
    return true;
  } catch (error) {
    console.error('❌ API 测试失败:', error.message);
    return false;
  }
}

testAPI().then(success => {
  process.exit(success ? 0 : 1);
});
EOF

# 运行测试（在项目目录中）
if cd "$PROJECT_ROOT" && node .test-deepseek-api.mjs; then
    echo ""
    echo "🎉 配置验证成功！可以开始使用了。"
    echo ""
    echo "📚 下一步："
    echo "   - 启动服务: npm run trading:start"
    echo "   - 查看日志确认 API 使用情况"
else
    echo ""
    echo "❌ API 测试失败，请检查："
    echo "   1. API Key 是否正确"
    echo "   2. 网络连接是否正常"
    echo "   3. API Key 是否有余额（DeepSeek）"
fi

# 清理临时文件
rm -f "$PROJECT_ROOT/.test-deepseek-api.mjs"

echo ""
