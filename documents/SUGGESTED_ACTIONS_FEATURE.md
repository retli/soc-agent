# AI 建议行动功能说明

## 🎯 功能概述

**AI建议行动（Suggested Actions）** 是一个智能辅助功能，旨在帮助事件响应（IR）人员扩展调查思路。在每次AI回复后，系统会自动分析对话上下文，并提供3-5条简洁的后续调查建议。

## 🚀 核心价值

### 1. **扩展调查思路**
- 防止遗漏关键调查步骤
- 提供专业的下一步建议
- 基于AI对上下文的理解

### 2. **提高效率**
- 一键填充到输入框
- 无需手动输入完整问题
- 快速跳转到下一个调查点

### 3. **学习成长**
- 新手分析师可以学习调查流程
- 了解资深分析师的思维方式
- 逐步建立系统化的调查方法

---

## 📱 使用界面

### UI 展示

```
🤖 [AI回复内容]
   根据工具执行结果，该IP地址存在可疑活动...

┌────────────────────────────────────────┐
│ 💡 建议的下一步行动                     │
├────────────────────────────────────────┤
│ 1  查询该IP的历史告警记录           →  │
│ 2  检查相关资产的网络流量           →  │
│ 3  分析同时段其他可疑活动           →  │
│ 4  验证该IP是否在黑名单中           →  │
│ 5  查看资产所有者的其他设备         →  │
└────────────────────────────────────────┘
```

### 交互流程

1. **AI回复完成** → 自动生成建议
2. **点击建议** → 填充到输入框
3. **回车发送** → 继续调查

---

## 🎨 UI 设计

### 视觉风格

| 元素 | 样式 | 说明 |
|------|------|------|
| **容器背景** | 蓝色渐变 `#f0f9ff → #e0f2fe` | 柔和的蓝色表示建议性质 |
| **左边框** | 实心蓝色 `#3b82f6` | 视觉焦点 |
| **按钮** | 白色背景 + 蓝色边框 | 清晰可点击 |
| **编号** | 蓝色粗体 | 快速识别 |
| **箭头** | 灰色 `→` | 表示可执行 |

### 交互效果

```css
/* 悬停效果 */
.suggestion-btn:hover {
  background: #eff6ff;      /* 浅蓝背景 */
  border-color: #3b82f6;    /* 深蓝边框 */
  transform: translateX(4px); /* 右移4px */
}
```

---

## ⚙️ 配置选项

### 在设置页面控制

```
设置 → 高级功能 → AI建议行动

┌─────────────────────────────────────┐
│ AI建议行动                [✓] 开启  │
│ AI会在每次回复后，基于上下文提供   │
│ 3-5条建议的后续调查步骤，帮助扩展  │
│ 思路                                │
└─────────────────────────────────────┘
```

### 代码配置

```javascript
// defaults.js
ui: {
  enableSuggestedActions: true  // 默认开启
}
```

---

## 🔧 技术实现

### 1. 生成建议的流程

```javascript
async generateSuggestedActions(aiResponse, userQuery) {
  // 1. 构建prompt
  const suggestPrompt = `
    基于上述安全告警调查对话，提供3-5条简洁的后续调查建议。
    用户问题：${userQuery}
    AI回复：${aiResponse.substring(0, 500)}...
  `;
  
  // 2. 调用AI API
  const response = await this.aiService.sendMessage([
    { role: 'user', content: suggestPrompt }
  ], {
    temperature: 0.7,
    max_tokens: 300
  });
  
  // 3. 解析JSON建议
  const suggestions = JSON.parse(response.content).suggestions;
  
  // 4. 显示UI
  this.displaySuggestedActions(suggestions);
}
```

### 2. 建议格式

**AI返回的JSON格式**：
```json
{
  "suggestions": [
    "查询该IP的历史告警记录",
    "检查相关资产的网络流量",
    "分析同时段其他可疑活动",
    "验证该IP是否在黑名单中",
    "查看资产所有者的其他设备"
  ]
}
```

### 3. UI渲染

```javascript
displaySuggestedActions(suggestions) {
  const suggestionsDiv = document.createElement('div');
  suggestionsDiv.className = 'suggested-actions';
  
  // 创建建议列表
  suggestions.forEach((suggestion, index) => {
    const btn = document.createElement('button');
    btn.textContent = `${index + 1}. ${suggestion}`;
    btn.onclick = () => this.handleSuggestionClick(suggestion);
    suggestionsDiv.appendChild(btn);
  });
  
  messagesEl.appendChild(suggestionsDiv);
}
```

### 4. 点击处理

```javascript
handleSuggestionClick(suggestion) {
  const input = document.getElementById('user-input');
  input.value = suggestion;  // 填充到输入框
  input.focus();             // 聚焦
  // 可选：自动发送
}
```

---

## 📊 使用场景示例

### 场景1：可疑IP调查

**用户输入**：
```
查询109.172.85.63的威胁情报
```

**AI回复**：
```
根据威胁情报查询，该IP被标记为高风险：
- 威胁等级：High
- 地理位置：俄罗斯
- 恶意活动：扫描、暴力破解
```

**建议行动**：
```
1. 查询该IP访问的内部资产列表
2. 检查防火墙是否已封禁该IP
3. 查看近7天该IP的访问日志
4. 确认是否触发了其他告警
5. 向威胁情报平台提交IOC
```

---

### 场景2：恶意软件分析

**用户输入**：
```
分析文件哈希 a3f5d8e2c1b0...
```

**AI回复**：
```
该文件被识别为勒索软件变种：
- 家族：WannaCry
- 危险等级：严重
- 加密算法：RSA-2048
```

**建议行动**：
```
1. 立即隔离受感染主机
2. 检查同网段其他设备状态
3. 确认备份系统是否可用
4. 分析该文件的传播路径
5. 通知应急响应团队
```

---

### 场景3：钓鱼邮件分析

**用户输入**：
```
分析可疑邮件，发件人：admin@malicious-example.com
```

**AI回复**：
```
该邮件疑似钓鱼攻击：
- 域名伪造（正确域名应为 corp-example.cn）
- 包含恶意链接
- 要求输入凭据
```

**建议行动**：
```
1. 查询收到该邮件的用户列表
2. 检查是否有人点击了链接
3. 封禁发件人域名和IP
4. 发布安全公告提醒用户
5. 检查邮件网关规则
```

---

## 🎯 建议质量优化

### AI Prompt 设计要点

```javascript
const suggestPrompt = `
基于上述安全告警调查对话，作为一个经验丰富的安全分析师，
请提供3-5条简洁的后续调查建议。

每条建议应该：
1. 简短明确（不超过20字）      // 控制长度
2. 可直接执行的行动             // 可操作性
3. 帮助深入调查或验证发现       // 目标导向
4. 符合事件响应流程             // 专业性

用户问题：${userQuery}
AI回复：${aiResponse.substring(0, 500)}...  // 避免超长

请只返回JSON格式的建议列表，格式如下：
{
  "suggestions": [
    "查询该IP的历史告警记录",
    "检查相关资产的网络流量"
  ]
}
`;
```

### 建议示例（好vs坏）

| ❌ 不好的建议 | ✅ 好的建议 |
|-------------|-----------|
| 你应该进一步调查 | 查询该IP的历史告警记录 |
| 看看有没有其他问题 | 检查相关资产的网络流量 |
| 继续分析 | 分析同时段其他可疑活动 |
| 采取必要措施 | 验证该IP是否在黑名单中 |

---

## 🔒 安全考虑

### 1. **上下文限制**
```javascript
aiResponse.substring(0, 500)  // 只发送前500字符
```
- 避免发送过长内容
- 减少API成本
- 保护敏感信息

### 2. **错误处理**
```javascript
try {
  const suggestions = JSON.parse(response.content).suggestions;
} catch (parseError) {
  logger.error('[SuggestedActions] Parse error');
  return;  // 静默失败
}
```

### 3. **敏感数据脱敏**
- 不在建议中包含具体IP/域名
- 使用占位符（如"该IP"、"相关资产"）

---

## 📈 性能优化

### 1. **异步生成**
```javascript
// 不阻塞UI
await this.generateSuggestedActions(fullContent, message);
```

### 2. **单例模式**
```javascript
// 移除旧建议
const oldSuggestions = messagesEl.querySelector('.suggested-actions');
if (oldSuggestions) {
  oldSuggestions.remove();
}
```

### 3. **控制Token消耗**
```javascript
{
  temperature: 0.7,      // 较低温度，更确定性
  max_tokens: 300        // 限制长度
}
```

---

## 🔮 未来增强

### 1. **智能过滤**
- 基于已执行的工具，避免重复建议
- 识别已问过的问题

### 2. **优先级排序**
- 标记高优先级建议（🔥）
- 区分必须vs可选

### 3. **上下文历史**
- 分析整个对话历史，而非单次回复
- 识别调查阶段（初步分析→深度调查→处置）

### 4. **自定义模板**
- 允许用户保存常用建议
- 针对不同告警类型的模板

### 5. **统计分析**
- 跟踪建议采纳率
- 优化建议质量

---

## 📝 文件清单

### 修改的文件

1. **sidebar.js** (主要功能)
   - `generateSuggestedActions()` - 生成建议
   - `displaySuggestedActions()` - 显示UI
   - `handleSuggestionClick()` - 处理点击

2. **defaults.js** (配置)
   - `ui.enableSuggestedActions` - 功能开关

3. **options.html** (设置UI)
   - 添加"高级功能"部分
   - 建议行动开关

4. **options.js** (设置逻辑)
   - 加载/保存配置

---

## 🎓 使用技巧

### 1. **快速导航**
点击建议后：
- 可以先查看问题是否合适
- 修改部分文字再发送
- 直接回车发送

### 2. **组合使用**
```
用户：查询IP 10.1.1.1
AI：[回复]
建议：
  1. 查询历史告警    ← 点击发送
  
AI：[历史告警结果]
建议：
  2. 分析网络流量    ← 继续点击
```

### 3. **禁用场景**
如果不需要建议，可以在设置中关闭：
- 减少API调用
- 更简洁的UI
- 自主调查流程

---

## ✅ 总结

**AI建议行动功能**是一个强大的辅助工具，能够：

✅ 扩展IR人员的调查思路  
✅ 提高调查效率和完整性  
✅ 降低新手分析师的学习曲线  
✅ 保证调查流程的系统性  

通过智能建议，让安全分析工作更高效、更专业！🚀
