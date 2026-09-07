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
    filesToIncludePlaceholder: '例: *.ts, src/**',
    filesToExcludePlaceholder: '例: node_modules/**, vendor/**',
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
   * 入力履歴管理クラス (VS Code 標準ライクな上下キーナビゲーション & 自動検索連動)
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

      this.inputElement.addEventListener('keydown', (e) => {
        // Shift, Ctrl, Alt が押されていない単独の上下キーで履歴遷移
        if (!e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
          if (e.key === 'ArrowUp') {
            this.navigateUp(e);
          } else if (e.key === 'ArrowDown') {
            this.navigateDown(e);
          }
        }
      });

      this.inputElement.addEventListener('input', () => {
        if (this.historyIndex === -1) {
          this.tempValue = this.inputElement.value;
        }
        if (this.inputElement === searchInput) {
          adjustSearchInputHeight();
        }
      });
    }

    /**
     * カーソルをテキスト末尾に移動し、必要なら高さを再計算
     */
    setCursorToEnd() {
      const len = this.inputElement.value.length;
      this.inputElement.setSelectionRange(len, len);
      if (this.inputElement === searchInput) {
        adjustSearchInputHeight();
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
        this.inputElement.value = this.history[this.historyIndex];
        this.setCursorToEnd();
        if (this.onNavigate) {
          this.onNavigate(this.inputElement.value);
        }
      }
    }

    /**
     * 下キーで新しい履歴へ移動
     * VS Code 標準準拠: 最新の履歴からさらに下を押すと空欄 (未入力状態) に戻る
     * @param {KeyboardEvent} e
     */
    navigateDown(e) {
      if (this.historyIndex === -1) return;
      e.preventDefault();
      if (this.historyIndex > 0) {
        this.historyIndex--;
        this.inputElement.value = this.history[this.historyIndex];
        this.setCursorToEnd();
        if (this.onNavigate) {
          this.onNavigate(this.inputElement.value);
        }
      } else if (this.historyIndex === 0) {
        // 最新履歴からさらに下を押した場合は確実に空欄に戻す
        this.historyIndex = -1;
        this.inputElement.value = '';
        this.setCursorToEnd();
        if (this.onNavigate) {
          this.onNavigate('');
        }
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
  /** @type {Map<string, { container: HTMLElement, matchList: HTMLElement, encTag: HTMLElement, badge: HTMLElement, matchElements: Map<number, HTMLElement>, renderedCount: number }>} */
  const fileDomMap = new Map();

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

  // 新規トグルオプション: 開いているエディターでのみ検索 / 除外設定を使用してファイルを無視
  let onlyOpenEditors = !!previousState.onlyOpenEditors;
  if (onlyOpenEditors && btnSearchOnlyOpenEditors) {
    btnSearchOnlyOpenEditors.classList.add('active');
  }

  let useExcludeSettings = previousState.useExcludeSettings !== undefined ? !!previousState.useExcludeSettings : true;
  if (btnUseExcludeSettings) {
    btnUseExcludeSettings.classList.toggle('active', useExcludeSettings);
  }

  // 状態の保存 (Webview ステートおよび VS Code 本体の globalState 永続化)
  function saveState() {
    const searchHist = searchHistoryNav.getHistory();
    const includeHist = includeHistoryNav.getHistory();
    const excludeHist = excludeHistoryNav.getHistory();

    vscode.setState({
      pattern: searchInput.value,
      isCaseSensitive,
      isWordMatch,
      isRegex,
      showLineNumbers,
      includePattern: includeInput.value,
      excludePattern: excludeInput.value,
      onlyOpenEditors,
      useExcludeSettings,
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

  // 履歴ナビゲーターの初期化 (上下キー移動時はデバウンス検索連動で素早いキー入力時も快適)
  const searchHistoryNav = new HistoryNavigator(
    searchInput,
    previousState.searchHistory && previousState.searchHistory.length > 0
      ? previousState.searchHistory
      : (initialHistory.searchHistory || []),
    saveState,
    () => scheduleSearch(500)
  );
  const includeHistoryNav = new HistoryNavigator(
    includeInput,
    previousState.includeHistory && previousState.includeHistory.length > 0
      ? previousState.includeHistory
      : (initialHistory.includeHistory || []),
    saveState,
    () => scheduleSearch(500)
  );
  const excludeHistoryNav = new HistoryNavigator(
    excludeInput,
    previousState.excludeHistory && previousState.excludeHistory.length > 0
      ? previousState.excludeHistory
      : (initialHistory.excludeHistory || []),
    saveState,
    () => scheduleSearch(500)
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

  // 「開いているエディターでのみ検索」ボタン
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

  // 「除外設定を使用してファイルを無視」ボタン
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

  // 詳細オプションの開閉 (三点リーダーボタン)
  btnToggleDetails.addEventListener('click', () => {
    const isHidden = detailsContainer.classList.toggle('hidden');
    btnToggleDetails.classList.toggle('active', !isHidden);
  });

  // placeholder の動的制御 (VS Code 標準準拠)
  searchInput.addEventListener('focus', () => {
    searchInput.placeholder = i18n.searchPlaceholderFocus || '検索 (履歴の⇅)';
  });
  searchInput.addEventListener('blur', () => {
    searchInput.placeholder = i18n.searchPlaceholderBlur || '検索';
  });

  includeInput.addEventListener('focus', () => {
    includeInput.placeholder = i18n.filesToIncludePlaceholder || '例: *.ts, src/**';
  });
  includeInput.addEventListener('blur', () => {
    includeInput.placeholder = '';
  });

  excludeInput.addEventListener('focus', () => {
    excludeInput.placeholder = i18n.filesToExcludePlaceholder || '例: node_modules/**, vendor/**';
  });
  excludeInput.addEventListener('blur', () => {
    excludeInput.placeholder = '';
  });

  /**
   * デバウンス付き検索スケジュール (文字入力後 500ms 経過で自動実行)
   * @param {number} [delayMs=500]
   */
  function scheduleSearch(delayMs = 500) {
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
      executeSearch(true);
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
        useIgnoreFiles: useExcludeSettings
      }
    });
  }

  // 入力イベントで自動デバウンス検索 & 高さ自動調整
  searchInput.addEventListener('input', () => {
    adjustSearchInputHeight();
    scheduleSearch(500);
  });
  searchInput.addEventListener('paste', () => {
    setTimeout(adjustSearchInputHeight, 0);
  });

  includeInput.addEventListener('input', () => scheduleSearch(500));
  excludeInput.addEventListener('input', () => scheduleSearch(500));

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
    selectedItem = null;
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

      case 'searchStart':
        isSearching = true;
        statusContainer.className = 'status-container';
        statusContainer.innerHTML = `<span class="spinner"></span> <span>${i18n.searching}</span>`;
        clearResults();
        break;

      case 'searchProgress':
        // 差分（インクリメンタル）レンダリングで即時ストリーミング表示
        renderIncrementalResults(message.results);
        if (message.totalMatches > 0) {
          statusContainer.className = 'status-container';
          statusContainer.innerHTML = `<span class="spinner"></span> <span>${i18n.searching} (${formatMatchCountText(message.totalFiles, message.totalMatches, message.isTruncated)})</span>`;
        }
        break;

      case 'searchComplete':
        isSearching = false;
        if (message.totalMatches === 0) {
          statusContainer.className = 'status-container';
          statusContainer.textContent = i18n.noResults;
          clearResults();
        } else {
          statusContainer.className = 'status-container';
          statusContainer.textContent = formatMatchCountText(message.totalFiles, message.totalMatches, message.isTruncated);
        }
        break;

      case 'searchCancelled':
        isSearching = false;
        statusContainer.className = 'status-container';
        statusContainer.textContent = i18n.searchCancelled;
        break;

      case 'searchError':
        isSearching = false;
        statusContainer.className = 'status-container error';
        statusContainer.textContent = `${message.errorMessage}`;
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

  // 現在選択中の結果アイテム (マッチ行またはファイルヘッダー)
  /** @type {HTMLElement | null} */
  let selectedItem = null;

  /**
   * アイテムを選択状態にする
   * @param {HTMLElement | null} element
   * @param {boolean} [shouldFocus=true]
   */
  function selectItem(element, shouldFocus = true) {
    if (selectedItem && selectedItem !== element) {
      selectedItem.classList.remove('selected');
    }
    selectedItem = element;
    if (selectedItem) {
      selectedItem.classList.add('selected');
      if (shouldFocus) {
        selectedItem.focus();
      }
      selectedItem.scrollIntoView({ block: 'nearest' });
    }
  }

  /**
   * 現在画面上に表示されている（折りたたまれていない）全アイテムを取得
   * @returns {HTMLElement[]}
   */
  function getVisibleItems() {
    /** @type {HTMLElement[]} */
    const items = [];
    const fileGroups = resultsContainer.querySelectorAll('.file-group');
    for (const group of fileGroups) {
      const header = /** @type {HTMLElement | null} */ (group.querySelector('.file-header'));
      if (header) items.push(header);
      const matchList = group.querySelector('.match-list');
      if (matchList && !matchList.classList.contains('hidden')) {
        const matchItems = matchList.querySelectorAll('.match-item');
        for (const m of matchItems) {
          items.push(/** @type {HTMLElement} */ (m));
        }
      }
    }
    return items;
  }

  /**
   * 結果一覧コンテナでのキーボード操作 (上下キー移動・Enterで開く・左右キー開閉)
   */
  resultsContainer.addEventListener('keydown', (e) => {
    const items = getVisibleItems();
    if (items.length === 0) return;

    const currentIndex = selectedItem ? items.indexOf(selectedItem) : -1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentIndex === -1 || currentIndex >= items.length - 1) {
        selectItem(items[0]);
      } else {
        selectItem(items[currentIndex + 1]);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentIndex > 0) {
        selectItem(items[currentIndex - 1]);
      } else if (currentIndex === 0) {
        // 先頭で上キーを押した場合は検索入力欄へフォーカス移動 (VS Code 標準導線)
        searchInput.focus();
        searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
      }
    } else if (e.key === 'Enter') {
      if (selectedItem) {
        e.preventDefault();
        selectedItem.click();
      }
    } else if (e.key === 'ArrowRight') {
      // ファイルヘッダーを展開
      if (selectedItem && selectedItem.classList.contains('file-header')) {
        const group = selectedItem.closest('.file-group');
        const matchList = group?.querySelector('.match-list');
        const toggleIcon = selectedItem.querySelector('.file-toggle-icon');
        if (matchList && matchList.classList.contains('hidden')) {
          matchList.classList.remove('hidden');
          toggleIcon?.classList.add('expanded');
          e.preventDefault();
        }
      }
    } else if (e.key === 'ArrowLeft') {
      if (selectedItem) {
        if (selectedItem.classList.contains('file-header')) {
          // ファイルヘッダーを折りたたみ
          const group = selectedItem.closest('.file-group');
          const matchList = group?.querySelector('.match-list');
          const toggleIcon = selectedItem.querySelector('.file-toggle-icon');
          if (matchList && !matchList.classList.contains('hidden')) {
            matchList.classList.add('hidden');
            toggleIcon?.classList.remove('expanded');
            e.preventDefault();
          }
        } else if (selectedItem.classList.contains('match-item')) {
          // マッチ行なら親のファイルヘッダーへ移動
          const group = selectedItem.closest('.file-group');
          const header = /** @type {HTMLElement | null} */ (group?.querySelector('.file-header'));
          if (header) {
            selectItem(header);
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
    matchItem.title = `${file.relativePath}:${match.lineNumber}:${match.columnNumber} [${formatEncodingName(match.encoding)}]`;

    const posSpan = document.createElement('span');
    posSpan.className = 'match-position';
    posSpan.textContent = `${match.lineNumber}`;

    const previewSpan = document.createElement('span');
    previewSpan.className = 'match-preview';
    previewSpan.innerHTML = buildHighlightedLineHtml(match.lineText, match.submatches);

    matchItem.appendChild(posSpan);
    matchItem.appendChild(previewSpan);

    // クリックで選択状態にし、ファイルを開いて文字コード自動適用＆ジャンプ
    matchItem.addEventListener('click', (e) => {
      e.stopPropagation();
      selectItem(matchItem, false);

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
        matchText
      });
    });

    return matchItem;
  }

  /**
   * 検索結果のインクリメンタル（差分）レンダリング & DOMソート順の厳密同期
   * 高速化のため、新規要素のみを作成し、既存行の文字コード改善時はピンポイント更新を行う。
   * さらに渡されたソート済み配列 (fileResults) の順序に合わせて DOM 要素を正しく再整列する。
   * @param {Array<any>} fileResults
   */
  function renderIncrementalResults(fileResults) {
    for (const file of fileResults) {
      let fileDom = fileDomMap.get(file.filePath);

      if (!fileDom) {
        // 新規ファイルグループ要素の作成
        const fileGroup = document.createElement('div');
        fileGroup.className = 'file-group';

        const fileHeader = document.createElement('div');
        fileHeader.className = 'file-header';
        fileHeader.tabIndex = 0;
        fileHeader.title = file.filePath;

        const toggleIcon = document.createElement('span');
        toggleIcon.className = 'file-toggle-icon expanded';
        toggleIcon.textContent = '▸';

        fileHeader.appendChild(toggleIcon);

        // ファイル拡張子アイコン
        if (file.iconUri) {
          const iconImg = document.createElement('img');
          iconImg.className = 'file-icon';
          iconImg.src = file.iconUri;
          iconImg.alt = '';
          fileHeader.appendChild(iconImg);
        }

        // VS Code 標準ライクな「ファイル名 (メイン)」＋「ディレクトリパス (サブ)」のコンテナ
        const labelContainer = document.createElement('div');
        labelContainer.className = 'file-label-container';

        const fileNameSpan = document.createElement('span');
        fileNameSpan.className = 'file-name';
        fileNameSpan.textContent = file.fileName || file.relativePath;

        labelContainer.appendChild(fileNameSpan);

        if (file.dirPath && file.dirPath.length > 0) {
          const dirSpan = document.createElement('span');
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
        matchList.className = 'match-list';

        // ヘッダークリックで選択および開閉トグル
        fileHeader.addEventListener('click', () => {
          selectItem(fileHeader, false);
          const isHidden = matchList.classList.toggle('hidden');
          toggleIcon.classList.toggle('expanded', !isHidden);
        });

        const matchElements = new Map();

        // 初回マッチ行の追加
        for (let i = 0; i < file.matches.length; i++) {
          const match = file.matches[i];
          const matchElem = createMatchItemElement(file, match);
          matchList.appendChild(matchElem);
          matchElements.set(match.lineNumber, matchElem);
        }

        fileGroup.appendChild(fileHeader);
        fileGroup.appendChild(matchList);

        fileDom = {
          container: fileGroup,
          matchList: matchList,
          encTag: encTag,
          badge: badge,
          matchElements: matchElements,
          renderedCount: file.matches.length
        };

        fileDomMap.set(file.filePath, fileDom);
      } else {
        // 既存ファイルグループの更新: プライマリエンコーディングとバッジの同期
        const primaryEnc = file.primaryEncoding || (file.matches[0] && file.matches[0].encoding) || 'utf-8';
        fileDom.encTag.className = `encoding-tag ${primaryEnc}`;
        fileDom.encTag.textContent = formatEncodingName(primaryEnc);
        fileDom.badge.textContent = file.matches.length.toString();

        // 既存行の更新または新規行の追加
        for (const match of file.matches) {
          const existingElem = fileDom.matchElements.get(match.lineNumber);
          if (existingElem) {
            // 文字コード改善等で行内容が変わっている可能性があるためプレビューを安全に再構築
            const previewSpan = existingElem.querySelector('.match-preview');
            if (previewSpan) {
              const newHtml = buildHighlightedLineHtml(match.lineText, match.submatches);
              if (previewSpan.innerHTML !== newHtml) {
                previewSpan.innerHTML = newHtml;
              }
            }
            existingElem.title = `${file.relativePath}:${match.lineNumber}:${match.columnNumber} [${formatEncodingName(match.encoding)}]`;
          } else {
            // 新規行の追加
            const newElem = createMatchItemElement(file, match);
            fileDom.matchList.appendChild(newElem);
            fileDom.matchElements.set(match.lineNumber, newElem);
          }
        }
      }
    }

    // 【重要】渡されたソート済み配列 (fileResults) の順序通りに DOM の子要素順序を完全に同期させる
    // appendChild は既存のノードを末尾に移動するため、fileResults の順序で呼ぶことで確実に正しい順序 (carry.php < stock.php) に整列される
    for (const file of fileResults) {
      const dom = fileDomMap.get(file.filePath);
      if (dom && dom.container) {
        resultsContainer.appendChild(dom.container);
      }
    }
  }
})();

