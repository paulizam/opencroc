<p align="center">
  <img src="assets/banner.png" alt="OpenCroc バナー" width="820" />
</p>

<h1 align="center">OpenCroc</h1>

<p align="center">
  <strong>ソースコードを読み取り、テストを自動生成し、失敗を自己修復する AI ネイティブ E2E テストフレームワーク。</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/opencroc"><img src="https://img.shields.io/npm/v/opencroc?color=green" alt="npm version" /></a>
  <a href="https://github.com/opencroc/opencroc/blob/main/LICENSE"><img src="https://img.shields.io/github/license/opencroc/opencroc" alt="MIT License" /></a>
  <a href="https://opencroc.com"><img src="https://img.shields.io/badge/docs-opencroc.com-blue" alt="Documentation" /></a>
</p>

<p align="center">
  <a href="README.en.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a>
</p>

---

## OpenCroc とは

OpenCroc は [Playwright](https://playwright.dev) 上に構築された **AI ネイティブ E2E テストフレームワーク** です。手作業で大量のテストスクリプトを書く代わりに、OpenCroc は**バックエンドのソースコード**（モデル、コントローラー、DTO）を解析し、API チェーン、シードデータ、リクエストボディ、アサーションを含む E2E テストスイートを自動生成します。

テストが失敗した場合、単なるエラー出力で終わりません。リクエストチェーン全体をたどって**根本原因を特定**し、**修正パッチを生成**し、**再実行で修正を検証**します。

### 主な機能

| 機能 | 説明 |
|---|---|
| **ソースコード認識型テスト生成** | [ts-morph](https://ts-morph.com) で Sequelize/TypeORM モデル、Express/NestJS コントローラー、DTO デコレーターを解析し API 面を把握 |
| **AI 駆動の設定生成** | LLM がリクエストテンプレート、シードデータ、パラメータマッピングを生成し、3層検証（schema -> semantic -> dry-run）で確認 |
| **インテリジェントなチェーン計画** | API 依存 DAG を構築し、トポロジカルソートと貪欲最適化でテストチェーンを設計 |
| **ログ駆動の完了判定** | `networkidle` を超えて、バックエンド実行ログ（`api_exec end`）で完了を検証 |
| **失敗チェーンの原因追跡** | ネットワークエラー -> 遅延 API -> バックエンドログの順で追跡し根因特定 |
| **制御された自己修復** | `backup -> AI patch -> dry-run -> apply -> re-run -> verify -> rollback` を安全ゲート付きで実行 |
| **影響範囲分析** | 外部キー関係を BFS でたどり、影響範囲を可視化し Mermaid 図を生成 |

## クイックスタート

### 前提条件

- Node.js >= 18
- Express/NestJS + Sequelize/TypeORM を利用するバックエンドプロジェクト

### インストール

```bash
npm install opencroc --save-dev
```

### 初期化

```bash
npx opencroc init
```

このコマンドで以下を実行します:
1. プロジェクト構成をスキャン
2. ORM とフレームワークを検出
3. `opencroc.config.ts` を初期生成
4. サンプルテストを生成

### テスト生成

```bash
# 単一モジュールのテスト生成
npx opencroc generate --module=knowledge-base

# 全モジュールのテスト生成
npx opencroc generate --all

# ドライラン（ファイルを書き込まない）
npx opencroc generate --all --dry-run
```

### テスト実行

```bash
# 生成済みテストをすべて実行
npx opencroc test

# 特定モジュールのみ実行
npx opencroc test --module=knowledge-base

# 自己修復モードで実行
npx opencroc test --self-heal
```

### AI 設定の検証

```bash
# 生成設定を検証
npx opencroc validate --all

# AI 生成結果とベースラインを比較
npx opencroc compare --baseline=report-a.json --current=report-b.json
```

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                     CLI / Orchestrator                       │
├──────────┬──────────┬──────────┬──────────┬─────────────────┤
│  Source   │  Chain   │  Test    │ Execution│   Self-Healing  │
│  Parser   │ Planner  │Generator │  Engine  │     Engine      │
│           │          │          │          │                 │
│ ts-morph  │ DAG +    │ Template │Playwright│ AI Attribution  │
│ Model     │ Topo     │ + AI     │ + Log    │ + Controlled    │
│ Controller│ Sort +   │ Config   │ Driven   │ Fix + Verify    │
│ DTO       │ Greedy   │ Merge    │ Assert   │ + Rollback      │
├──────────┴──────────┴──────────┴──────────┴─────────────────┤
│              Observation Bus (Network + Backend Logs)         │
├──────────────────────────────────────────────────────────────┤
│              Report Engine (HTML / JSON / Markdown)           │
└──────────────────────────────────────────────────────────────┘
```

### 6 段階パイプライン

```
Source Scan -> ER Diagram -> API Analysis -> Chain Planning -> Test Generation -> Failure Analysis
     │            │             │              │                │                  │
  ts-morph    Mermaid      Dependency       Topological     Playwright +      Root Cause +
  parsing     erDiagram    DAG builder      + greedy        AI body/seed      Impact map
```

## 仕組み

### 1. ソース解析

OpenCroc は [ts-morph](https://ts-morph.com) を使ってバックエンドを静的解析します。

- **Models**: Sequelize `Model.init()` / TypeORM `@Entity()` からテーブル名、列型、インデックス、外部キーを抽出
- **Controllers**: Express `router.get/post/put/delete` からルート、HTTP メソッド、パスパラメータを抽出
- **DTOs**: `@IsString()`、`@IsNumber()`、`@IsOptional()` からバリデーションルールを抽出

### 2. AI 設定生成

各モジュールごとに、OpenCroc は LLM（OpenAI / ZhiPu / OpenAI 互換 API）を呼び出して以下を生成します。

- **リクエストボディテンプレート**: フィールド精度の高い POST/PUT ペイロード
- **シードデータ**: 正しい API 順序を持つ `beforeAll` セットアップ
- **パラメータマッピング**: パスパラメータ別名（`/:id` -> `categoryId`）
- **ID エイリアス**: 複数リソースチェーンでの ID 衝突防止

各設定は **3 層検証** を通過します。
1. **Schema 検証**: JSON 構造の完全性
2. **Semantic 検証**: フィールド値がソースメタデータに一致するか
3. **Dry-run 検証**: TypeScript コンパイル確認

失敗した設定は書き込み前に自動修正（最大 3 ラウンド）されます。

### 3. ログ駆動の完了判定

壊れやすい `networkidle` に依存せず、以下で判定します。

```
Frontend Request -> Backend api_exec start log -> Backend processing -> api_exec end log
                                                                          ↓
                                              OpenCroc polls end logs to confirm completion
```

フロントが待機状態でもバックエンドが継続処理中のケースを検出できます。

### 4. 自己修復ループ

```
Test Failure
  -> AI Attribution (LLM + heuristic fallback)
  -> Generate Fix Patch
  -> Dry-Run Validation
  -> Apply Patch (with backup)
  -> Re-run Failed Tests
  -> Verify Fix
  -> Commit or Rollback
```

## 設定例

```typescript
// opencroc.config.ts
import { defineConfig } from 'opencroc';

export default defineConfig({
  // バックエンドソースのパス
  backend: {
    modelsDir: 'src/models',
    controllersDir: 'src/controllers',
    servicesDir: 'src/services',
  },

  // 対象アプリケーション
  baseUrl: 'http://localhost:3000',
  apiBaseUrl: 'http://localhost:3000/api',

  // AI 設定
  ai: {
    provider: 'openai',        // 'openai' | 'zhipu' | 'custom'
    apiKey: process.env.AI_API_KEY,
    model: 'gpt-4o-mini',
  },

  // テスト実行
  execution: {
    workers: 4,
    timeout: 30_000,
    retries: 1,
  },

  // ログ駆動完了判定（バックエンド側の計測が必要）
  logCompletion: {
    enabled: true,
    endpoint: '/internal/test-logs',
    pollIntervalMs: 500,
    timeoutMs: 10_000,
  },

  // 自己修復
  selfHealing: {
    enabled: false,
    fixScope: 'config-only',   // 'config-only' | 'config-and-source'
    maxFixRounds: 3,
    dryRunFirst: true,
  },
});
```

## 対応技術スタック

| レイヤー | 対応済み | 予定 |
|---|---|---|
| **ORM** | Sequelize | TypeORM, Prisma, Drizzle |
| **Framework** | Express | NestJS, Fastify, Koa |
| **Test Runner** | Playwright | — |
| **LLM** | OpenAI, ZhiPu (GLM) | Anthropic, Ollama (local) |
| **Database** | MySQL, PostgreSQL | SQLite, MongoDB |

## 比較

| 機能 | OpenCroc | Playwright | Metersphere | auto-playwright |
|---|---|---|---|---|
| ソース認識生成 | ✅ | ❌ | ❌ | ❌ |
| AI 設定生成 + 検証 | ✅ | ❌ | ❌ | ❌ |
| ログ駆動完了判定 | ✅ | ❌ | ❌ | ❌ |
| 失敗チェーン帰属分析 | ✅ | ❌ | Partial | ❌ |
| 自己修復 + ロールバック | ✅ | ❌ | ❌ | ❌ |
| API 依存 DAG | ✅ | ❌ | ❌ | ❌ |
| ゼロ設定テスト生成 | ✅ | Codegen only | Manual | NL->action |
| 影響範囲分析 | ✅ | ❌ | ❌ | ❌ |

## Roadmap

- [x] 6-stage source-to-test pipeline
- [x] AI configuration generation with 3-layer validation
- [x] Controlled self-healing loop
- [x] Log-driven completion detection
- [x] Failure chain attribution + impact analysis
- [ ] TypeORM / Prisma adapter
- [ ] NestJS controller parser
- [ ] Visual dashboard (opencroc.com)
- [ ] GitHub Actions integration
- [ ] VS Code extension
- [ ] Ollama local LLM support

## ドキュメント

詳細は **[opencroc.com](https://opencroc.com)** を参照してください。あわせて以下も確認できます。

- [Architecture Guide](docs/architecture.md)
- [Configuration Reference](docs/configuration.md)
- [Backend Instrumentation Guide](docs/backend-instrumentation.md)
- [AI Provider Setup](docs/ai-providers.md)
- [Self-Healing Guide](docs/self-healing.md)
- [Troubleshooting](docs/troubleshooting.md)

## コントリビュート

貢献を歓迎します。ガイドラインは [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。

## ライセンス

[MIT](LICENSE) © 2026 OpenCroc Contributors
