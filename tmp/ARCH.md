# Architecture Design Document

## 1. 機能要件（Functional Requirements）

### 1.1 概要
OpenCode プラグインとして、レート制限エラー発生時に自動的にフォールバックモデルに切り替える機能を提供する。

### 1.2 主要機能
- **レート制限検知**: 複数の検知方法（HTTP 429、エラーメッセージ、ステータスイベント）を使用
- **自動フォールバック**: 現在のリクエストを中断し、設定されたフォールバックモデルに切り替え
- **モデル管理**: 優先順位付きフォールバックモデルリストの管理
- **クールダウン制御**: レート制限されたモデルの再利用を一定期間ブロック
- **セッション追跡**: 複数のレート制限が連続した場合の適切な処理
- **通知機能**: ユーザーへのトースト通知によるフィードバック

### 1.3 フォールバックモード
| モード | 説明 |
|--------|------|
| `cycle` | 全モデル枯渇時に最初からリセット（デフォルト） |
| `stop` | 全モデル枯渇時にエラー表示 |
| `retry-last` | 最後のモデルをもう一度試行し、次回プロンプトでリセット |

## 2. 非機能要件（Non-Functional Requirements）

### 2.1 パフォーマンス
- フォールバック処理は 5 秒以内に完了すること
- 重複フォールバック防止のための重複検知（5 秒間隔）
- クールダウン期間は設定可能（デフォルト: 60秒）

### 2.2 信頼性
- フォールバック失敗時もエラーを捕捉し、システムを不安定化させない
- セッション状態の適切な管理とクリーンアップ

### 2.3 保守性
- TypeScript による型安全性の確保
- 明確な設定ファイルによるカスタマイズ性
- モジュール化されたコード構造

### 2.4 セキュリティ
- 設定ファイルのパス走査防止（ホームディレクトリのみアクセス）
- エラーメッセージからの機密情報の漏洩防止

## 3. 受け入れ基準（Acceptance Criteria）

### 3.1 必須基準
- [x] レート制限エラー（429, "usage limit", "quota exceeded" 等）を検知できる
- [x] フォールバックモデルリストに従って順次切り替えが行われる
- [x] ユーザーに切り替え通知が表示される
- [x] クールダウン期間中のモデルはスキップされる
- [x] 全モード（cycle, stop, retry-last）が正常に動作する

### 3.2 CI/CD 基準
- [x] TypeScript 型チェックが CI で実行される
- [x] ビルドが CI で実行される
- [x] バージョン変更時のみ npm publish が実行される
- [x] dist/ ディレクトリにコンパイル済み成果物が生成される

## 4. 設計方針

### 4.1 アーキテクチャパターン
- **イベント駆動**: OpenCode のイベントシステム（`session.error`, `message.updated`, `session.status`）を活用
- **ステートマシン**: フォールバック状態（attemptedModels, retryState）を適切に管理
- **プラグインパターン**: OpenCode Plugin API に準拠

### 4.2 エラーハンドリング戦略
1. 複数の検知ポイントでレート制限を監視
2. 検知時に即座にセッションをアボート（内部リトライ機構の停止）
3. フォールバックモデルを選択し、最後のユーザーメッセージを再送信
4. エラー時はグレースフルデグラデーション（トースト通知）

### 4.3 設定管理
設定ファイルの優先順位（高い順）:
1. `<project>/.opencode/rate-limit-fallback.json`
2. `<project>/rate-limit-fallback.json`
3. `~/.opencode/rate-limit-fallback.json`
4. `~/.config/opencode/rate-limit-fallback.json`

## 5. アーキテクチャ

### 5.1 コンポーネント構成
```
RateLimitFallback Plugin
├── Config Loader
│   └── loadConfig() - 複数パスから設定を読み込み
├── Error Detector
│   └── isRateLimitError() - エラーパターンの判定
├── State Manager
│   ├── rateLimitedModels - クールダウン管理
│   ├── retryState - リトライ状態管理
│   └── currentSessionModel - セッション追跡
├── Model Selector
│   └── findNextAvailableModel() - 次のモデル選択
└── Fallback Handler
    └── handleRateLimitFallback() - フォールバック実行
```

### 5.2 データフロー
```
1. イベント受信 (session.error/message.updated/session.status)
   ↓
2. レート制限判定 (isRateLimitError)
   ↓
3. セッションアボート (client.session.abort)
   ↓
4. 通知表示 (client.tui.showToast)
   ↓
5. モデル選択 (findNextAvailableModel)
   ↓
6. メッセージ再送信 (client.session.prompt)
   ↓
7. 成功通知 (client.tui.showToast)
```

### 5.3 型定義
```typescript
interface FallbackModel {
  providerID: string;
  modelID: string;
}

type FallbackMode = "cycle" | "stop" | "retry-last";

interface PluginConfig {
  fallbackModels: FallbackModel[];
  cooldownMs: number;
  enabled: boolean;
  fallbackMode: FallbackMode;
}
```

## 6. トレードオフ検討

### 6.1 検知方法の多様性 vs 誤検知リスク
**決定**: 複数の検知パターン（statusCode, message, responseBody）を採用
**理由**: レート制限エラーはプロバイダーによって異なる形式で返されるため
**リスク**: 誤検知の可能性があるが、フォールバック自体は非破壊的

### 6.2 フォールバックモードの複雑性 vs 柔軟性
**決定**: 3つのモード（cycle, stop, retry-last）を提供
**理由**: ユーザーごとに異なる挙動を希望するケースがあるため
**トレードオフ**: コード複雑性が増すが、デフォルトはシンプルな cycle

### 6.3 TypeScript vs JavaScript
**決定**: TypeScript を採用し、ビルド時に JavaScript に変換
**理由**: 
- 型安全性による保守性向上
- IDE サポートの向上
- コンパイル時エラーの検出
**トレードオフ**: ビルドステップが必要だが、品質向上のため許容

### 6.4 npm publish タイミング
**決定**: バージョン変更時のみ publish
**理由**: 
- 不要な publish 失敗の防止
- CI リソースの節約
- 明確なバージョニング
**実装**: git diff で package.json の version 変更を検出

## 7. 技術スタック

- **言語**: TypeScript 5.3+
- **ランタイム**: Node.js 20+
- **ビルド**: tsc（TypeScript コンパイラ）
- **パッケージ管理**: npm
- **CI/CD**: GitHub Actions
- **プラグインAPI**: @opencode-ai/plugin

## 8. 今後の検討事項

- テストスイートの追加（Jest/Vitest）
- Lint ツールの導入（ESLint/Prettier）
- より詳細なエラーログ機能
- メトリクス収集（フォールバック頻度、成功率等）
- サブエージェント対応（Issue #1）
