# MacBuild

德国专属 Mac mini M4 租赁与自有设备托管官网。纯 HTML、CSS 和原生 JavaScript，无构建步骤。

- 仅租 Mac：共享线路前 10 台机器首月 ¥699、续租 ¥799/月；独立线路首月 ¥899、续租 ¥999/月。福利按台计，每台一次。
- 长周期报价以首页选配区为准。Max 套餐按月计费；自有 Mac 托管 ¥300/月/台。
- 首页保留十台机位卡片、微信与 Telegram 入口。机位状态在 HTML 中维护，实际库存与交付时间由客服确认。
- 首页价格常量位于 `index.html` 的 `P`；成本计算器参考常量位于 `claude-cost-calculator.html` 的 `PRICE`。静态正文、结构化数据、分享图和 `llms.txt` 需保持同一口径。
- CSS 修改后更新所有 HTML 的 `style.css?v=`。保留搜索验证标记，不增加指向 `.html` 的重定向。

本地验证：`python tests/validate_site.py` 与 `node --test tests/order.test.mjs`。

本地交互预览：`node tests/preview.mjs`，访问 `http://127.0.0.1:8107/index.html`。该预览使用仓库内固定测试数据，邮件提供方完全模拟，不会发送真实邮件；其通过不等于线上邮件投递或搜索收录验证。

站点：[https://getmacbuild.com/](https://getmacbuild.com/)
