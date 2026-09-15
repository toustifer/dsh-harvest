# DAG Shape: robustness-improvement-v1

## 目标
处理 Issue #1 中关于“平台参数容错”与“中文字符集乱码”的问题，增强 `harvest` 管道的底层鲁棒性。

## 任务拆解
1. **task-scout-compatibility** (worker-infra):
   - 修改 `harvest_scout` 入参解析逻辑，对不支持的平台名称（如 zhihu/weibo/etc）进行自动映射（转为 site: query），避免触发 schema 硬中断。
2. **task-extract-encoding** (worker-infra):
   - 在 `harvest_extract` 中加入编码探测（使用 `iconv-lite`），识别 GBK/GB2312 编码页面，确保中文字符串解析准确，为后续 verify 提供正确证据。
3. **task-verify-robustness** (worker-ops):
   - 编写针对乱码页面与非标准平台名的冒烟测试。

## 验收标准
- `harvest_scout(platforms=['zhihu'])` 不会报错，自动转化为 site:zhihu.com 逻辑。
- 乱码高校页面（GBK）可以通过 `harvest_extract` 正确解析中文字符。
- 相关逻辑已通过单元/集成测试。
