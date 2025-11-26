# 🔗 TheHive 集成使用说明

## 📋 功能概述

TheHive 集成允许你在浏览 TheHive Case 页面时，快速加载 Case 信息和 Comments 到聊天插件中进行分析。

---

## ⚙️ 配置步骤

### 1. 启用 TheHive 集成

编辑 `src/config/defaults.js` 文件：

```javascript
thehive: {
  enabled: true,  // 启用集成
  apiUrl: 'https://your-thehive-instance.com',  // 你的 TheHive API 地址
  apiKey: 'your-api-key-here',  // 你的 TheHive API Key
  organization: '',  // 组织名称（可选）
  autoDetect: true,  // 自动检测 TheHive 页面
  showLoadButton: true,  // 显示加载按钮
  autoLoadComments: false  // 是否自动加载 Comments
}
```

### 2. 获取 TheHive API Key

1. 登录 TheHive
2. 进入 `用户设置` → `API Keys`
3. 创建新的 API Key
4. 复制 Key 到配置文件

### 3. 重新加载扩展

在 `chrome://extensions/` 页面重新加载扩展。

---

## 🎯 使用方法

### 自动检测模式

1. **打开 TheHive Case 页面**
   - 导航到任意 Case 页面，例如：
     - `https://your-thehive.com/cases/~534597760/details`
     - `https://your-thehive.com/cases/~534597760`

2. **查看加载按钮**
   - 扩展会自动检测 URL
   - 如果检测到 Case 页面，会显示绿色的 **"🔗 加载 Case"** 按钮

3. **加载 Case Comments**
   - 点击 **"🔗 加载 Case"** 按钮
   - 等待加载（按钮显示 ⏳ 加载中...）
   - 加载完成后：
     - 聊天窗口标题变为：`🔗 #案件编号 案件标题`
     - Case 的所有 Comments 自动填充到输入框

4. **分析 Comments**
   - 输入框中已经有了所有 Comments 内容
   - 你可以：
     - 直接发送给 AI 进行分析
     - 或者添加你的问题后再发送
     - 例如：添加 "请总结以上分析结果并提供下一步建议"

---

## 🔍 Comments 格式

加载的 Comments 会按以下格式显示：

```
=== TheHive Case Comments ===

[1] 2024-11-06 15:30:00 - analyst@example.com
Initial analysis shows malicious IP 192.168.1.100 
connected to internal host at 14:25:00.

---

[2] 2024-11-06 16:00:00 - soc@example.com
Threat intel query confirms IP is associated with
known APT group. Recommend immediate isolation.

---

[3] 2024-11-06 16:30:00 - analyst@example.com
Host isolated. No data exfiltration detected.
Proceeding with forensic analysis.

---
```

---

## 🎨 UI 元素说明

### 加载按钮状态

| 状态 | 显示 | 说明 |
|------|------|------|
| 默认 | 🔗 加载 Case | 可以点击加载 |
| 加载中 | ⏳ 加载中... | 正在加载，按钮禁用 |
| 完成 | ✅ 已加载 | 加载成功，2秒后恢复 |

### 标题变化

- **默认**：`💬 AI SOC Chat`
- **加载后**：`🔗 #12345 Malicious IP Detection`

---

## 🛠️ API 调用说明

### 支持的 TheHive API

当前实现支持以下 TheHive API v5 端点：

1. **获取 Case 详情**
   ```
   GET /api/v1/case/{caseId}
   ```

2. **获取 Case Comments**
   ```
   POST /api/v1/query
   {
     "query": [
       {"_name": "getCase", "idOrName": "caseId"},
       {"_name": "comments"}
     ]
   }
   ```

3. **获取 Observables**（已实现，待使用）
   ```
   POST /api/v1/query
   {
     "query": [
       {"_name": "getCase", "idOrName": "caseId"},
       {"_name": "observables"}
     ]
   }
   ```

4. **获取 Tasks**（已实现，待使用）
   ```
   POST /api/v1/query
   {
     "query": [
       {"_name": "getCase", "idOrName": "caseId"},
       {"_name": "tasks"}
     ]
   }
   ```

---

## 🔐 安全性说明

### API Key 存储

- API Key 存储在 `defaults.js` 配置文件中
- ⚠️ **注意**：不要将包含真实 API Key 的代码提交到公开仓库
- 建议使用环境变量或加密存储

### 权限

扩展需要以下权限：
- `storage`: 存储配置
- `tabs`: 查询当前标签页 URL
- `activeTab`: 访问当前活动标签页
- `host_permissions`: 访问 TheHive API

---

## 🐛 故障排查

### 按钮不显示

**可能原因：**
1. TheHive 集成未启用
2. URL 格式不匹配
3. 扩展未重新加载

**解决方法：**
1. 检查 `defaults.js` 中 `enabled: true`
2. 确保 URL 包含 `/cases/~数字` 格式
3. 在 `chrome://extensions/` 重新加载扩展

### 加载失败

**可能原因：**
1. API URL 配置错误
2. API Key 无效或过期
3. 网络连接问题
4. TheHive 版本不兼容

**解决方法：**
1. 检查 `apiUrl` 配置是否正确
2. 验证 API Key 是否有效
3. 检查浏览器控制台错误信息
4. 确认 TheHive 为 v5 版本

### 查看日志

打开浏览器开发者工具（F12），查看 Console 日志：

```javascript
// 启用调试日志
[TheHive] Integration initialized
[TheHive] Current URL: https://...
[TheHive] Case page detected
[TheHive] Loading case: ~534597760
[TheHive] Case loaded: ~534597760
[TheHive] Comments loaded
```

---

## 📝 代码结构

```
src/
├── services/
│   ├── thehive-api.js          # TheHive API 封装
│   └── thehive-integration.js  # 业务逻辑
├── utils/
│   └── url-matcher.js          # URL 匹配工具
└── config/
    └── defaults.js             # 配置（包含 thehive 配置）

sidebar.js                      # 主应用逻辑（包含 TheHive 集成）
sidebar.html                    # UI（包含加载按钮）
```

---

## 🚀 下一步计划

### 待实现功能

- [ ] 加载 Observables 到对话
- [ ] 加载 Tasks 列表
- [ ] 更新 Task 状态
- [ ] 创建 IOC
- [ ] 添加 Comment 到 Case
- [ ] 关闭 Case

### 扩展建议

1. **MCP 集成**：将 TheHive API 封装为 MCP 工具
2. **双向同步**：插件的分析结果自动同步到 TheHive
3. **Playbook**：预定义的响应流程
4. **批量操作**：同时处理多个 Case

---

## 📞 支持

如有问题，请：
1. 查看浏览器控制台日志
2. 检查配置文件
3. 参考本文档的故障排查部分

---

**最后更新：** 2024-11-06  
**版本：** 1.0.0
