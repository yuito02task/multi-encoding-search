// @ts-check
/**
 * EUC-JP Search Webview スクリプト
 */
(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  // 多言語メッセージの取得
  // @ts-ignore
  const i18n = window.i18nStrings || {
    searchBtn: '検索',
    stopBtn: '停止',
    searching: '検索中...',
    noResults: '一致する結果は見つかりませんでした。',
    resultsTruncated: ' (上限10,000件に達したため一部のみ表示)',
    searchCancelled: '検索がキャンセルされました。'
  };

  // DOM 要素の取得
  const searchInput = /** @type {HTMLInputElement} */ (document.getElementById('searchInput'));
  const btnSearch = /** @type {HTMLButtonElement} */ (document.getElementById('btnSearch'));
  const btnCaseSensitive = /** @type {HTMLButtonElement} */ (document.getElementById('btnCaseSensitive'));
  const btnWordMatch = /** @type {HTMLButtonElement} */ (document.getElementById('btnWordMatch'));
  const btnRegex = /** @type {HTMLButtonElement} */ (document.getElementById('btnRegex'));
  const btnToggleDetails = /** @type {HTMLButtonElement} */ (document.getElementById('btnToggleDetails'));
  const detailsToggleIcon = /** @type {HTMLElement} */ (document.getElementById('detailsToggleIcon'));
  const detailsContainer = /** @type {HTMLElement} */ (document.getElementById('detailsContainer'));
  const includeInput = /** @type {HTMLInputElement} */ (document.getElementById('includeInput'));
  const excludeInput = /** @type {HTMLInputElement} */ (document.getElementById('excludeInput'));
  const statusContainer = /** @type {HTMLElement} */ (document.getElementById('statusContainer'));
  const resultsContainer = /** @type {HTMLElement} */ (document.getElementById('resultsContainer'));

    // DOM キャッシュ: ファイルごとの要素情報を管理 (差分レンダリング用)
  /** @type {Map<string, { container: HTMLElement, matchList: HTMLElement, badge: HTMLElement, renderedCount: number }>} */
  const fileDomMap = new Map();

  // 検索状態の管理
  let isSearching = false;
  let isCaseSensitive = false;
  let isWordMatch = false;
  let isRegex = false;

  // 永続化ステートの復元
  const previousState = vscode.getState() || {};
  if (previousState.pattern) {
    searchInput.value = previousState.pattern;
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
  if (previousState.includePattern) {
    includeInput.value = previousState.includePattern;
  }
  if (previousState.excludePattern) {
    excludeInput.value = previousState.excludePattern;
  }

  // 状態の保存
  function saveState() {
    vscode.setState({
      pattern: searchInput.value,
      isCaseSensitive,
      isWordMatch,
      isRegex,
      includePattern: includeInput.value,
      excludePattern: excludeInput.value
    });
  }

  // トグルボタンのイベントハンドラ
  btnCaseSensitive.addEventListener('click', () => {
    isCaseSensitive = !isCaseSensitive;
    btnCaseSensitive.classList.toggle('active', isCaseSensitive);
    saveState();
  });

  btnWordMatch.addEventListener('click', () => {
    isWordMatch = !isWordMatch;
    btnWordMatch.classList.toggle('active', isWordMatch);
    saveState();
  });

  btnRegex.addEventListener('click', () => {
    isRegex = !isRegex;
    btnRegex.classList.toggle('active', isRegex);
    saveState();
  });

  // 詳細オプションの開閉
  btnToggleDetails.addEventListener('click', () => {
    const isHidden = detailsContainer.classList.toggle('hidden');
    detailsToggleIcon.classList.toggle('expanded', !isHidden);
  });

  // 検索実行・キャンセル
  function triggerSearch() {
    const pattern = searchInput.value.trim();
    if (!pattern) {
      // 空文字の場合は結果をクリア
      clearResults();
      statusContainer.textContent = '';
      statusContainer.className = 'status-container';
      return;
    }

    if (isSearching) {
      // 検索中ならキャンセルを実行
      vscode.postMessage({ command: 'cancel' });
      return;
    }

    saveState();

    vscode.postMessage({
      command: 'search',
      options: {
        pattern,
        isCaseSensitive,
        isWordMatch,
        isRegexp: isRegex,
        includePattern: includeInput.value.trim() || undefined,
        excludePattern: excludeInput.value.trim() || undefined
      }
    });
  }

  btnSearch.addEventListener('click', triggerSearch);

  // Enter キーで検索実行
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      triggerSearch();
    }
  });

  includeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      triggerSearch();
    }
  });

  excludeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      triggerSearch();
    }
  });

  // 結果クリア
  function clearResults() {
    resultsContainer.innerHTML = '';
    fileDomMap.clear();
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
    const isJa = i18n.autoEncodingBadge && i18n.autoEncodingBadge.includes('自動');
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
      case 'searchStart':
        isSearching = true;
        btnSearch.textContent = i18n.stopBtn;
        btnSearch.style.backgroundColor = 'var(--vscode-errorForeground, #d9534f)';
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
        btnSearch.textContent = i18n.searchBtn;
        btnSearch.style.backgroundColor = '';
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
        btnSearch.textContent = i18n.searchBtn;
        btnSearch.style.backgroundColor = '';
        statusContainer.className = 'status-container';
        statusContainer.textContent = i18n.searchCancelled;
        break;

      case 'searchError':
        isSearching = false;
        btnSearch.textContent = i18n.searchBtn;
        btnSearch.style.backgroundColor = '';
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
   * @param {Array<{start: number, end: number}>} submatches
   * @returns {string}
   */
  function buildHighlightedLineHtml(lineText, submatches) {
    if (!submatches || submatches.length === 0) {
      return escapeHtml(lineText);
    }

    let html = '';
    let lastIndex = 0;

    for (const sub of submatches) {
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
    return enc.toUpperCase();
  }

  /**
   * 単一のマッチアイテムDOM要素を生成する
   * @param {any} file
   * @param {any} match
   * @returns {HTMLElement}
   */
  function createMatchItemElement(file, match) {
    const matchItem = document.createElement('div');
    matchItem.className = 'match-item';
    matchItem.title = `${file.relativePath}:${match.lineNumber}:${match.columnNumber} [${formatEncodingName(match.encoding)}]`;

    const posSpan = document.createElement('span');
    posSpan.className = 'match-position';
    posSpan.textContent = `${match.lineNumber}:${match.columnNumber}`;

    const previewSpan = document.createElement('span');
    previewSpan.className = 'match-preview';
    previewSpan.innerHTML = buildHighlightedLineHtml(match.lineText, match.submatches);

    matchItem.appendChild(posSpan);
    matchItem.appendChild(previewSpan);

    // クリックでファイルを開いて文字コード自動適用＆ジャンプ
    matchItem.addEventListener('click', (e) => {
      e.stopPropagation();
      const matchLength = match.submatches && match.submatches[0]
        ? match.submatches[0].end - match.submatches[0].start
        : 1;

      vscode.postMessage({
        command: 'openFile',
        filePath: file.filePath,
        line: match.lineNumber,
        column: match.columnNumber,
        length: matchLength,
        encoding: match.encoding
      });
    });

    return matchItem;
  }

  /**
   * 検索結果のインクリメンタル（差分）レンダリング
   * 既存のDOM要素を再利用し、新たに追加されたファイル/マッチ行のみを追記
   * @param {Array<any>} fileResults
   */
  function renderIncrementalResults(fileResults) {
    const fragment = document.createDocumentFragment();

    for (const file of fileResults) {
      let fileDom = fileDomMap.get(file.filePath);

      if (!fileDom) {
        // 新規ファイルグループ要素の作成
        const fileGroup = document.createElement('div');
        fileGroup.className = 'file-group';

        const fileHeader = document.createElement('div');
        fileHeader.className = 'file-header';
        fileHeader.title = file.filePath;

        const toggleIcon = document.createElement('span');
        toggleIcon.className = 'file-toggle-icon expanded';
        toggleIcon.textContent = '▸';

        const filePathSpan = document.createElement('span');
        filePathSpan.className = 'file-path';
        filePathSpan.textContent = file.relativePath;

        const encTag = document.createElement('span');
        const primaryEnc = file.primaryEncoding || (file.matches[0] && file.matches[0].encoding) || 'euc-jp';
        encTag.className = `encoding-tag ${primaryEnc}`;
        encTag.textContent = formatEncodingName(primaryEnc);

        const badge = document.createElement('span');
        badge.className = 'match-count-badge';
        badge.textContent = file.matches.length.toString();

        fileHeader.appendChild(toggleIcon);
        fileHeader.appendChild(filePathSpan);
        fileHeader.appendChild(encTag);
        fileHeader.appendChild(badge);

        const matchList = document.createElement('div');
        matchList.className = 'match-list';

        // ヘッダークリックで開閉トグル
        fileHeader.addEventListener('click', () => {
          const isHidden = matchList.classList.toggle('hidden');
          toggleIcon.classList.toggle('expanded', !isHidden);
        });

        // 初回マッチ行の追加
        for (let i = 0; i < file.matches.length; i++) {
          const matchElem = createMatchItemElement(file, file.matches[i]);
          matchList.appendChild(matchElem);
        }

        fileGroup.appendChild(fileHeader);
        fileGroup.appendChild(matchList);

        fileDom = {
          container: fileGroup,
          matchList: matchList,
          badge: badge,
          renderedCount: file.matches.length
        };

        fileDomMap.set(file.filePath, fileDom);
        fragment.appendChild(fileGroup);
      } else {
        // 既存ファイルグループへの差分追記
        if (file.matches.length > fileDom.renderedCount) {
          const matchFragment = document.createDocumentFragment();
          for (let i = fileDom.renderedCount; i < file.matches.length; i++) {
            const matchElem = createMatchItemElement(file, file.matches[i]);
            matchFragment.appendChild(matchElem);
          }
          fileDom.matchList.appendChild(matchFragment);
          fileDom.renderedCount = file.matches.length;
          fileDom.badge.textContent = file.matches.length.toString();
        }
      }
    }

    if (fragment.childNodes.length > 0) {
      resultsContainer.appendChild(fragment);
    }
  }
})();
