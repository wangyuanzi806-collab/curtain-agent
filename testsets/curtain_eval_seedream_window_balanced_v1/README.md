# 窗型评测与样例商品目录

此目录保留原项目的 25 条公开网页样例商品元数据、窗型标注和历史评测报告；不是 RoyalZen 的真实商品库。

原始来源索引保留在 metadata.json / metadata.csv 中，包括 IKEA、Unsplash 与 Pexels 页面。展示版未随包分发这些第三方评测图片，因此元数据中的 local_path / local_image 是历史路径，本地文件并不存在。不要将这些路径当成可用图片。

mock_sku_catalog.json 仍由 src/lib/sku-catalog.ts 读取作为空商品表的演示回退。它不能替代数据库，也不能让缺少数据库的推荐接口自动工作。目录中的远程图片是否可访问未作保证。

历史 window_match_report 记录的是原评测版本，不能视为当前版本重新运行的结果。涉及图像的评测需自行准备有权使用的图片并更新路径；规则单测不依赖这些图片。
