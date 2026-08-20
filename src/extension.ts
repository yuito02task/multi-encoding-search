import * as vscode from 'vscode';
import { EucjpSearchViewProvider } from './searchViewProvider';

/**
 * 拡張機能がアクティベート（有効化）されたときに呼び出される関数
 * @param context 拡張機能のコンテキスト情報
 */
export function activate(context: vscode.ExtensionContext): void {
  // WebviewView プロバイダーのインスタンスを作成
  const provider = new EucjpSearchViewProvider(context.extensionUri);

  // サイドバーの WebviewView としてプロバイダーを登録
  const providerDisposable = vscode.window.registerWebviewViewProvider(
    EucjpSearchViewProvider.viewType,
    provider,
    {
      webviewOptions: {
        // バックグラウンドでも状態（入力内容や結果）を保持
        retainContextWhenHidden: true
      }
    }
  );

  // 拡張機能の解放対象として登録
  context.subscriptions.push(providerDisposable);
}

/**
 * 拡張機能が非アクティブ化されたときに呼び出される関数
 */
export function deactivate(): void {
  // 終了時の後片付けが必要な場合はここに記述
}
