# 竞品价格监控 PWA

给电商运营用的**竞品价格监控工具**：粘贴淘宝 / 天猫商品链接 → 提取全部 SKU 价格 → 自动归类 → 把各竞店的同款规格横向拉平对比，一眼看出谁在打价格战。

纯前端 PWA，数据全部存在浏览器本地（IndexedDB），**零后端、零数据库费用**，可直接部署到 Vercel 并安装到手机桌面。

---

## 功能

| 能力 | 说明 |
| --- | --- |
| 链接管理 | 批量粘贴淘宝/天猫链接（含短链、淘口令），随时增删改，链接可随时更新 |
| SKU 价格提取 | 抓取一个商品的**全部规格**（如 4KG / 8KG / 2 只装），带原价、库存、销量 |
| 自动分类 | 关键词规则引擎，按商品标题 + SKU 规格自动归类，规则可自定义、可调优先级 |
| 跨店对比 | 用「规格键」把不同店铺的同款规格拉到同一行，标出最低价 / 最高价 / 价差率 |
| 手动干预 | 分类可手动指定（覆盖自动结果），规格键可手动对齐，价格可手工修正 |
| 价格历史 | 每次刷新自动记录快照，可清理 180 天前的旧数据 |
| 导入导出 | 支持 JSON 备份、CSV 明细、从 Excel 直接粘贴导入 |
| 离线可用 | Service Worker 缓存，断网也能查看已缓存的数据 |

---

## 快速开始

```bash
npm install
npm run dev          # http://localhost:3000
```

首次打开会自带 12 个消防器材行业的默认分类规则（干粉灭火器、二氧化碳灭火器、灭火器箱、应急照明……），可在「分类」页自由修改。

---

## 抓取价格：三种方式

> **先说结论**：淘宝对机房 IP 有严格风控，纯云端抓取成功率不稳定。**推荐用本地脚本**，它复用你浏览器的登录态，能稳定拿到完整 SKU。

### 方式一：本地脚本（推荐，最可靠）

```bash
npm i -D playwright
npx playwright install chromium

# 把商品链接写进 data/urls.txt，一行一个
npm run scrape
```

- 首次运行会打开浏览器，**扫码登录淘宝**，登录态保存在 `.playwright-profile/`，之后不用重复登录。
- 脚本通过监听页面自身的 `mtop.taobao.detail.getdetail` 接口拿数据，并会主动补一次接口调用。
- 结果写入 `data/scrape-result.json`，**支持增量合并**——反复运行只更新链接清单里的商品。
- 抓完打开 PWA 的「数据」页 → 选择该 JSON 文件导入。

常用参数：

```bash
npm run scrape -- --headless              # 无头模式（需已登录过）
npm run scrape -- --from-backup=data/备份.json   # 从备份里取链接，全量刷新
npm run scrape -- --reset                 # 清除登录态，重新登录
npm run scrape -- --delay-min=3000 --delay-max=6000   # 放慢速度，降低风控概率
```

### 方式二：应用内直接抓取

在「看板 / 商品」页点「添加」，粘贴链接后勾选「自动抓取价格」。走的是 `/api/scrape`（服务端 mtop 签名请求）。
能通就用，被风控拦截时会把商品保留为「待录入」，不会丢链接。

### 方式三：手动 / 表格导入

「数据」页支持粘贴 CSV 或从 Excel 直接复制的表格，列名含「价格」即可，会自动识别 店铺 / 标题 / 规格 / 链接 / 原价 / 库存 等列：

```
店铺,标题,规格,价格
甲消防旗舰店,4KG手提式干粉灭火器,4KG 手提式,45.00
```

---

## 跨店对比是怎么对齐的

核心是**规格键（specKey）**——从规格文本里抽出「数值 + 单位」并归一化：

| 原始规格文本 | 规格键 | 说明 |
| --- | --- | --- |
| `4KG 手提式` | `4kg` | 单位统一 |
| `4公斤` | `4kg` | 千克/公斤/KG 都归一到 kg |
| `500ML 水基` | `500ml` | |
| `4公斤 2只装` | `4kg*2` | 组合装数量单独标记 |
| `8kg 推车式` | `8kg` | |

规格键相同的 SKU，无论来自哪家店，都会被拉到对比表的同一行。同一店铺同一规格有多条报价时取最低价。

**对不上怎么办**：在「商品」页点开商品 → 点某个规格 → 手动改「规格键」，即可强制对齐（会显示「手动对齐」标记）。

---

## 自动分类是怎么工作的

1. 把 **商品标题 + 店铺名 + 全部 SKU 规格名** 拼成一段文本；
2. 按**优先级从高到低**遍历分类规则；
3. 命中「排除词」直接跳过；否则按「任一命中 / 全部命中」判断关键词；
4. 第一个命中的分类即为自动分类结果；
5. 如果商品被**手动指定**了分类，以手动为准（自动结果仍会保留）。

「分类」页还能根据未分类商品的标题自动推荐品类词，一键建分类。

---

## 部署到 Vercel

1. 把代码推到 GitHub（见下）。
2. 打开 [vercel.com/new](https://vercel.com/new)，选择该仓库。
3. Framework 会自动识别为 **Next.js**，无需任何环境变量，直接 Deploy。
4. 部署完成后用手机浏览器打开，选择「添加到主屏幕」即可当 App 使用。

> `/api/scrape` 与 `/api/resolve` 是 Node.js 运行时函数，`vercel.json` 已配置 30s 超时。
> 服务端抓取失败不影响主流程——数据层完全在浏览器本地。

### 推送到 GitHub

```bash
git init
git add .
git commit -m "feat: 竞品价格监控 PWA"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

---

## 项目结构

```
src/
├── app/
│   ├── page.tsx                # 对比看板（统计 + 筛选 + 跨店对比）
│   ├── products/page.tsx       # 商品管理（列表 / 搜索 / 批量刷新）
│   ├── categories/page.tsx     # 分类规则管理 + 智能建议
│   ├── import/page.tsx         # 导入 / 导出 / 备份 / 清理
│   └── api/
│       ├── scrape/route.ts     # 服务端尽力抓取（mtop 签名）
│       └── resolve/route.ts    # 短链解析
├── components/                 # UI 组件（底部弹层、对比卡片、Toast…）
└── lib/
    ├── types.ts                # 数据模型
    ├── db.ts                   # IndexedDB 数据层（Dexie）
    ├── normalize.ts            # 文本归一化 + 规格键提取
    ├── classify.ts             # 自动分类引擎 + 默认规则
    ├── compare.ts              # 跨店对比聚合
    ├── import.ts               # CSV / TSV / JSON 解析
    ├── actions.ts              # 抓取与刷新动作
    └── scrape/taobao-server.ts # 服务端 mtop 抓取实现
scripts/
├── scrape-taobao.mjs           # 本地 Playwright 抓取脚本
└── gen-icons.mjs               # 零依赖 PWA 图标生成器
```

---

## 常用命令

```bash
npm run dev      # 开发
npm run build    # 生产构建
npm start        # 启动生产服务
npm run scrape   # 本地抓取淘宝 SKU 价格
npm run icons    # 重新生成 PWA 图标
```

---

## 说明

- 数据存在本机浏览器，**换设备或清理浏览器缓存前请先导出备份**（「数据」页 → 导出完整备份）。
- 抓取请遵守目标网站的服务条款，仅用于自己店铺的竞品调研，控制请求频率。
- 应用不采集、不上传任何数据。
