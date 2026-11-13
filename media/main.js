// @ts-check
/**
 * Multi-Encoding Search Webview スクリプト
 */
(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  // 多言語メッセージの取得
  // @ts-ignore
  const i18n = window.i18nStrings || {
    searchPlaceholderBlur: '検索',
    searchPlaceholderFocus: '検索 (履歴の⇅)',
    patternPlaceholderBlur: '例: *.ts, **/node_modules',
    patternPlaceholderFocus: '例: *.ts, **/node_modules (履歴の⇅)',
    searching: '検索中...',
    noResults: '一致する結果は見つかりませんでした。',
    resultsTruncated: ' (上限10,000件に達したため一部のみ表示)',
    searchCancelled: '検索がキャンセルされました。'
  };

  // DOM 要素の取得
  const searchInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('searchInput'));
  const btnCaseSensitive = /** @type {HTMLButtonElement} */ (document.getElementById('btnCaseSensitive'));
  const btnWordMatch = /** @type {HTMLButtonElement} */ (document.getElementById('btnWordMatch'));
  const btnRegex = /** @type {HTMLButtonElement} */ (document.getElementById('btnRegex'));
  const btnLineNumbers = /** @type {HTMLButtonElement} */ (document.getElementById('btnLineNumbers'));
  const btnToggleDetails = /** @type {HTMLButtonElement} */ (document.getElementById('btnToggleDetails'));
  const detailsContainer = /** @type {HTMLElement} */ (document.getElementById('detailsContainer'));
  const includeInput = /** @type {HTMLInputElement} */ (document.getElementById('includeInput'));
  const excludeInput = /** @type {HTMLInputElement} */ (document.getElementById('excludeInput'));
  const btnSearchOnlyOpenEditors = /** @type {HTMLButtonElement | null} */ (document.getElementById('btnSearchOnlyOpenEditors'));
  const btnSearchOnlyModifiedFiles = /** @type {HTMLButtonElement | null} */ (document.getElementById('btnSearchOnlyModifiedFiles'));
  const btnUseExcludeSettings = /** @type {HTMLButtonElement | null} */ (document.getElementById('btnUseExcludeSettings'));
  const statusContainer = /** @type {HTMLElement} */ (document.getElementById('statusContainer'));
  const resultsContainer = /** @type {HTMLElement} */ (document.getElementById('resultsContainer'));

  /**
   * 検索入力 textarea の高さを内容に応じて自動調整する (auto-grow)
   */
  function adjustSearchInputHeight() {
    searchInput.style.height = 'auto';
    const scrollHeight = searchInput.scrollHeight;
    const maxHeight = 134; // 最大約6〜7行分
    if (scrollHeight > maxHeight) {
      searchInput.style.height = `${maxHeight}px`;
      searchInput.style.overflowY = 'auto';
    } else {
      searchInput.style.height = `${Math.max(24, scrollHeight)}px`;
      searchInput.style.overflowY = 'hidden';
    }
  }

  /**
   * 入力履歴管理クラス (VS Code 標準ライクな上下キーナビゲーション & 全選択 & サクサク切替)
   */
  class HistoryNavigator {
    /**
     * @param {HTMLInputElement | HTMLTextAreaElement} inputElement
     * @param {string[]} initialHistory
     * @param {() => void} onSaveState
     * @param {((value: string) => void) | undefined} [onNavigate]
     */
    constructor(inputElement, initialHistory, onSaveState, onNavigate) {
      this.inputElement = inputElement;
      this.history = Array.isArray(initialHistory) ? initialHistory : [];
      this.historyIndex = -1;
      this.tempValue = '';
      this.onSaveState = onSaveState;
      this.onNavigate = onNavigate;

      this.inputElement.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
        // Shift, Ctrl, Alt, Meta が押されていない単独の上下キーで履歴遷移
        if (!e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
          if (e.key === 'ArrowUp') {
            if (this.canNavigateUp()) {
              this.navigateUp(e);
            }
          } else if (e.key === 'ArrowDown') {
            if (this.canNavigateDown()) {
              this.navigateDown(e);
            }
          }
        }
      });

      this.inputElement.addEventListener('input', () => {
        if (this.historyIndex === -1) {
          this.tempValue = this.inputElement.value;
        } else {
          // 履歴から選んだあとに編集した場合は最新入力として stash 更新
          this.historyIndex = -1;
          this.tempValue = this.inputElement.value;
        }
        if (this.inputElement === searchInput) {
          adjustSearchInputHeight();
        }
      });
    }

    /**
     * 上キーで履歴遷移可能かを判定 (VS Code 標準準拠: 単一行または先頭行/全選択時)
     */
    canNavigateUp() {
      if (this.history.length === 0) return false;
      const el = this.inputElement;
      // 全選択されている場合、またはカーソルが先頭にある場合は常に履歴遷移
      if (el.selectionStart === 0 && el.selectionEnd === el.value.length) return true;
      if (el.selectionStart === 0 && el.selectionEnd === 0) return true;
      // 単一行 (改行なし) の場合はどこにカーソルがあっても遷移可能
      if (!el.value.includes('\n')) return true;
      return false;
    }

    /**
     * 下キーで履歴遷移可能かを判定 (VS Code 標準準拠: 単一行または末尾行/全選択時)
     */
    canNavigateDown() {
      if (this.historyIndex === -1) return false;
      const el = this.inputElement;
      if (el.selectionStart === 0 && el.selectionEnd === el.value.length) return true;
      if (el.selectionStart === el.value.length && el.selectionEnd === el.value.length) return true;
      if (!el.value.includes('\n')) return true;
      return false;
    }

    /**
     * テキストを反映し、VS Code 標準同様に全選択状態にする (余計な自動検索は走らせない)
     * @param {string} val
     */
    applyValue(val) {
      this.inputElement.value = val;
      if (this.inputElement === searchInput) {
        adjustSearchInputHeight();
      }
      // VS Code 標準: 履歴移動時はテキストを全選択状態にする
      this.inputElement.select();
      if (this.onNavigate) {
        this.onNavigate(val);
      }
    }

    /**
     * 上キーで過去の履歴へ移動
     * @param {KeyboardEvent} e
     */
    navigateUp(e) {
      if (this.history.length === 0) return;
      e.preventDefault();
      if (this.historyIndex === -1) {
        this.tempValue = this.inputElement.value;
      }
      if (this.historyIndex < this.history.length - 1) {
        this.historyIndex++;
        this.applyValue(this.history[this.historyIndex]);
      }
    }

    /**
     * 下キーで新しい履歴へ移動
     * VS Code 標準準拠: 最新の履歴からさらに下を押すと入力途中の値 (stash) に戻る
     * @param {KeyboardEvent} e
     */
    navigateDown(e) {
      if (this.historyIndex === -1) return;
      e.preventDefault();
      if (this.historyIndex > 0) {
        this.historyIndex--;
        this.applyValue(this.history[this.historyIndex]);
      } else if (this.historyIndex === 0) {
        // 最新履歴からさらに下を押した場合は、入力途中だった値 (tempValue) に確実に復元
        this.historyIndex = -1;
        this.applyValue(this.tempValue || '');
      }
    }

    /**
     * 履歴に値を追加
     * @param {string} value
     */
    push(value) {
      const trimmed = value.trim();
      if (!trimmed) return;
      // 既存の同一履歴を削除して最新位置へ移動
      this.history = this.history.filter((item) => item !== trimmed);
      this.history.unshift(trimmed);
      // 最大50件保持
      if (this.history.length > 50) {
        this.history.pop();
      }
      this.historyIndex = -1;
      this.tempValue = '';
      this.onSaveState();
    }

    getHistory() {
      return this.history;
    }
  }

  // DOM キャッシュ: ファイルごとの要素情報を管理 (差分レンダリング用)
  /** @type {Map<string, { container: HTMLElement, header: HTMLElement, matchList: HTMLElement, toggleIcon: HTMLElement, dirSpan: HTMLElement | null, encTag: HTMLElement, badge: HTMLElement, matchElements: Map<string, HTMLElement>, renderedCount: number }>} */
  const fileDomMap = new Map();

  // 現在保持している最新の検索結果配列 (ツリー/リスト表示切替用)
  /** @type {Array<any>} */
  let currentFileResults = [];

  // 手動で折りたたまれた項目パス (ファイルパスまたはフォルダパス) のセット
  /** @type {Set<string>} */
  const collapsedPaths = new Set();

  // 検索状態の管理
  let isSearching = false;
  let isCaseSensitive = false;
  let isWordMatch = false;
  let isRegex = false;
  let showLineNumbers = false;

  // デバウンス検索タイマー
  /** @type {NodeJS.Timeout | null} */
  let debounceTimer = null;

  // 設定の適用 (カスタムプロパティを動的に上書き)
  /**
   * @param {any} settings
   */
  function applySettings(settings) {
    if (!settings) return;
    const root = document.documentElement;

    if (settings.showLineNumbers !== undefined) {
      showLineNumbers = !!settings.showLineNumbers;
      if (showLineNumbers) {
        document.body.classList.remove('hide-line-numbers');
        btnLineNumbers?.classList.add('active');
      } else {
        document.body.classList.add('hide-line-numbers');
        btnLineNumbers?.classList.remove('active');
      }
    }

    if (settings.fontSize && settings.fontSize > 0) {
      root.style.setProperty('--search-font-size', `${settings.fontSize}px`);
    } else {
      root.style.removeProperty('--search-font-size');
    }

    if (settings.fontFamily && settings.fontFamily.trim()) {
      root.style.setProperty('--search-font-family', settings.fontFamily.trim());
    } else {
      root.style.removeProperty('--search-font-family');
    }

    if (settings.matchHighlightBackground && settings.matchHighlightBackground.trim()) {
      root.style.setProperty('--search-highlight-bg', settings.matchHighlightBackground.trim());
    } else {
      root.style.removeProperty('--search-highlight-bg');
    }

    if (settings.matchHighlightForeground && settings.matchHighlightForeground.trim()) {
      root.style.setProperty('--search-highlight-fg', settings.matchHighlightForeground.trim());
    } else {
      root.style.removeProperty('--search-highlight-fg');
    }

    if (settings.textColor && settings.textColor.trim()) {
      root.style.setProperty('--search-text-color', settings.textColor.trim());
    } else {
      root.style.removeProperty('--search-text-color');
    }

    if (settings.secondaryTextColor && settings.secondaryTextColor.trim()) {
      root.style.setProperty('--search-secondary-color', settings.secondaryTextColor.trim());
    } else {
      root.style.removeProperty('--search-secondary-color');
    }
  }

  // 初期設定の適用
  // @ts-ignore
  if (window.initialSettings) {
    // @ts-ignore
    applySettings(window.initialSettings);
  } else {
    // 初期状態は行番号非表示
    document.body.classList.add('hide-line-numbers');
  }

  // 永続化ステートの復元
  const previousState = vscode.getState() || {};
  // @ts-ignore
  const initialHistory = window.initialHistory || {};

  if (previousState.pattern) {
    searchInput.value = previousState.pattern;
    setTimeout(adjustSearchInputHeight, 0);
  }
  if (previousState.isCaseSensitive) {
    isCaseSensitive = true;
    btnCaseSensitive.classList.add('active');
  }
  if (previousState.isWordMatch) {
    isWordMatch = true;
    btnWordMatch.classList.add('active');
  }
  if (previousState.isRegex) {
    isRegex = true;
    btnRegex.classList.add('active');
  }
  if (previousState.showLineNumbers !== undefined) {
    showLineNumbers = !!previousState.showLineNumbers;
    if (showLineNumbers) {
      document.body.classList.remove('hide-line-numbers');
      btnLineNumbers?.classList.add('active');
    } else {
      document.body.classList.add('hide-line-numbers');
      btnLineNumbers?.classList.remove('active');
    }
  }
  if (previousState.includePattern) {
    includeInput.value = previousState.includePattern;
  }
  if (previousState.excludePattern) {
    excludeInput.value = previousState.excludePattern;
  }

  // 詳細検索オプションの開閉状態の復元 (前回の状態または初期HTMLの反映)
  // ※ VS Code 標準準拠: 詳細検索が開いていても三点リーダーボタンは強調表示 (.active) しない
  // @ts-ignore
  let isDetailsExpanded = previousState.isDetailsExpanded !== undefined
    ? !!previousState.isDetailsExpanded
    // @ts-ignore
    : (window.initialDetailsExpanded !== undefined ? !!window.initialDetailsExpanded : false);

  detailsContainer.classList.toggle('hidden', !isDetailsExpanded);

  // ツリー表示 / リスト表示モードの復元
  // @ts-ignore
  let isTreeMode = previousState.isTreeMode !== undefined
    ? !!previousState.isTreeMode
    // @ts-ignore
    : (window.initialTreeMode !== undefined ? !!window.initialTreeMode : false);

  // トグルオプション: 開いているエディターでのみ検索 / 変更されたファイルのみ検索する (ソース管理) / 除外設定を使用してファイルを無視
  let onlyOpenEditors = !!previousState.onlyOpenEditors;
  if (onlyOpenEditors && btnSearchOnlyOpenEditors) {
    btnSearchOnlyOpenEditors.classList.add('active');
  }

  let onlyModifiedFiles = !!previousState.onlyModifiedFiles;
  if (onlyModifiedFiles && btnSearchOnlyModifiedFiles) {
    btnSearchOnlyModifiedFiles.classList.add('active');
  }

  let useExcludeSettings = previousState.useExcludeSettings !== undefined ? !!previousState.useExcludeSettings : true;
  if (btnUseExcludeSettings) {
    btnUseExcludeSettings.classList.toggle('active', useExcludeSettings);
  }

  // 折りたたみ状態 (collapsedPaths)・検索結果 (currentFileResults)・ステータス・選択アイテム・スクロール位置・フォーカス位置の復元
  if (Array.isArray(previousState.collapsedPaths)) {
    for (const p of previousState.collapsedPaths) {
      if (typeof p === 'string') {
        collapsedPaths.add(p);
      }
    }
  }
  if (Array.isArray(previousState.currentFileResults) && previousState.currentFileResults.length > 0) {
    currentFileResults = previousState.currentFileResults;
  }
  if (typeof previousState.statusText === 'string' && previousState.statusText.length > 0) {
    statusContainer.textContent = previousState.statusText;
    statusContainer.className = previousState.statusIsError ? 'status-container error' : 'status-container';
  }

  // スクロール位置と選択アイテム識別子・最後のフォーカス領域の保持
  /** @type {number} */
  let savedScrollTop = typeof previousState.scrollTop === 'number' ? previousState.scrollTop : 0;
  /** @type {string | null} */
  let selectedItemKey = typeof previousState.selectedItemKey === 'string' ? previousState.selectedItemKey : null;
  /** @type {'search' | 'include' | 'exclude' | 'results'} */
  let lastFocusedArea = previousState.lastFocusedArea || 'search';
  /** @type {NodeJS.Timeout | null} */
  let scrollSaveTimer = null;

  /**
   * 選択中の DOM 要素から永続化用の識別キーを取得する
   * @param {HTMLElement | null} el
   * @returns {string | null}
   */
  function getItemKey(el) {
    if (!el) return null;
    if (el.classList.contains('match-item')) {
      return el.getAttribute('data-match-key');
    }
    if (el.classList.contains('file-header')) {
      const group = el.closest('.file-group');
      const fp = group?.getAttribute('data-file-path');
      return fp ? `file:${fp}` : null;
    }
    if (el.classList.contains('folder-header')) {
      const group = el.closest('.folder-group');
      const dp = group?.getAttribute('data-folder-path');
      return dp ? `folder:${dp}` : null;
    }
    return null;
  }

  /**
   * 拡張機能ホスト側のコンテキストキー (タイトルバーのボタン有効化・アイコン切替) を同期する
   */
  function syncContextKeys() {
    const hasPattern = searchInput.value.trim().length > 0 || includeInput.value.trim().length > 0 || excludeInput.value.trim().length > 0;
    const hasResults = currentFileResults.length > 0;

    // 現在画面上に表示されている折りたたみ対象のうち、展開されているものが1つでもあるか確認
    let allCollapsed = false;
    if (hasResults) {
      const expandableLists = resultsContainer.querySelectorAll('.folder-children, .match-list');
      if (expandableLists.length > 0) {
        let anyExpanded = false;
        for (const list of expandableLists) {
          // 自身が hidden でなく、かつ親要素側も hidden でない場合のみ画面上で展開中と判定
          if (!list.classList.contains('hidden') && !list.parentElement?.closest('.hidden')) {
            anyExpanded = true;
            break;
          }
        }
        allCollapsed = !anyExpanded;
      }
    }

    vscode.postMessage({
      command: 'updateContextState',
      hasSearchPattern: searchInput.value.trim().length > 0,
      hasSearchResults: hasResults || hasPattern,
      allCollapsed,
      isTreeMode
    });
  }

  // 初期コンテキスト状態の通知
  setTimeout(syncContextKeys, 0);

  // 状態の保存 (Webview ステートおよび VS Code 本体の globalState 永続化)
  function saveState() {
    const searchHist = searchHistoryNav ? searchHistoryNav.getHistory() : (previousState.searchHistory || []);
    const includeHist = includeHistoryNav ? includeHistoryNav.getHistory() : (previousState.includeHistory || []);
    const excludeHist = excludeHistoryNav ? excludeHistoryNav.getHistory() : (previousState.excludeHistory || []);

    vscode.setState({
      pattern: searchInput.value,
      isCaseSensitive,
      isWordMatch,
      isRegex,
      showLineNumbers,
      includePattern: includeInput.value,
      excludePattern: excludeInput.value,
      onlyOpenEditors,
      onlyModifiedFiles,
      useExcludeSettings,
      isDetailsExpanded,
      isTreeMode,
      collapsedPaths: Array.from(collapsedPaths),
      currentFileResults,
      statusText: isSearching ? '' : (statusContainer.textContent || ''),
      statusIsError: statusContainer.classList.contains('error'),
      selectedItemKey,
      scrollTop: savedScrollTop,
      lastFocusedArea,
      searchHistory: searchHist,
      includeHistory: includeHist,
      excludeHistory: excludeHist
    });

    // VS Code 本体 (globalState) へ日をまたいだ履歴永続化メッセージを送信
    vscode.postMessage({
      command: 'saveHistory',
      searchHistory: searchHist,
      includeHistory: includeHist,
      excludeHistory: excludeHist
    });
  }

  // 履歴ナビゲーターの初期化 (VS Code 標準準拠: 上下キー移動時はテキスト全選択を行い、デバウンスで自動検索連動)
  const searchHistoryNav = new HistoryNavigator(
    searchInput,
    previousState.searchHistory && previousState.searchHistory.length > 0
      ? previousState.searchHistory
      : (initialHistory.searchHistory || []),
    saveState,
    () => {
      saveState();
      scheduleSearch(350); // 履歴巡回時も 350ms のデバウンスで自動検索連動
    }
  );
  const includeHistoryNav = new HistoryNavigator(
    includeInput,
    previousState.includeHistory && previousState.includeHistory.length > 0
      ? previousState.includeHistory
      : (initialHistory.includeHistory || []),
    saveState,
    () => {
      saveState();
      scheduleSearch(350);
    }
  );
  const excludeHistoryNav = new HistoryNavigator(
    excludeInput,
    previousState.excludeHistory && previousState.excludeHistory.length > 0
      ? previousState.excludeHistory
      : (initialHistory.excludeHistory || []),
    saveState,
    () => {
      saveState();
      scheduleSearch(350);
    }
  );

  // トグルボタンのイベントハンドラ
  btnCaseSensitive.addEventListener('click', () => {
    isCaseSensitive = !isCaseSensitive;
    btnCaseSensitive.classList.toggle('active', isCaseSensitive);
    saveState();
    if (searchInput.value.trim()) {
      executeSearch(false);
    }
  });

  btnWordMatch.addEventListener('click', () => {
    isWordMatch = !isWordMatch;
    btnWordMatch.classList.toggle('active', isWordMatch);
    saveState();
    if (searchInput.value.trim()) {
      executeSearch(false);
    }
  });

  btnRegex.addEventListener('click', () => {
    isRegex = !isRegex;
    btnRegex.classList.toggle('active', isRegex);
    saveState();
    if (searchInput.value.trim()) {
      executeSearch(false);
    }
  });

  if (btnLineNumbers) {
    btnLineNumbers.addEventListener('click', () => {
      showLineNumbers = !showLineNumbers;
      btnLineNumbers.classList.toggle('active', showLineNumbers);
      if (showLineNumbers) {
        document.body.classList.remove('hide-line-numbers');
      } else {
        document.body.classList.add('hide-line-numbers');
      }
      saveState();
    });
  }

  // 「開いているエディターでのみ検索」ボタン (トグル時に即座に検索再実行)
  if (btnSearchOnlyOpenEditors) {
    btnSearchOnlyOpenEditors.addEventListener('click', () => {
      onlyOpenEditors = !onlyOpenEditors;
      btnSearchOnlyOpenEditors.classList.toggle('active', onlyOpenEditors);
      saveState();
      if (searchInput.value.trim()) {
        executeSearch(false);
      }
    });
  }

  // 「変更されたファイルのみ検索する (ソース管理)」ボタン (トグル時に即座に検索再実行)
  if (btnSearchOnlyModifiedFiles) {
    btnSearchOnlyModifiedFiles.addEventListener('click', () => {
      onlyModifiedFiles = !onlyModifiedFiles;
      btnSearchOnlyModifiedFiles.classList.toggle('active', onlyModifiedFiles);
      saveState();
      if (searchInput.value.trim()) {
        executeSearch(false);
      }
    });
  }

  // 「除外設定を使用してファイルを無視」ボタン (トグル時に即座に検索再実行)
  if (btnUseExcludeSettings) {
    btnUseExcludeSettings.addEventListener('click', () => {
      useExcludeSettings = !useExcludeSettings;
      btnUseExcludeSettings.classList.toggle('active', useExcludeSettings);
      saveState();
      if (searchInput.value.trim()) {
        executeSearch(false);
      }
    });
  }

  // 詳細オプションの開閉 (三点リーダーボタン: VS Code 標準と同様にボタン自体は強調表示しない)
  btnToggleDetails.addEventListener('click', () => {
    isDetailsExpanded = !isDetailsExpanded;
    detailsContainer.classList.toggle('hidden', !isDetailsExpanded);
    saveState();
    vscode.postMessage({
      command: 'saveDetailsExpanded',
      isExpanded: isDetailsExpanded
    });
  });

  // placeholder およびツールチップ (title) の動的制御 & フォーカス位置の記憶 (VS Code 標準の InputBox + HistoryInputBox 仕様に完全準拠)
  searchInput.addEventListener('focus', () => {
    lastFocusedArea = 'search';
    const focusText = i18n.searchPlaceholderFocus || '検索 (履歴の⇅)';
    searchInput.placeholder = focusText;
    searchInput.title = focusText;
    saveState();
  });
  searchInput.addEventListener('blur', () => {
    const blurText = i18n.searchPlaceholderBlur || '検索';
    searchInput.placeholder = blurText;
    searchInput.title = blurText;
  });

  includeInput.addEventListener('focus', () => {
    lastFocusedArea = 'include';
    const focusText = i18n.patternPlaceholderFocus || '例: *.ts, **/node_modules (履歴の⇅)';
    includeInput.placeholder = focusText;
    includeInput.title = focusText;
    saveState();
  });
  includeInput.addEventListener('blur', () => {
    includeInput.placeholder = '';
    includeInput.title = i18n.patternPlaceholderBlur || '例: *.ts, **/node_modules';
  });

  excludeInput.addEventListener('focus', () => {
    lastFocusedArea = 'exclude';
    const focusText = i18n.patternPlaceholderFocus || '例: *.ts, **/node_modules (履歴の⇅)';
    excludeInput.placeholder = focusText;
    excludeInput.title = focusText;
    saveState();
  });
  excludeInput.addEventListener('blur', () => {
    excludeInput.placeholder = '';
    excludeInput.title = i18n.patternPlaceholderBlur || '例: *.ts, **/node_modules';
  });

  /**
   * デバウンス付き検索スケジュール (文字入力後または履歴移動後の自動実行)
   * 自動検索時は履歴順序の破壊を防ぐため addToHistory=false で実行する
   * @param {number} [delayMs=400]
   */
  function scheduleSearch(delayMs = 400) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    const pattern = searchInput.value.trim();
    if (!pattern) {
      if (isSearching) {
        vscode.postMessage({ command: 'cancel' });
      }
      clearResults();
      statusContainer.textContent = '';
      statusContainer.className = 'status-container';
      return;
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      // 自動検索時は履歴に追加しない (Enter キー押下時のみ履歴追加)
      executeSearch(false);
    }, delayMs);
  }

  /**
   * 検索実行処理
   * @param {boolean} [addToHistory=true]
   */
  function executeSearch(addToHistory = true) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    const pattern = searchInput.value.trim();
    if (!pattern) {
      if (isSearching) {
        vscode.postMessage({ command: 'cancel' });
      }
      clearResults();
      statusContainer.textContent = '';
      statusContainer.className = 'status-container';
      return;
    }

    if (addToHistory) {
      searchHistoryNav.push(searchInput.value);
      if (includeInput.value.trim()) {
        includeHistoryNav.push(includeInput.value);
      }
      if (excludeInput.value.trim()) {
        excludeHistoryNav.push(excludeInput.value);
      }
    }

    saveState();

    vscode.postMessage({
      command: 'search',
      options: {
        pattern: searchInput.value, // 改行を保持した完全な検索文字列
        isCaseSensitive,
        isWordMatch,
        isRegexp: isRegex,
        includePattern: includeInput.value.trim() || undefined,
        excludePattern: excludeInput.value.trim() || undefined,
        onlyOpenEditors,
        onlyModifiedFiles,
        useIgnoreFiles: useExcludeSettings
      }
    });
  }

  // 入力イベントで自動デバウンス検索 & 高さ自動調整 & コンテキスト同期
  searchInput.addEventListener('input', () => {
    adjustSearchInputHeight();
    syncContextKeys();
    scheduleSearch(500);
  });
  searchInput.addEventListener('paste', () => {
    setTimeout(adjustSearchInputHeight, 0);
  });

  includeInput.addEventListener('input', () => {
    syncContextKeys();
    scheduleSearch(500);
  });
  excludeInput.addEventListener('input', () => {
    syncContextKeys();
    scheduleSearch(500);
  });

  // Enter キー押下時の挙動 (VS Code 標準準拠: Shift+Enter で改行、Enter 単体で即時検索)
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        // Shift + Enter: 改行を挿入して高さを調整
        setTimeout(() => {
          adjustSearchInputHeight();
          scheduleSearch(500);
        }, 0);
      } else {
        // 通常の Enter: 改行を防ぎ、即時検索実行
        e.preventDefault();
        executeSearch(true);
      }
    }
  });

  includeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      executeSearch(true);
    }
  });

  excludeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      executeSearch(true);
    }
  });

  // 結果クリア
  function clearResults() {
    resultsContainer.innerHTML = '';
    fileDomMap.clear();
    currentFileResults = [];
    collapsedPaths.clear();
    selectedItem = null;
    selectedItemKey = null;
    savedScrollTop = 0;
    syncContextKeys();
  }

  /**
   * 現在の結果全体をすべて折りたたむ
   */
  function collapseAllResults() {
    const folders = resultsContainer.querySelectorAll('.folder-group');
    for (const fg of folders) {
      const folderPath = fg.getAttribute('data-folder-path');
      if (folderPath) collapsedPaths.add(`folder:${folderPath}`);
      const children = fg.querySelector(':scope > .folder-children');
      const icon = fg.querySelector(':scope > .folder-header .file-toggle-icon');
      children?.classList.add('hidden');
      icon?.classList.remove('expanded');
    }

    const files = resultsContainer.querySelectorAll('.file-group');
    for (const fileGroup of files) {
      const filePath = fileGroup.getAttribute('data-file-path');
      if (filePath) collapsedPaths.add(`file:${filePath}`);
      const matchList = fileGroup.querySelector(':scope > .match-list');
      const icon = fileGroup.querySelector(':scope > .file-header .file-toggle-icon');
      matchList?.classList.add('hidden');
      icon?.classList.remove('expanded');
    }

    // 結果データ上の全ファイルパスも collapsedPaths に登録し、表示モード切替や再描画時も確実に維持
    for (const f of currentFileResults) {
      if (f && f.filePath) {
        collapsedPaths.add(`file:${f.filePath}`);
      }
    }

    saveState();
    syncContextKeys();
  }

  /**
   * 現在の結果全体をすべて展開する
   */
  function expandAllResults() {
    collapsedPaths.clear();

    const folders = resultsContainer.querySelectorAll('.folder-group');
    for (const fg of folders) {
      const children = fg.querySelector(':scope > .folder-children');
      const icon = fg.querySelector(':scope > .folder-header .file-toggle-icon');
      children?.classList.remove('hidden');
      icon?.classList.add('expanded');
    }

    const files = resultsContainer.querySelectorAll('.file-group');
    for (const fileGroup of files) {
      const matchList = fileGroup.querySelector(':scope > .match-list');
      const icon = fileGroup.querySelector(':scope > .file-header .file-toggle-icon');
      matchList?.classList.remove('hidden');
      icon?.classList.add('expanded');
    }

    saveState();
    syncContextKeys();
  }

  /**
   * カウント文言のフォーマット
   * @param {number} totalFiles
   * @param {number} totalMatches
   * @param {boolean} isTruncated
   * @returns {string}
   */
  function formatMatchCountText(totalFiles, totalMatches, isTruncated) {
    let text = '';
    const isJa = i18n.searchPlaceholderBlur && i18n.searchPlaceholderBlur.includes('検索');
    if (isJa) {
      text = `${totalFiles} 個のファイルで ${totalMatches} 件の一致`;
    } else {
      text = `${totalFiles} files / ${totalMatches} matches`;
    }
    if (isTruncated) {
      text += i18n.resultsTruncated;
    }
    return text;
  }

  // 拡張機能ホストからのメッセージ受信
  window.addEventListener('message', (event) => {
    const message = event.data;

    switch (message.command) {
      case 'updateSettings':
        applySettings(message.settings);
        break;

      case 'viewVisible':
        // アクティビティバーのタブ切替で戻ってきた際、コンテキストキー・スクロール位置・フォーカス状態を完全復元（再検索やリセットは一切行わない）
        syncContextKeys();
        if (savedScrollTop > 0) {
          resultsContainer.scrollTop = savedScrollTop;
          requestAnimationFrame(() => {
            resultsContainer.scrollTop = savedScrollTop;
          });
        }
        if (lastFocusedArea === 'results' && selectedItem && !selectedItem.closest('.hidden')) {
          selectedItem.focus({ preventScroll: true });
        } else if (lastFocusedArea === 'include' && isDetailsExpanded) {
          includeInput.focus({ preventScroll: true });
        } else if (lastFocusedArea === 'exclude' && isDetailsExpanded) {
          excludeInput.focus({ preventScroll: true });
        }
        break;

      case 'focusSearchInput':
        if (message.initialQuery && message.initialQuery.trim() && message.initialQuery !== searchInput.value) {
          searchInput.value = message.initialQuery;
          adjustSearchInputHeight();
          executeSearch(true);
        }
        searchInput.focus();
        searchInput.select();
        break;

      case 'triggerRefresh':
        if (searchInput.value.trim()) {
          executeSearch(false);
        }
        break;

      case 'triggerClearAll':
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        isSearching = false;
        searchInput.value = '';
        includeInput.value = '';
        excludeInput.value = '';
        adjustSearchInputHeight();
        clearResults();
        statusContainer.textContent = '';
        statusContainer.className = 'status-container';
        saveState();
        syncContextKeys();
        break;

      case 'triggerSetViewMode':
        isTreeMode = !!message.isTreeMode;
        if (currentFileResults.length > 0) {
          renderResults(currentFileResults);
        }
        saveState();
        syncContextKeys();
        break;

      case 'triggerCollapseAll':
        collapseAllResults();
        break;

      case 'triggerExpandAll':
        expandAllResults();
        break;

      case 'triggerOpenSearchEditor':
        vscode.postMessage({
          command: 'openSearchEditorWithState',
          options: {
            pattern: searchInput.value,
            isCaseSensitive,
            isWordMatch,
            isRegexp: isRegex,
            includePattern: includeInput.value.trim() || undefined,
            excludePattern: excludeInput.value.trim() || undefined,
            onlyOpenEditors,
            useIgnoreFiles: useExcludeSettings
          },
          isDetailsExpanded
        });
        break;

      case 'searchStart':
        isSearching = true;
        statusContainer.className = 'status-container';
        statusContainer.innerHTML = `<span class="spinner"></span> <span>${i18n.searching}</span>`;
        clearResults();
        saveState();
        break;

      case 'searchProgress':
        currentFileResults = message.results || [];
        renderResults(currentFileResults);
        if (message.totalMatches > 0) {
          statusContainer.className = 'status-container';
          statusContainer.innerHTML = `<span class="spinner"></span> <span>${i18n.searching} (${formatMatchCountText(message.totalFiles, message.totalMatches, message.isTruncated)})</span>`;
        }
        syncContextKeys();
        break;

      case 'searchComplete':
        isSearching = false;
        if (message.totalMatches === 0) {
          statusContainer.className = 'status-container';
          if (onlyOpenEditors && !onlyModifiedFiles) {
            statusContainer.textContent = i18n.noResultsOpenEditors || i18n.noResults;
          } else if (onlyModifiedFiles && !onlyOpenEditors) {
            statusContainer.textContent = i18n.noResultsModifiedFiles || i18n.noResults;
          } else {
            statusContainer.textContent = i18n.noResults;
          }
          clearResults();
        } else {
          statusContainer.className = 'status-container';
          statusContainer.textContent = formatMatchCountText(message.totalFiles, message.totalMatches, message.isTruncated);
        }
        saveState();
        syncContextKeys();
        break;

      case 'searchCancelled':
        isSearching = false;
        statusContainer.className = 'status-container';
        statusContainer.textContent = i18n.searchCancelled;
        saveState();
        syncContextKeys();
        break;

      case 'searchError':
        isSearching = false;
        statusContainer.className = 'status-container error';
        statusContainer.textContent = `${message.errorMessage}`;
        saveState();
        syncContextKeys();
        break;
    }
  });

  /**
   * HTMLエスケープヘルパー (XSS防止)
   * @param {string} text
   * @returns {string}
   */
  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * マッチ箇所のハイライトを含むHTML文字列を生成する
   * @param {string} lineText
   * @param {Array<{matchText?: string, start: number, end: number}>} submatches
   * @returns {string}
   */
  function buildHighlightedLineHtml(lineText, submatches) {
    if (!submatches || submatches.length === 0) {
      return escapeHtml(lineText);
    }

    let html = '';
    let lastIndex = 0;

    for (const sub of submatches) {
      if (sub.start < lastIndex) continue;
      // マッチ前の通常テキスト
      if (sub.start > lastIndex) {
        html += escapeHtml(lineText.substring(lastIndex, sub.start));
      }
      // マッチした文字列
      const matchedStr = lineText.substring(sub.start, sub.end);
      html += `<span class="match-highlight">${escapeHtml(matchedStr)}</span>`;
      lastIndex = sub.end;
    }

    // 残りの通常テキスト
    if (lastIndex < lineText.length) {
      html += escapeHtml(lineText.substring(lastIndex));
    }

    return html;
  }

  /**
   * エンコーディング表示用ラベル名を取得
   * @param {string} enc
   * @returns {string}
   */
  function formatEncodingName(enc) {
    if (enc === 'euc-jp') return 'EUC-JP';
    if (enc === 'utf-8') return 'UTF-8';
    if (enc === 'shift_jis') return 'SJIS';
    if (enc === 'utf-16le') return 'UTF-16LE';
    if (enc === 'utf-16be') return 'UTF-16BE';
    if (enc === 'windows-1252') return 'CP1252';
    if (enc === 'gb18030') return 'GB18030';
    if (enc === 'gbk') return 'GBK';
    if (enc === 'big5') return 'BIG5';
    if (enc === 'euc-kr') return 'EUC-KR';
    return enc ? enc.toUpperCase() : 'UTF-8';
  }

  // 現在選択中の結果アイテム (マッチ行・ファイルヘッダー・フォルダヘッダー)
  /** @type {HTMLElement | null} */
  let selectedItem = null;

  /**
   * アイテムを選択状態にする (VS Code 標準準拠: 検索入力欄のフォーカスを確実に解除し、選択アイテムにフォーカス)
   * @param {HTMLElement | null} element
   * @param {boolean} [shouldFocus=true]
   */
  function selectItem(element, shouldFocus = true) {
    if (selectedItem && selectedItem !== element) {
      selectedItem.classList.remove('selected');
    }
    selectedItem = element;
    selectedItemKey = getItemKey(element);
    if (selectedItem) {
      selectedItem.classList.add('selected');
      if (shouldFocus) {
        lastFocusedArea = 'results';
        // 検索入力欄・詳細入力欄のフォーカスを確実に解除 (ペースト等の誤爆を完全防止)
        searchInput.blur();
        includeInput.blur();
        excludeInput.blur();
        element.focus({ preventScroll: true });
      }
      selectedItem.scrollIntoView({ block: 'nearest' });
    }
    saveState();
  }

  /**
   * 保存されている selectedItemKey に一致する DOM 要素を探して選択状態を復元する
   */
  function restoreSelectedItemFromKey() {
    if (!selectedItemKey) return;
    if (selectedItemKey.startsWith('match:')) {
      const candidates = resultsContainer.querySelectorAll('.match-item');
      for (const el of candidates) {
        if (el.getAttribute('data-match-key') === selectedItemKey) {
          selectedItem = /** @type {HTMLElement} */ (el);
          selectedItem.classList.add('selected');
          return;
        }
      }
    } else if (selectedItemKey.startsWith('file:')) {
      const targetPath = selectedItemKey.substring(5);
      const groups = resultsContainer.querySelectorAll('.file-group');
      for (const g of groups) {
        if (g.getAttribute('data-file-path') === targetPath) {
          const header = /** @type {HTMLElement | null} */ (g.querySelector(':scope > .file-header'));
          if (header) {
            selectedItem = header;
            selectedItem.classList.add('selected');
            return;
          }
        }
      }
    } else if (selectedItemKey.startsWith('folder:')) {
      const targetFolder = selectedItemKey.substring(7);
      const groups = resultsContainer.querySelectorAll('.folder-group');
      for (const g of groups) {
        if (g.getAttribute('data-folder-path') === targetFolder) {
          const header = /** @type {HTMLElement | null} */ (g.querySelector(':scope > .folder-header'));
          if (header) {
            selectedItem = header;
            selectedItem.classList.add('selected');
            return;
          }
        }
      }
    }
  }

  // スクロール位置の記憶 (非表示状態の 0 リセットを無視して正確に保持)
  resultsContainer.addEventListener('scroll', () => {
    if (document.visibilityState === 'hidden' || resultsContainer.offsetParent === null) {
      return;
    }
    savedScrollTop = resultsContainer.scrollTop;
    if (scrollSaveTimer) {
      clearTimeout(scrollSaveTimer);
    }
    scrollSaveTimer = setTimeout(() => {
      saveState();
    }, 150);
  });

  /**
   * 現在画面上に表示されている（折りたたまれていない）全アイテムを文書順に取得
   * @returns {HTMLElement[]}
   */
  function getVisibleItems() {
    /** @type {HTMLElement[]} */
    const items = [];
    const candidates = resultsContainer.querySelectorAll('.folder-header, .file-header, .match-item');
    for (const el of candidates) {
      if (!el.closest('.hidden')) {
        items.push(/** @type {HTMLElement} */ (el));
      }
    }
    return items;
  }

  /**
   * 結果一覧コンテナでのペースト操作防止 (検索入力欄への誤爆を完全防止)
   */
  resultsContainer.addEventListener('paste', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  /**
   * 結果一覧コンテナでのコピー操作 (VS Code 標準準拠: 選択中の一致行テキストまたはファイル/フォルダパスをクリップボードにコピー)
   */
  resultsContainer.addEventListener('copy', (e) => {
    if (!selectedItem) return;
    // @ts-ignore
    if (selectedItem.classList.contains('match-item') && selectedItem._match) {
      // @ts-ignore
      const lineText = selectedItem._match.lineText;
      if (lineText) {
        e.clipboardData?.setData('text/plain', lineText);
        e.preventDefault();
      }
    } else if (selectedItem.classList.contains('file-header')) {
      // @ts-ignore
      const file = selectedItem._file;
      const pathText = file ? (file.relativePath || file.filePath) : '';
      if (pathText) {
        e.clipboardData?.setData('text/plain', pathText);
        e.preventDefault();
      }
    } else if (selectedItem.classList.contains('folder-header')) {
      // @ts-ignore
      const folderPath = selectedItem._folderPath || '';
      if (folderPath) {
        e.clipboardData?.setData('text/plain', folderPath);
        e.preventDefault();
      }
    }
  });

  /**
   * 結果一覧コンテナでのキーボード操作 (上下キー移動・Enterで開く・左右キー開閉)
   */
  resultsContainer.addEventListener('keydown', (e) => {
    const items = getVisibleItems();
    if (items.length === 0) return;

    const currentIndex = selectedItem ? items.indexOf(selectedItem) : -1;

    /**
     * 指定アイテムがマッチ行の場合、エディタプレビューを同期する (フォーカスは検索パネルに残す)
     * @param {HTMLElement} item
     */
    const triggerPreview = (item) => {
      // @ts-ignore
      if (item && item.classList.contains('match-item') && item._file && item._match) {
        // @ts-ignore
        const file = item._file;
        // @ts-ignore
        const match = item._match;
        const firstSub = match.submatches && match.submatches[0];
        const matchLength = firstSub ? firstSub.end - firstSub.start : 1;
        const matchText = firstSub ? firstSub.matchText : '';
        vscode.postMessage({
          command: 'openFile',
          filePath: file.filePath,
          line: match.lineNumber,
          column: match.columnNumber,
          length: matchLength,
          encoding: match.encoding,
          matchText,
          preserveFocus: true
        });
      }
    };

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = (currentIndex === -1 || currentIndex >= items.length - 1) ? 0 : currentIndex + 1;
      const nextItem = items[nextIndex];
      selectItem(nextItem, true);
      triggerPreview(nextItem);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentIndex > 0) {
        const prevItem = items[currentIndex - 1];
        selectItem(prevItem, true);
        triggerPreview(prevItem);
      } else if (currentIndex === 0) {
        // 先頭で上キーを押した場合は検索入力欄へフォーカス移動 (VS Code 標準導線)
        searchInput.focus();
        searchInput.select();
      }
    } else if (e.key === 'Enter') {
      if (selectedItem) {
        e.preventDefault();
        // @ts-ignore
        if (selectedItem.classList.contains('match-item') && selectedItem._file && selectedItem._match) {
          // Enter キー押下時はエディタにフォーカスを移動する (preserveFocus: false)
          // @ts-ignore
          const file = selectedItem._file;
          // @ts-ignore
          const match = selectedItem._match;
          const firstSub = match.submatches && match.submatches[0];
          const matchLength = firstSub ? firstSub.end - firstSub.start : 1;
          const matchText = firstSub ? firstSub.matchText : '';
          vscode.postMessage({
            command: 'openFile',
            filePath: file.filePath,
            line: match.lineNumber,
            column: match.columnNumber,
            length: matchLength,
            encoding: match.encoding,
            matchText,
            preserveFocus: false
          });
        } else {
          selectedItem.click();
        }
      }
    } else if (e.key === 'ArrowRight') {
      if (selectedItem) {
        if (selectedItem.classList.contains('folder-header')) {
          const group = selectedItem.closest('.folder-group');
          const children = group?.querySelector(':scope > .folder-children');
          const toggleIcon = selectedItem.querySelector('.file-toggle-icon');
          const folderPath = group?.getAttribute('data-folder-path');
          if (children && children.classList.contains('hidden')) {
            children.classList.remove('hidden');
            toggleIcon?.classList.add('expanded');
            if (folderPath) collapsedPaths.delete(`folder:${folderPath}`);
            saveState();
            syncContextKeys();
            e.preventDefault();
          }
        } else if (selectedItem.classList.contains('file-header')) {
          const group = selectedItem.closest('.file-group');
          const matchList = group?.querySelector(':scope > .match-list');
          const toggleIcon = selectedItem.querySelector('.file-toggle-icon');
          const filePath = group?.getAttribute('data-file-path');
          if (matchList && matchList.classList.contains('hidden')) {
            matchList.classList.remove('hidden');
            toggleIcon?.classList.add('expanded');
            if (filePath) collapsedPaths.delete(`file:${filePath}`);
            saveState();
            syncContextKeys();
            e.preventDefault();
          }
        }
      }
    } else if (e.key === 'ArrowLeft') {
      if (selectedItem) {
        if (selectedItem.classList.contains('folder-header')) {
          const group = selectedItem.closest('.folder-group');
          const children = group?.querySelector(':scope > .folder-children');
          const toggleIcon = selectedItem.querySelector('.file-toggle-icon');
          const folderPath = group?.getAttribute('data-folder-path');
          if (children && !children.classList.contains('hidden')) {
            children.classList.add('hidden');
            toggleIcon?.classList.remove('expanded');
            if (folderPath) collapsedPaths.add(`folder:${folderPath}`);
            saveState();
            syncContextKeys();
            e.preventDefault();
          } else {
            // 既に折りたたまれている場合は親フォルダヘッダーへ移動
            const parentFolder = group?.parentElement?.closest('.folder-group');
            const parentHeader = /** @type {HTMLElement | null} */ (parentFolder?.querySelector(':scope > .folder-header'));
            if (parentHeader) {
              selectItem(parentHeader, true);
              e.preventDefault();
            }
          }
        } else if (selectedItem.classList.contains('file-header')) {
          const group = selectedItem.closest('.file-group');
          const matchList = group?.querySelector(':scope > .match-list');
          const toggleIcon = selectedItem.querySelector('.file-toggle-icon');
          const filePath = group?.getAttribute('data-file-path');
          if (matchList && !matchList.classList.contains('hidden')) {
            matchList.classList.add('hidden');
            toggleIcon?.classList.remove('expanded');
            if (filePath) collapsedPaths.add(`file:${filePath}`);
            saveState();
            syncContextKeys();
            e.preventDefault();
          } else {
            // 既に折りたたまれている場合、ツリー表示なら親フォルダヘッダーへ移動
            const parentFolder = group?.closest('.folder-group');
            const parentHeader = /** @type {HTMLElement | null} */ (parentFolder?.querySelector(':scope > .folder-header'));
            if (parentHeader) {
              selectItem(parentHeader, true);
              e.preventDefault();
            }
          }
        } else if (selectedItem.classList.contains('match-item')) {
          // マッチ行なら親のファイルヘッダーへ移動
          const group = selectedItem.closest('.file-group');
          const header = /** @type {HTMLElement | null} */ (group?.querySelector(':scope > .file-header'));
          if (header) {
            selectItem(header, true);
            e.preventDefault();
          }
        }
      }
    }
  });

  /**
   * 単一のマッチアイテムDOM要素を生成する
   * @param {any} file
   * @param {any} match
   * @returns {HTMLElement}
   */
  function createMatchItemElement(file, match) {
    const matchItem = document.createElement('div');
    matchItem.className = 'match-item';
    matchItem.tabIndex = 0;
    const matchKey = match.id || `${match.lineNumber}:${match.columnNumber}`;
    matchItem.setAttribute('data-match-key', `match:${file.filePath}::${matchKey}`);
    matchItem.title = `${file.relativePath}:${match.lineNumber}:${match.columnNumber} [${formatEncodingName(match.encoding)}]`;

    // @ts-ignore
    matchItem._file = file;
    // @ts-ignore
    matchItem._match = match;

    const posSpan = document.createElement('span');
    posSpan.className = 'match-position';
    posSpan.textContent = `${match.lineNumber}`;

    const previewSpan = document.createElement('span');
    previewSpan.className = 'match-preview';
    previewSpan.innerHTML = buildHighlightedLineHtml(match.lineText, match.submatches);

    matchItem.appendChild(posSpan);
    matchItem.appendChild(previewSpan);

    /**
     * ファイルオープン要求を送信
     * @param {boolean} preserveFocus
     */
    const openMatch = (preserveFocus = true) => {
      const firstSub = match.submatches && match.submatches[0];
      const matchLength = firstSub ? firstSub.end - firstSub.start : 1;
      const matchText = firstSub ? firstSub.matchText : '';

      vscode.postMessage({
        command: 'openFile',
        filePath: file.filePath,
        line: match.lineNumber,
        column: match.columnNumber,
        length: matchLength,
        encoding: match.encoding,
        matchText,
        preserveFocus
      });
    };

    // クリックで選択状態にし、フォーカスを当ててエディタプレビューを開く (フォーカスは検索パネルに残す)
    matchItem.addEventListener('click', (e) => {
      e.stopPropagation();
      selectItem(matchItem, true);
      openMatch(true);
    });

    // ダブルクリックでエディタにフォーカスを移動して開く
    matchItem.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      openMatch(false);
    });

    return matchItem;
  }

  /**
   * ファイルグループの DOM 要素を取得または更新して返す (リスト表示・ツリー表示共通)
   * @param {any} file
   * @param {number} depth ツリー表示時のネスト深さ (リスト表示時は 0)
   * @param {boolean} hideDirPath ツリー表示時はディレクトリパス表記を非表示にする
   */
  function getOrUpdateFileGroupDom(file, depth = 0, hideDirPath = false) {
    let fileDom = fileDomMap.get(file.filePath);
    const isFileCollapsed = collapsedPaths.has(`file:${file.filePath}`);

    if (!fileDom) {
      const fileGroup = document.createElement('div');
      fileGroup.className = 'file-group';
      fileGroup.setAttribute('data-file-path', file.filePath);

      const fileHeader = document.createElement('div');
      fileHeader.className = 'file-header';
      fileHeader.tabIndex = 0;
      fileHeader.title = file.filePath;
      // @ts-ignore
      fileHeader._file = file;

      const toggleIcon = document.createElement('span');
      toggleIcon.className = `file-toggle-icon ${isFileCollapsed ? '' : 'expanded'}`;
      toggleIcon.textContent = '▸';

      fileHeader.appendChild(toggleIcon);

      if (file.iconUri) {
        const iconImg = document.createElement('img');
        iconImg.className = 'file-icon';
        iconImg.src = file.iconUri;
        iconImg.alt = '';
        fileHeader.appendChild(iconImg);
      }

      const labelContainer = document.createElement('div');
      labelContainer.className = 'file-label-container';

      const fileNameSpan = document.createElement('span');
      fileNameSpan.className = 'file-name';
      fileNameSpan.textContent = file.fileName || file.relativePath;
      labelContainer.appendChild(fileNameSpan);

      /** @type {HTMLElement | null} */
      let dirSpan = null;
      if (file.dirPath && file.dirPath.length > 0) {
        dirSpan = document.createElement('span');
        dirSpan.className = 'file-dir';
        dirSpan.textContent = file.dirPath;
        labelContainer.appendChild(dirSpan);
      }

      const encTag = document.createElement('span');
      const primaryEnc = file.primaryEncoding || (file.matches[0] && file.matches[0].encoding) || 'utf-8';
      encTag.className = `encoding-tag ${primaryEnc}`;
      encTag.textContent = formatEncodingName(primaryEnc);

      const badge = document.createElement('span');
      badge.className = 'match-count-badge';
      badge.textContent = file.matches.length.toString();

      fileHeader.appendChild(labelContainer);
      fileHeader.appendChild(encTag);
      fileHeader.appendChild(badge);

      const matchList = document.createElement('div');
      matchList.className = `match-list ${isFileCollapsed ? 'hidden' : ''}`;

      fileHeader.addEventListener('click', () => {
        selectItem(fileHeader, true);
        const isHidden = matchList.classList.toggle('hidden');
        toggleIcon.classList.toggle('expanded', !isHidden);
        if (isHidden) {
          collapsedPaths.add(`file:${file.filePath}`);
        } else {
          collapsedPaths.delete(`file:${file.filePath}`);
        }
        saveState();
        syncContextKeys();
      });

      const matchElements = new Map();
      for (let i = 0; i < file.matches.length; i++) {
        const match = file.matches[i];
        const matchElem = createMatchItemElement(file, match);
        matchList.appendChild(matchElem);
        const matchKey = match.id || `${match.lineNumber}:${match.columnNumber}`;
        matchElements.set(matchKey, matchElem);
      }

      fileGroup.appendChild(fileHeader);
      fileGroup.appendChild(matchList);

      fileDom = {
        container: fileGroup,
        header: fileHeader,
        matchList,
        toggleIcon,
        dirSpan,
        encTag,
        badge,
        matchElements,
        renderedCount: file.matches.length
      };

      fileDomMap.set(file.filePath, fileDom);
    } else {
      // 既存ファイルグループの更新
      // @ts-ignore
      fileDom.header._file = file;
      const primaryEnc = file.primaryEncoding || (file.matches[0] && file.matches[0].encoding) || 'utf-8';
      fileDom.encTag.className = `encoding-tag ${primaryEnc}`;
      fileDom.encTag.textContent = formatEncodingName(primaryEnc);
      fileDom.badge.textContent = file.matches.length.toString();

      for (const match of file.matches) {
        const matchKey = match.id || `${match.lineNumber}:${match.columnNumber}`;
        const existingElem = fileDom.matchElements.get(matchKey);
        if (existingElem) {
          // @ts-ignore
          existingElem._file = file;
          // @ts-ignore
          existingElem._match = match;
          const previewSpan = existingElem.querySelector('.match-preview');
          if (previewSpan) {
            const newHtml = buildHighlightedLineHtml(match.lineText, match.submatches);
            if (previewSpan.innerHTML !== newHtml) {
              previewSpan.innerHTML = newHtml;
            }
          }
          existingElem.title = `${file.relativePath}:${match.lineNumber}:${match.columnNumber} [${formatEncodingName(match.encoding)}]`;
        } else {
          const newElem = createMatchItemElement(file, match);
          fileDom.matchList.appendChild(newElem);
          fileDom.matchElements.set(matchKey, newElem);
        }
      }

      for (const match of file.matches) {
        const matchKey = match.id || `${match.lineNumber}:${match.columnNumber}`;
        const elem = fileDom.matchElements.get(matchKey);
        if (elem) {
          fileDom.matchList.appendChild(elem);
        }
      }
    }

    // 折りたたみ状態を最新の collapsedPaths と確実に同期
    fileDom.matchList.classList.toggle('hidden', isFileCollapsed);
    fileDom.toggleIcon.classList.toggle('expanded', !isFileCollapsed);

    // 深さに応じたインデントとディレクトリ表示の制御
    fileDom.header.style.paddingLeft = `${4 + depth * 12}px`;
    if (fileDom.dirSpan) {
      fileDom.dirSpan.style.display = hideDirPath ? 'none' : '';
    }
    const matchPaddingLeft = `${20 + depth * 12}px`;
    for (const matchElem of fileDom.matchElements.values()) {
      matchElem.style.paddingLeft = matchPaddingLeft;
    }

    return fileDom;
  }

  /**
   * 検索結果のレンダリング (リスト表示 / ツリー表示を自動切替)
   * @param {Array<any>} fileResults
   */
  function renderResults(fileResults) {
    if (isTreeMode) {
      renderTreeResults(fileResults);
    } else {
      renderListResults(fileResults);
    }
    restoreSelectedItemFromKey();
  }

  /**
   * リスト表示モード (フラットなファイル一覧) のレンダリング
   * @param {Array<any>} fileResults
   */
  function renderListResults(fileResults) {
    // ツリー表示用のフォルダ要素が残っていればクリア
    const oldFolders = resultsContainer.querySelectorAll('.folder-group');
    for (const f of oldFolders) {
      f.remove();
    }

    for (const file of fileResults) {
      const dom = getOrUpdateFileGroupDom(file, 0, false);
      resultsContainer.appendChild(dom.container);
    }
  }

  /**
   * ツリー表示モード (ディレクトリ階層ツリー) のレンダリング
   * VS Code 標準検索のツリー表示と同様に、単一子フォルダの圧縮 (compact folders) に対応
   * @param {Array<any>} fileResults
   */
  function renderTreeResults(fileResults) {
    /**
     * @typedef {{ name: string, fullPath: string, folders: Map<string, FolderTreeNode>, files: Array<any>, totalMatches: number }} FolderTreeNode
     */
    /** @type {FolderTreeNode} */
    const root = {
      name: '',
      fullPath: '',
      folders: new Map(),
      files: [],
      totalMatches: 0
    };

    for (const file of fileResults) {
      const matchCount = file.matches ? file.matches.length : 0;
      root.totalMatches += matchCount;

      const dirPath = file.dirPath ? file.dirPath.trim() : '';
      if (!dirPath) {
        root.files.push(file);
        continue;
      }

      const parts = dirPath.split('/').filter((p) => p.length > 0);
      let current = root;
      let builtPath = '';

      for (const part of parts) {
        builtPath = builtPath ? `${builtPath}/${part}` : part;
        let childFolder = current.folders.get(part);
        if (!childFolder) {
          childFolder = {
            name: part,
            fullPath: builtPath,
            folders: new Map(),
            files: [],
            totalMatches: 0
          };
          current.folders.set(part, childFolder);
        }
        childFolder.totalMatches += matchCount;
        current = childFolder;
      }

      current.files.push(file);
    }

    /**
     * 単一の子フォルダしか持たず直接ファイルを持たない中間フォルダを圧縮する (例: src/utils)
     * @param {FolderTreeNode} node
     */
    function compactFolderNode(node) {
      while (node.files.length === 0 && node.folders.size === 1) {
        const onlyChild = Array.from(node.folders.values())[0];
        node.name = node.name ? `${node.name}/${onlyChild.name}` : onlyChild.name;
        node.fullPath = onlyChild.fullPath;
        node.folders = onlyChild.folders;
        node.files = onlyChild.files;
      }
      for (const child of node.folders.values()) {
        compactFolderNode(child);
      }
    }

    for (const topFolder of root.folders.values()) {
      compactFolderNode(topFolder);
    }

    // コンテナを一旦クリアしてツリー構造を再構築 (ファイルDOM自体は fileDomMap から再利用)
    resultsContainer.innerHTML = '';

    /**
     * フォルダノードのDOM要素を再帰的に生成
     * @param {FolderTreeNode} folderNode
     * @param {number} depth
     * @returns {HTMLElement}
     */
    function buildFolderDom(folderNode, depth) {
      const folderGroup = document.createElement('div');
      folderGroup.className = 'folder-group';
      folderGroup.setAttribute('data-folder-path', folderNode.fullPath);

      const isCollapsed = collapsedPaths.has(`folder:${folderNode.fullPath}`);

      const folderHeader = document.createElement('div');
      folderHeader.className = 'folder-header';
      folderHeader.tabIndex = 0;
      folderHeader.title = folderNode.fullPath;
      folderHeader.style.paddingLeft = `${4 + depth * 12}px`;
      // @ts-ignore
      folderHeader._folderPath = folderNode.fullPath;

      const toggleIcon = document.createElement('span');
      toggleIcon.className = `file-toggle-icon ${isCollapsed ? '' : 'expanded'}`;
      toggleIcon.textContent = '▸';
      folderHeader.appendChild(toggleIcon);

      // フォルダ SVG アイコン
      const folderIconWrap = document.createElement('span');
      folderIconWrap.className = 'folder-icon';
      folderIconWrap.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M14.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h13l.5-.5v-10L14.5 3zm-.51 8.49V13h-12V7h4.49l.35-.15.86-.86H14v5.5zm0-6.49h-6.5l-.35.15-.86.86H2v-3h4.29l.85.85.36.15H14l-.01 1z"/></svg>`;
      folderHeader.appendChild(folderIconWrap);

      const labelContainer = document.createElement('div');
      labelContainer.className = 'file-label-container';

      const folderNameSpan = document.createElement('span');
      folderNameSpan.className = 'folder-name';
      folderNameSpan.textContent = folderNode.name;
      labelContainer.appendChild(folderNameSpan);

      const badge = document.createElement('span');
      badge.className = 'match-count-badge';
      badge.textContent = folderNode.totalMatches.toString();

      folderHeader.appendChild(labelContainer);
      folderHeader.appendChild(badge);

      const childrenContainer = document.createElement('div');
      childrenContainer.className = `folder-children ${isCollapsed ? 'hidden' : ''}`;

      folderHeader.addEventListener('click', () => {
        selectItem(folderHeader, true);
        const isHidden = childrenContainer.classList.toggle('hidden');
        toggleIcon.classList.toggle('expanded', !isHidden);
        if (isHidden) {
          collapsedPaths.add(`folder:${folderNode.fullPath}`);
        } else {
          collapsedPaths.delete(`folder:${folderNode.fullPath}`);
        }
        saveState();
        syncContextKeys();
      });

      // 子フォルダを自然順ソートして追加
      const sortedSubfolders = Array.from(folderNode.folders.values()).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      );
      for (const sub of sortedSubfolders) {
        childrenContainer.appendChild(buildFolderDom(sub, depth + 1));
      }

      // フォルダ直下のファイルを追加
      for (const file of folderNode.files) {
        const fileDom = getOrUpdateFileGroupDom(file, depth + 1, true);
        childrenContainer.appendChild(fileDom.container);
      }

      folderGroup.appendChild(folderHeader);
      folderGroup.appendChild(childrenContainer);
      return folderGroup;
    }

    // ルート直下のフォルダを自然順ソートして追加
    const sortedTopFolders = Array.from(root.folders.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );
    for (const topFolder of sortedTopFolders) {
      resultsContainer.appendChild(buildFolderDom(topFolder, 0));
    }

    // ルート直下のファイルを追加
    for (const rootFile of root.files) {
      const fileDom = getOrUpdateFileGroupDom(rootFile, 0, true);
      resultsContainer.appendChild(fileDom.container);
    }
  }

  // 初回ロード時: 永続化されていた検索結果・折りたたみ状態・選択行・スクロール位置を完全復元
  if (currentFileResults.length > 0) {
    renderResults(currentFileResults);
    if (savedScrollTop > 0) {
      resultsContainer.scrollTop = savedScrollTop;
      requestAnimationFrame(() => {
        resultsContainer.scrollTop = savedScrollTop;
      });
    }
    syncContextKeys();
  }
})();

