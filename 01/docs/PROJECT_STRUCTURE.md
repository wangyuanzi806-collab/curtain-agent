# 目录导览

标记说明：**新增** 为本次加入；**更新** 为本次修改；**保留** 为原有内容。逐文件变动见 FILE_CHANGES.md。

```text
curtain-advisor-showcase/
├── 00-修改说明.md                 [新增] 本次处理内容、检查结果、使用说明
├── README.md                      [更新] GitHub 首页介绍、示例、启动方式、功能边界
├── DESIGN.md                      [更新] 精简后的界面设计说明
├── .env.local.example             [更新] 空配置模板，本机展示模式默认值
├── .gitignore                     [更新] 排除密钥、本地资料和生成文件
├── .eslintignore                  [保留]
├── .eslintrc.json                  [保留]
├── package.json                   [更新] 添加类型检查和规则测试命令
├── package-lock.json              [保留] 依赖版本不因文档整理而升级
├── tsconfig.json                  [补回] 从原压缩包恢复必要配置
├── next-env.d.ts                  [保留] Next.js 自动类型声明
├── next.config.mjs                [保留]
├── postcss.config.js              [保留]
├── tailwind.config.js             [保留]
├── public/                        [保留] 原界面静态素材；来源说明见 docs
├── src/                           [更新部分] 保留业务实现；添加本机照片预览与展示入口
├── scripts/                       [更新部分] 清理个人路径和旧脚本，增加说明
├── supabase/migrations/           [保留] 原增量迁移，不是完整数据库备份
├── tests/                         [保留/更新] 保留测试，商品夹具换为虚构样例
├── testsets/                      [更新部分] 保留元数据和来源，移除第三方评测图片
└── docs/                          [新增]
    ├── ARCHITECTURE.md             产品流程与技术说明
    ├── MY_WORK.md                  个人贡献填写说明，未替使用者编造经历
    ├── DATA_AND_ASSETS.md          数据、素材与缺失条件
    ├── PROJECT_STRUCTURE.md        本文件
    ├── FILE_CHANGES.md             逐文件新增/修改/移除清单
    └── images/
        ├── README.md              截图来源、状态与更新说明
        ├── voice-advisor.png       语音接待界面
        ├── consultation.png       咨询创建界面
        └── customer-proposal.png  客户方案静态样例
```

公开副本中已排除：内部交接/快照目录、本地工具配置、旧部署工作流、临时日志、编译缓存、内部数据库规范和完整业务需求文档。原下载目录未被覆盖，可用于私人备份。
