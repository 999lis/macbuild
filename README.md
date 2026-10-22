# MacBuild

德国专属 Mac mini M4 租赁与自有设备托管官网。纯 HTML、CSS 和原生 JavaScript，无构建步骤。

- 仅租 Mac：共享线路前 10 台机器首月 ¥699、续租 ¥799/月；独立线路首月 ¥899、续租 ¥999/月。福利按台计，每台一次。
- 长周期报价以首页选配区为准。Max 套餐按月计费；自有 Mac 托管 ¥300/月/台。
- 首页保留十台机位卡片、微信与 Telegram 入口。机位唯一数据来源为 `inventory.json`，记录 `id`、`status`、`promoEligible` 和总体 `updatedAt`。卡片、可预约数、可用福利数与租机报价均由该文件生成。
- `status` 取值：`available` 可预约、`reserved` 已预约、`rented` 使用中、`maintenance` 维护中。某台首次福利被使用后，将其 `promoEligible` 设为 `false`；归还后恢复 `available` 时必须保留 `false`，不可重新发放一次性福利。每次更改同步更新记录日期，部署后生效。
- 这是一份人工维护的库存记录，未连接支付或真实订单台账。页面不因咨询提交自动锁机；库存读取失败显示待确认，不沿用未经确认的优惠。批量申请按实际分配机位分别报价。
- 当前租赁及服务报价常量位于 `booking.mjs` 的 `P`（从原首页内联常量移出）；成本计算器参考常量仍在 `claude-cost-calculator.html` 的 `PRICE`。静态正文、分享图和 `llms.txt` 需保持同一口径。
- 服务入口使用 `/?plan=colocation#order`、`/?plan=assist5x#order`、`/?plan=assist20x#order`。单独开通 Max 5x ¥800/月、Max 20x ¥2,150/月，均含官方订阅费，不含机器。
- 手机端使用底部微信与 Telegram 联系栏，预留安全区域；打开咨询抽屉时隐藏底栏。
- CSS 修改后更新所有 HTML 的 `style.css?v=`。保留搜索验证标记，不增加指向 `.html` 的重定向。

本地验证：`python tests/validate_site.py` 与 `node --test tests/*.test.mjs`。

本地交互预览：`node tests/preview.mjs`，访问 `http://127.0.0.1:8107/index.html`。该预览使用仓库内固定测试数据，邮件提供方完全模拟，不会发送真实邮件；其通过不等于线上邮件投递或搜索收录验证。

站点：[https://getmacbuild.com/](https://getmacbuild.com/)
