# 建议行动功能调试指南

## 🔍 快速测试步骤

### 步骤1：重新加载扩展
```
1. 打开 chrome://extensions
2. 找到 "AI SOC Chat" 扩展
3. 点击刷新图标 🔄
```

### 步骤2：打开开发者工具
```
1. 点击扩展图标打开侧边栏
2. 按 F12 打开开发者工具
3. 切换到 Console 标签
```

### 步骤3：测试UI显示（最快方法）

在Console中输入：
```javascript
window.aiChat.testShowSuggestions()
```

**预期结果**：应该立即在对话区域显示4条测试建议

**如果看到建议卡片** ✅
- UI功能正常
- 问题在于AI生成环节

**如果没看到建议卡片** ❌
- 检查Console是否有错误
- UI渲染有问题

---

## 🧪 完整功能测试

### 方法1：简单对话测试

1. 在输入框输入：
```
请解释一下什么是SQL注入攻击
```

2. 等待AI回复完成

3. 查看Console日志：
```javascript
// 应该看到这些日志：
[SuggestedActions] Config check: {fullContent: true, enableSuggestedActions: true, ...}
[SuggestedActions] Starting generation...
[SuggestedActions] Calling AI API...
[SuggestedActions] AI response received: {...}
[SuggestedActions] Displaying X suggestions
```

4. 如果显示建议卡片 ✅ 功能正常

---

### 方法2：工具调用测试

1. 确保已配置MCP服务

2. 输入：
```
查询109.172.85.63的威胁情报
```

3. 等待工具执行和AI综合分析

4. 查看Console日志（同上）

---

## 🐛 常见问题排查

### 问题1：没有任何日志

**可能原因**：
- 扩展未重新加载
- 配置未启用

**解决方法**：
```javascript
// 在Console中检查配置
window.aiChat.config.enableSuggestedActions
// 应该返回: true
```

如果返回 `undefined` 或 `false`：
1. 打开设置页面
2. 找到"高级功能" → "AI建议行动"
3. 确保开关是开启状态
4. 点击"保存设置"
5. 重新加载扩展

---

### 问题2：有日志但没显示UI

**查看日志中的关键信息**：

```javascript
[SuggestedActions] Config check: {
  fullContent: false,  // ← 如果是false，AI没有返回内容
  enableSuggestedActions: true,
  willGenerate: false  // ← 如果是false，不会生成
}
```

**如果 `fullContent: false`**：
- AI API可能失败了
- 检查API配置是否正确
- 查看是否有其他错误日志

**如果 `enableSuggestedActions: false`**：
- 配置未加载
- 执行步骤：
  ```javascript
  // 强制重新加载配置
  await window.aiChat.loadConfig()
  console.log(window.aiChat.config.enableSuggestedActions)
  ```

---

### 问题3：AI调用失败

**查看日志**：
```javascript
[SuggestedActions] Calling AI API...
[SuggestedActions] Error generating suggestions: ...
```

**可能原因**：
- AI API配额用完
- API密钥无效
- 网络问题

**解决方法**：
1. 检查主对话是否正常工作
2. 如果主对话也失败，检查API配置
3. 临时禁用建议功能：设置 → 关闭"AI建议行动"

---

### 问题4：解析失败

**查看日志**：
```javascript
[SuggestedActions] Parse error: ...
[SuggestedActions] Content was: [实际内容]
```

**说明**：AI返回的格式不是JSON

**解决方法**：
- 这个应该会自动fallback到按行分割
- 如果仍然没有建议，可能是AI返回的内容不适合作为建议

---

## 📋 完整日志示例

### 正常工作的日志

```
[SuggestedActions] Config check: {fullContent: true, enableSuggestedActions: true, willGenerate: true}
[SuggestedActions] Starting generation...
[SuggestedActions] User query: 查询109.172.85.63的威胁情报
[SuggestedActions] AI response length: 856
[SuggestedActions] Calling AI API...
[SuggestedActions] AI response received: {hasContent: true, contentLength: 245, contentPreview: "{\n  \"suggestions\": [\n    \"查询该IP的历史告警记录\",\n    \"检查相关资产的网络流量\",\n  ..."}
[SuggestedActions] Parsing response...
[SuggestedActions] Found JSON match
[SuggestedActions] Parsed suggestions: 4
[SuggestedActions] Final suggestions: (4) ['查询该IP的历史告警记录', '检查相关资产的网络流量', ...]
[SuggestedActions] Displaying 4 suggestions
[SuggestedActions] displaySuggestedActions called with: (4) [...]
```

### 失败的日志（配置问题）

```
[SuggestedActions] Config check: {fullContent: true, enableSuggestedActions: undefined, willGenerate: false}
// 没有后续日志
```

### 失败的日志（API问题）

```
[SuggestedActions] Config check: {fullContent: true, enableSuggestedActions: true, willGenerate: true}
[SuggestedActions] Starting generation...
[SuggestedActions] Calling AI API...
[SuggestedActions] Error generating suggestions: Failed to fetch
```

---

## 🛠️ 手动修复步骤

### 如果配置丢失

在Console中执行：
```javascript
// 手动设置配置
const config = await chrome.storage.local.get('aiConfig');
config.aiConfig.enableSuggestedActions = true;
await chrome.storage.local.set(config);

// 重新加载
await window.aiChat.loadConfig();
console.log('Config updated:', window.aiChat.config.enableSuggestedActions);
```

### 如果UI不显示

在Console中执行：
```javascript
// 直接测试UI
window.aiChat.displaySuggestedActions([
  '测试建议1',
  '测试建议2',
  '测试建议3'
]);
```

如果这个也不显示，说明DOM结构有问题：
```javascript
// 检查messages元素
document.getElementById('messages')
// 应该返回一个div元素，不是null
```

---

## 🎯 快速检查清单

运行这个完整检查脚本：
```javascript
// === 建议行动功能检查脚本 ===

console.log('=== 1. 检查基础设施 ===');
console.log('aiChat实例:', window.aiChat ? '✅' : '❌');
console.log('messages元素:', document.getElementById('messages') ? '✅' : '❌');

console.log('\n=== 2. 检查配置 ===');
console.log('config对象:', window.aiChat?.config ? '✅' : '❌');
console.log('enableSuggestedActions:', window.aiChat?.config?.enableSuggestedActions);

console.log('\n=== 3. 测试UI显示 ===');
console.log('运行测试...');
window.aiChat?.testShowSuggestions();
console.log('如果上方出现建议卡片，UI功能正常 ✅');

console.log('\n=== 4. 检查方法存在 ===');
console.log('generateSuggestedActions:', typeof window.aiChat?.generateSuggestedActions);
console.log('displaySuggestedActions:', typeof window.aiChat?.displaySuggestedActions);
console.log('handleSuggestionClick:', typeof window.aiChat?.handleSuggestionClick);

console.log('\n=== 检查完成 ===');
```

复制上面的脚本，粘贴到Console并执行。

---

## 💡 成功标志

当功能正常工作时，你应该看到：

1. ✅ Console中有完整的日志链
2. ✅ 对话区域出现蓝色建议卡片
3. ✅ 悬停建议时有高亮效果
4. ✅ 点击建议会填充到输入框

---

## 📞 仍然有问题？

如果按照以上步骤仍然无法工作，请提供：

1. Console中的完整日志（截图或复制）
2. 检查脚本的输出结果
3. 浏览器版本和操作系统

这样可以更准确地定位问题！
