# 脚本说明

应用的日常界面预览只需要 npm run dev，不需要运行下列脚本。

| 脚本 | 用途与前提 |
|---|---|
| benchmark-admin-navigation.mjs | 管理页面性能检查；需生产构建及业务数据库 |
| evaluate-window-matching.mjs | 原窗型规则评测；依赖 testsets 中的元数据 |
| curate-eval-dataset.mjs | 整理旧评测素材，包含网络获取步骤；图片未打包 |
| gen-style-images.mjs | 调用外部模型生成示意素材；需密钥并产生用量 |
| build-local-catalog.mjs | 从自行配置的 PostgreSQL 导出只读 SQLite；不能从本仓库还原原库 |
| voice-instructions-v2.mjs | 导出/更新语音话术；--dry 只输出到 .tmp，不访问数据库 |
| voice-instructions-patch.mjs | 在既有 voice_config 上调整话术；即使 --dry 仍需读取数据库 |
| sim/ | 可选对话模拟与评测，需数据库与模型 API；不属于离线规则单测 |

连接配置默认从本机 .env.local 读取，话术脚本也可用 --conn 指定含 POSTGRES_URL 的文件。脚本不再引用原开发电脑或内部密钥文件。确认数据库用途后再执行写入类脚本。

已移除 seed-data.mjs：它调用的旧 styles 接口不在当前应用中，部分演示面料图片也不存在，不能用它初始化当前业务库。
