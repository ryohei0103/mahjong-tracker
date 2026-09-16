  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  let currentUser = null;
  let currentSessionId = null;
  let currentGroupId = null;
  let state = defaultState();
  let historyList = [];
  let groupsList = [];
  let groupForm = { players: ['', '', '', ''], selfIndex: null };
  let authMode = 'signin';
  let saveDebounceTimer = null;
  let titleDebounceTimer = null;
  let flashTimer = null;
  let currentHistoryDetailId = null;
  let isEditingHistory = false;
  let editingBackup = null;

  function defaultState(){
    return {
      playerCount: 3,
      players: ['', '', '', ''],
      hanchans: [{ scores: [null, null, null, null] }],
      hanchanRate: 1,
      chipValue: 100,
      chips: [
        { plus: 0, minus: 0 }, { plus: 0, minus: 0 },
        { plus: 0, minus: 0 }, { plus: 0, minus: 0 }
      ],
      selfIndex: null,
      scoreMode: 'raw',
      returnScore: 35,
      umaEnabled: false,
      tobiEnabled: false,
      tobiAmount: 10
    };
  }

  function defaultTitle(){
    const d = new Date();
    return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} の記録`;
  }

  function normalizeState(){
    state = Object.assign(defaultState(), state);
    while(state.players.length < 4) state.players.push('');
    while(state.chips.length < 4) state.chips.push({ plus:0, minus:0 });
    if(!Array.isArray(state.hanchans) || state.hanchans.length === 0){
      state.hanchans = [{ scores:[null,null,null,null] }];
    }
    state.hanchans.forEach(h => {
      while(h.scores.length < 4) h.scores.push(null);
      if(!h.tobi) h.tobi = { bustedIdx: null, causerIdx: null };
      if(h.autoIdx === undefined) h.autoIdx = null;
    });
  }

  function defaultName(i){ return ['A','B','C','D','E','F','G','H'][i] || `P${i+1}`; }
  function playerDisplayName(i){
    const v = state.players[i];
    return (v && v.trim() !== '') ? v : defaultName(i);
  }
  function formatScore(n){
    if(n > 0) return '+' + n;
    if(n < 0) return '\u2212' + Math.abs(n);
    return '0';
  }
  function scoreClass(n){ return n > 0 ? 'score-plus' : (n < 0 ? 'score-minus' : ''); }
  function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, s => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[s]));
  }
  function attachSelectOnFocus(el){
    if(el) el.addEventListener('focus', () => el.select());
  }

  /* ---------- 保存状態の表示 ---------- */
  function flashSaved(){
    const el = document.getElementById('save-status');
    if(!el) return;
    el.textContent = '保存しました';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.textContent = ''; }, 1400);
  }
  function flashError(){
    const el = document.getElementById('save-status');
    if(!el) return;
    el.textContent = '保存に失敗しました';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.textContent = ''; }, 2200);
  }

  /* ---------- Supabase 保存 ---------- */
  async function doSaveState(){
    if(!currentUser || !currentSessionId) return;
    try{
      const { error } = await sb.from('game_sessions').update({ state }).eq('id', currentSessionId);
      if(error) throw error;
      flashSaved();
    }catch(e){ console.error('save failed', e); flashError(); }
  }
  function scheduleSave(){
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(doSaveState, 600);
  }

  /* ---------- 認証まわり ---------- */
  function showScreen(name){
    document.getElementById('loading-screen').style.display = name === 'loading' ? '' : 'none';
    document.getElementById('auth-screen').style.display = name === 'auth' ? '' : 'none';
    document.getElementById('main-app').style.display = name === 'app' ? '' : 'none';
  }
  function setAuthMessage(msg, type){
    const el = document.getElementById('auth-message');
    el.textContent = msg || '';
    el.className = 'auth-message' + (type ? ' ' + type : '');
  }
  function updateAuthModeUI(){
    document.getElementById('auth-title').textContent = authMode === 'signin' ? 'ログイン' : '新規登録';
    document.getElementById('auth-submit-btn').textContent = authMode === 'signin' ? 'ログイン' : '登録する';
    document.getElementById('auth-toggle-label').textContent = authMode === 'signin' ? 'アカウントをお持ちでない方は' : 'すでにアカウントをお持ちの方は';
    document.getElementById('auth-toggle-btn').textContent = authMode === 'signin' ? '新規登録' : 'ログインはこちら';
    setAuthMessage('', '');
  }

  async function handleAuthSubmit(){
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    if(!email || !password){ setAuthMessage('メールアドレスとパスワードを入力してください', 'error'); return; }
    const btn = document.getElementById('auth-submit-btn');
    btn.disabled = true;
    setAuthMessage('処理中…', '');
    try{
      if(authMode === 'signin'){
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if(error) throw error;
      }else{
        const { data, error } = await sb.auth.signUp({ email, password });
        if(error) throw error;
        if(data.user && !data.session){
          setAuthMessage('確認メールを送信しました。メール内のリンクを開いてログインしてください。', 'info');
        }
      }
    }catch(e){
      setAuthMessage(e.message || 'エラーが発生しました', 'error');
    }finally{
      btn.disabled = false;
    }
  }

  async function handleSignOut(){
    await sb.auth.signOut();
  }

  /* ---------- セッション読み込み ---------- */
  async function loadCurrentSession(){
    const { data, error } = await sb.from('game_sessions')
      .select('*')
      .eq('user_id', currentUser.id)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(1);

    if(error){ console.error(error); state = defaultState(); currentSessionId = null; return; }

    if(data && data.length > 0){
      const row = data[0];
      currentSessionId = row.id;
      currentGroupId = row.group_id || null;
      state = row.state || defaultState();
      normalizeState();
      document.getElementById('session-title-input').value = row.title || defaultTitle();
    }else{
      const initial = defaultState();
      const { data: inserted, error: insertErr } = await sb.from('game_sessions')
        .insert({ user_id: currentUser.id, title: defaultTitle(), state: initial, active: true })
        .select().single();
      if(insertErr){ console.error(insertErr); state = initial; currentSessionId = null; return; }
      currentSessionId = inserted.id;
      currentGroupId = null;
      state = initial;
      document.getElementById('session-title-input').value = inserted.title;
    }
  }

  async function loadHistory(){
    const { data, error } = await sb.from('game_sessions')
      .select('id,title,state,created_at')
      .eq('user_id', currentUser.id)
      .eq('active', false)
      .order('created_at', { ascending: false })
      .limit(30);
    if(error){ console.error(error); historyList = []; return; }
    historyList = data || [];
  }

  async function startNewSession(){
    if(isEditingHistory) await exitEditingHistory();
    if(!confirm('現在の記録を保存して、新しい記録を始めますか？')) return;
    clearTimeout(saveDebounceTimer);
    await doSaveState();
    if(currentSessionId){
      await sb.from('game_sessions').update({ active: false }).eq('id', currentSessionId);
    }
    const initial = defaultState();
    const { data, error } = await sb.from('game_sessions')
      .insert({ user_id: currentUser.id, title: defaultTitle(), state: initial, active: true })
      .select().single();
    if(error){ alert('新しい記録の作成に失敗しました'); return; }
    currentSessionId = data.id;
    currentGroupId = null;
    state = initial;
    document.getElementById('session-title-input').value = data.title;
    renderPlayerSetup();
    renderHanchanTable();
    renderChipSection();
    renderFinalResults();
    renderGroupSelect();
    await loadHistory();
    renderHistory();
    renderCareerStats();
  }

  async function deleteHistoryItem(id){
    if(!confirm('この記録を削除します。元に戻せません。よろしいですか？')) return;
    const { error } = await sb.from('game_sessions').delete().eq('id', id);
    if(error){ alert('削除に失敗しました'); return; }
    await loadHistory();
    renderHistory();
    renderCareerStats();
  }

  /* ---------- 設定パネル ---------- */
  function renderPlayerSetup(){
    const grid = document.getElementById('name-grid');
    grid.innerHTML = '';
    for(let i = 0; i < state.playerCount; i++){
      const field = document.createElement('div');
      field.className = 'name-field';
      const label = document.createElement('label');
      label.textContent = `プレイヤー${i+1}`;
      const row = document.createElement('div');
      row.className = 'name-input-row';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = state.players[i] || '';
      input.placeholder = defaultName(i);
      input.addEventListener('input', e => handleNameInput(i, e.target.value));
      const selfBtn = document.createElement('button');
      selfBtn.type = 'button';
      selfBtn.className = 'self-btn' + (state.selfIndex === i ? ' active' : '');
      selfBtn.textContent = '自分';
      selfBtn.setAttribute('aria-label', 'このプレイヤーを自分として設定');
      selfBtn.addEventListener('click', () => setSelfPlayer(i));
      row.appendChild(input);
      row.appendChild(selfBtn);
      field.appendChild(label);
      field.appendChild(row);
      grid.appendChild(field);
    }
    document.getElementById('btn-3p').classList.toggle('active', state.playerCount === 3);
    document.getElementById('btn-4p').classList.toggle('active', state.playerCount === 4);
  }

  function handleNameInput(i, value){
    state.players[i] = value;
    document.querySelectorAll(`[data-name-idx="${i}"]`).forEach(el => {
      el.textContent = playerDisplayName(i);
    });
    renderFinalResults();
    scheduleSave();
  }

  function setPlayerCount(n){
    if(state.playerCount === n) return;
    state.playerCount = n;
    renderPlayerSetup();
    renderHanchanTable();
    renderChipSection();
    renderFinalResults();
    renderCareerStats();
    scheduleSave();
  }

  function setSelfPlayer(i){
    state.selfIndex = (state.selfIndex === i) ? null : i;
    renderPlayerSetup();
    renderCareerStats();
    scheduleSave();
  }

  /* ---------- 半荘テーブル ---------- */
  function renderHanchanTable(){
    document.querySelectorAll('.score-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.scoreMode === state.scoreMode);
    });
    document.getElementById('return-score-row').style.display = state.scoreMode === 'raw' ? '' : 'none';
    document.querySelectorAll('.return-score-btn').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.returnScore) === state.returnScore);
    });
    document.querySelectorAll('.uma-btn').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.uma === 'on') === state.umaEnabled);
    });
    document.querySelectorAll('.tobi-btn').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.tobi === 'on') === state.tobiEnabled);
    });
    document.getElementById('tobi-amount-row').style.display = state.tobiEnabled ? '' : 'none';
    document.querySelectorAll('.tobi-amount-btn').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.tobiAmount) === state.tobiAmount);
    });

    let theadHtml = '<tr><th>半荘</th>';
    for(let i = 0; i < state.playerCount; i++){
      theadHtml += `<th data-name-idx="${i}">${escapeHtml(playerDisplayName(i))}</th>`;
    }
    theadHtml += '<th>判定</th><th></th></tr>';
    document.querySelector('#hanchan-table thead').innerHTML = theadHtml;

    const isRaw = state.scoreMode === 'raw';
    let rows = '';
    state.hanchans.forEach((h, rowIdx) => {
      rows += `<tr><th>${rowIdx+1}</th>`;
      for(let i = 0; i < state.playerCount; i++){
        const val = h.scores[i];
        if(isRaw){
          const rawVal = (val === null || val === undefined) ? '' : ((val + state.returnScore) * 1000);
          const diffText = (val === null || val === undefined) ? '' : formatScore(val);
          rows += `<td><div class="score-cell score-cell-raw">
            <input type="text" inputmode="text" pattern="-?[0-9]*" value="${rawVal}" placeholder="点数" data-row="${rowIdx}" data-player="${i}" class="score-input raw-score-input">
            <span class="raw-diff-display ${val ? scoreClass(val) : ''}" id="raw-diff-${rowIdx}-${i}">${diffText}</span>
          </div></td>`;
        }else{
          const isNeg = (val !== null && val !== undefined && val < 0);
          const abs = (val === null || val === undefined) ? '' : Math.abs(val);
          const signChar = isNeg ? '\u2212' : '+';
          rows += `<td><div class="score-cell">
            <button type="button" class="sign-btn${isNeg ? ' sign-minus' : ''}" data-sign="${isNeg ? '-' : '+'}" data-row="${rowIdx}" data-player="${i}" aria-label="符号を切り替え">${signChar}</button>
            <input type="text" inputmode="numeric" pattern="[0-9]*" value="${abs}" data-row="${rowIdx}" data-player="${i}" class="score-input">
          </div></td>`;
        }
      }
      rows += `<td class="status-cell" id="status-${rowIdx}"></td>`;
      rows += `<td><button class="del-btn" data-del="${rowIdx}" type="button" aria-label="この半荘を削除">✕</button></td></tr>`;

      if(state.tobiEnabled){
        const t = h.tobi || { bustedIdx: null, causerIdx: null };
        let bustedOptions = '<option value="">飛んだ人</option>';
        let causerOptions = '<option value="">飛ばした人</option>';
        for(let i = 0; i < state.playerCount; i++){
          const nm = escapeHtml(playerDisplayName(i));
          bustedOptions += `<option value="${i}"${t.bustedIdx === i ? ' selected' : ''}>${nm}</option>`;
          causerOptions += `<option value="${i}"${t.causerIdx === i ? ' selected' : ''}>${nm}</option>`;
        }
        rows += `<tr class="tobi-row"><td colspan="${state.playerCount + 2}">
          <div class="tobi-select-row">
            <span class="tobi-label">トビ</span>
            <select class="tobi-busted-select" data-row="${rowIdx}">${bustedOptions}</select>
            <select class="tobi-causer-select" data-row="${rowIdx}">${causerOptions}</select>
          </div>
        </td></tr>`;
      }
    });
    document.querySelector('#hanchan-table tbody').innerHTML = rows;

    function updateCellDisplay(r, p){
      const val = state.hanchans[r].scores[p];
      if(isRaw){
        const inp = document.querySelector(`.raw-score-input[data-row="${r}"][data-player="${p}"]`);
        if(inp) inp.value = (val === null || val === undefined) ? '' : ((val + state.returnScore) * 1000);
        const diffEl = document.getElementById(`raw-diff-${r}-${p}`);
        if(diffEl){
          diffEl.textContent = (val === null || val === undefined) ? '' : formatScore(val);
          diffEl.className = 'raw-diff-display' + (val ? ' ' + scoreClass(val) : '');
        }
      }else{
        const inp = document.querySelector(`.score-input[data-row="${r}"][data-player="${p}"]`);
        const btn = document.querySelector(`.sign-btn[data-row="${r}"][data-player="${p}"]`);
        if(inp && btn){
          const isNeg = val !== null && val !== undefined && val < 0;
          inp.value = (val === null || val === undefined) ? '' : Math.abs(val);
          btn.dataset.sign = isNeg ? '-' : '+';
          btn.textContent = isNeg ? '\u2212' : '+';
          btn.classList.toggle('sign-minus', isNeg);
        }
      }
    }

    function autoBalanceRow(r){
      const h = state.hanchans[r];
      const n = state.playerCount;
      const emptyIndices = [];
      let sum = 0;
      for(let i = 0; i < n; i++){
        const v = h.scores[i];
        if(v === null || v === undefined) emptyIndices.push(i);
        else sum += v;
      }
      if(emptyIndices.length === 1){
        const idx = emptyIndices[0];
        h.scores[idx] = -sum;
        return idx;
      }
      return null;
    }

    function afterScoreChange(r, editedIdx){
      const h = state.hanchans[r];
      if(h.autoIdx !== null && h.autoIdx !== undefined && h.autoIdx !== editedIdx){
        h.scores[h.autoIdx] = null;
        h.autoIdx = null;
      }
      const autoIdx = autoBalanceRow(r);
      h.autoIdx = autoIdx;
      if(autoIdx !== null) updateCellDisplay(r, autoIdx);
      updateRowStatus(r);
      updateFooter();
      renderFinalResults();
      scheduleSave();
    }

    if(isRaw){
      document.querySelectorAll('.raw-score-input').forEach(inp => {
        inp.addEventListener('input', e => {
          e.target.value = e.target.value.replace(/[^0-9-]/g, '').replace(/(?!^)-/g, '');
          const r = Number(e.target.dataset.row), p = Number(e.target.dataset.player);
          const rawStr = e.target.value;
          let val;
          if(rawStr === '' || rawStr === '-'){ val = null; }
          else { val = Math.round(Number(rawStr) / 1000 - state.returnScore); }
          state.hanchans[r].scores[p] = val;
          const diffEl = document.getElementById(`raw-diff-${r}-${p}`);
          if(diffEl){
            diffEl.textContent = val === null ? '' : formatScore(val);
            diffEl.className = 'raw-diff-display' + (val ? ' ' + scoreClass(val) : '');
          }
          afterScoreChange(r, p);
        });
      });
    }else{
      document.querySelectorAll('.score-input').forEach(inp => {
        inp.addEventListener('input', e => {
          e.target.value = e.target.value.replace(/[^0-9]/g, '');
          const r = Number(e.target.dataset.row), p = Number(e.target.dataset.player);
          const btn = document.querySelector(`.sign-btn[data-row="${r}"][data-player="${p}"]`);
          if(!btn) return;
          const magStr = e.target.value;
          let val;
          if(magStr === ''){ val = null; }
          else { const mag = Number(magStr); val = (btn.dataset.sign === '-') ? -mag : mag; }
          state.hanchans[r].scores[p] = val;
          afterScoreChange(r, p);
        });
      });

      document.querySelectorAll('.sign-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          const b = e.currentTarget;
          const newSign = b.dataset.sign === '-' ? '+' : '-';
          b.dataset.sign = newSign;
          b.textContent = newSign === '-' ? '\u2212' : '+';
          b.classList.toggle('sign-minus', newSign === '-');
          const r = Number(b.dataset.row), p = Number(b.dataset.player);
          const inp = document.querySelector(`.score-input[data-row="${r}"][data-player="${p}"]`);
          if(!inp) return;
          const magStr = inp.value;
          let val;
          if(magStr === ''){ val = null; }
          else { const mag = Number(magStr); val = (b.dataset.sign === '-') ? -mag : mag; }
          state.hanchans[r].scores[p] = val;
          afterScoreChange(r, p);
        });
      });
    }

    if(state.tobiEnabled){
      document.querySelectorAll('.tobi-busted-select').forEach(sel => {
        sel.addEventListener('change', e => {
          const r = Number(e.target.dataset.row);
          if(!state.hanchans[r].tobi) state.hanchans[r].tobi = { bustedIdx: null, causerIdx: null };
          state.hanchans[r].tobi.bustedIdx = e.target.value === '' ? null : Number(e.target.value);
          renderFinalResults();
          scheduleSave();
        });
      });
      document.querySelectorAll('.tobi-causer-select').forEach(sel => {
        sel.addEventListener('change', e => {
          const r = Number(e.target.dataset.row);
          if(!state.hanchans[r].tobi) state.hanchans[r].tobi = { bustedIdx: null, causerIdx: null };
          state.hanchans[r].tobi.causerIdx = e.target.value === '' ? null : Number(e.target.value);
          renderFinalResults();
          scheduleSave();
        });
      });
    }

    document.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', e => {
        const idx = Number(e.currentTarget.dataset.del);
        state.hanchans.splice(idx, 1);
        if(state.hanchans.length === 0) state.hanchans.push({ scores:[null,null,null,null], tobi:{ bustedIdx:null, causerIdx:null }, autoIdx:null });
        renderHanchanTable();
        renderFinalResults();
        scheduleSave();
      });
    });

    updateFooter();
    state.hanchans.forEach((_, idx) => updateRowStatus(idx));
  }

  function setUmaEnabled(on){
    if(state.umaEnabled === on) return;
    state.umaEnabled = on;
    renderHanchanTable();
    renderFinalResults();
    scheduleSave();
  }

  function setTobiEnabled(on){
    if(state.tobiEnabled === on) return;
    state.tobiEnabled = on;
    renderHanchanTable();
    renderFinalResults();
    scheduleSave();
  }

  function setTobiAmount(val){
    if(state.tobiAmount === val) return;
    state.tobiAmount = val;
    renderHanchanTable();
    renderFinalResults();
    scheduleSave();
  }

  function updateRowStatus(rowIdx){
    const h = state.hanchans[rowIdx];
    if(!h) return;
    const scores = h.scores.slice(0, state.playerCount);
    const filled = scores.every(s => s !== null && s !== undefined);
    const cell = document.getElementById(`status-${rowIdx}`);
    if(!cell) return;
    if(!filled){ cell.textContent = ''; cell.className = 'status-cell'; return; }
    const sum = scores.reduce((a,b) => a+b, 0);
    if(sum === 0){ cell.textContent = '✓'; cell.className = 'status-cell status-ok'; }
    else { cell.textContent = formatScore(sum); cell.className = 'status-cell status-warn'; }
  }

  function updateFooter(){
    const totals = new Array(state.playerCount).fill(0);
    state.hanchans.forEach(h => {
      for(let i = 0; i < state.playerCount; i++){ totals[i] += (h.scores[i] || 0); }
    });
    let html = '<tr><th>合計</th>';
    totals.forEach(t => { html += `<td class="${scoreClass(t)}">${formatScore(t)}</td>`; });
    html += '<td></td><td></td></tr>';
    document.querySelector('#hanchan-table tfoot').innerHTML = html;
  }

  function addHanchan(){
    state.hanchans.push({ scores:[null,null,null,null], tobi:{ bustedIdx:null, causerIdx:null }, autoIdx:null });
    renderHanchanTable();
    renderFinalResults();
    scheduleSave();
  }

  function setScoreMode(mode){
    if(state.scoreMode === mode) return;
    state.scoreMode = mode;
    renderHanchanTable();
    scheduleSave();
  }

  function setReturnScore(val){
    if(state.returnScore === val) return;
    state.returnScore = val;
    renderHanchanTable();
    scheduleSave();
  }

  /* ---------- チップ ---------- */
  function renderChipSection(){
    let html = '';
    for(let i = 0; i < state.playerCount; i++){
      const c = state.chips[i];
      html += `<div class="chip-row">
        <span class="cname" data-name-idx="${i}">${escapeHtml(playerDisplayName(i))}</span>
        <div class="chip-input-group"><label>＋枚</label><input type="number" min="0" inputmode="numeric" value="${c.plus}" data-chip-player="${i}" data-chip-field="plus"></div>
        <div class="chip-input-group"><label>－枚</label><input type="number" min="0" inputmode="numeric" value="${c.minus}" data-chip-player="${i}" data-chip-field="minus"></div>
        <span class="chip-total" id="chip-total-${i}"></span>
      </div>`;
    }
    document.getElementById('chip-rows').innerHTML = html;
    document.getElementById('chip-value-input').value = state.chipValue;

    document.querySelectorAll('[data-chip-player]').forEach(inp => {
      attachSelectOnFocus(inp);
      inp.addEventListener('input', e => {
        const p = Number(e.target.dataset.chipPlayer), f = e.target.dataset.chipField;
        const raw = e.target.value;
        state.chips[p][f] = raw === '' ? 0 : Math.max(0, Number(raw));
        updateChipTotal(p);
        renderFinalResults();
        scheduleSave();
      });
    });

    for(let i = 0; i < state.playerCount; i++) updateChipTotal(i);
  }

  function updateChipTotal(i){
    const c = state.chips[i];
    if(!c) return;
    const total = (c.plus - c.minus) * state.chipValue;
    const el = document.getElementById(`chip-total-${i}`);
    if(el){ el.textContent = formatScore(total); el.className = 'chip-total ' + scoreClass(total); }
  }

  /* ---------- 最終結果 ---------- */
  function umaTable(playerCount){
    return playerCount === 3 ? [10, 0, -10] : [20, 10, -10, -20];
  }

  function computeHanchanBonus(s, h){
    const n = s.playerCount;
    const bonus = new Array(n).fill(0);
    if(s.umaEnabled){
      const scores = h.scores.slice(0, n);
      if(scores.every(v => v !== null && v !== undefined)){
        const table = umaTable(n);
        const order = scores.map((v, i) => ({ i, v })).sort((a, b) => b.v - a.v);
        order.forEach((o, rank) => { bonus[o.i] += table[rank]; });
      }
    }
    if(s.tobiEnabled && h.tobi){
      const { bustedIdx, causerIdx } = h.tobi;
      if(bustedIdx !== null && bustedIdx !== undefined && causerIdx !== null && causerIdx !== undefined &&
         bustedIdx !== causerIdx && bustedIdx < n && causerIdx < n){
        bonus[bustedIdx] -= (s.tobiAmount || 0);
        bonus[causerIdx] += (s.tobiAmount || 0);
      }
    }
    return bonus;
  }

  function computeTotals(s){
    const n = s.playerCount;
    const hTotals = new Array(n).fill(0);
    (s.hanchans || []).forEach(h => {
      const bonus = computeHanchanBonus(s, h);
      for(let i = 0; i < n; i++){
        hTotals[i] += (h.scores[i] || 0) + (bonus[i] || 0);
      }
    });
    const totals = [];
    for(let i = 0; i < n; i++){
      const hTotal = hTotals[i];
      const hYen = Math.round(hTotal * (s.hanchanRate || 0));
      const c = (s.chips && s.chips[i]) || { plus:0, minus:0 };
      const chipTotal = (c.plus - c.minus) * (s.chipValue || 0);
      const name = (s.players && s.players[i] && s.players[i].trim() !== '') ? s.players[i] : defaultName(i);
      totals.push({ idx: i, name, hTotal, hYen, chipTotal, sum: hYen + chipTotal });
    }
    totals.sort((a,b) => b.hTotal - a.hTotal);
    return totals;
  }

  function renderFinalResults(){
    const totals = computeTotals(state);
    let html = '';
    totals.forEach((t, rank) => {
      html += `<div class="result-item ${rank === 0 ? 'rank-1' : ''}">
        <div class="result-top">
          <div class="rank-badge">${rank+1}位</div>
          <div class="result-main">
            <div class="result-name">${escapeHtml(t.name)}</div>
          </div>
          <div class="result-stats">
            <div class="result-stat">
              <div class="stat-label">半荘</div>
              <div class="stat-value ${scoreClass(t.hYen)}">${formatScore(t.hYen)}円</div>
              <div class="stat-sub">${formatScore(t.hTotal)}点</div>
            </div>
            <div class="result-stat">
              <div class="stat-label">チップ</div>
              <div class="stat-value ${scoreClass(t.chipTotal)}">${formatScore(t.chipTotal)}</div>
            </div>
          </div>
        </div>
        <div class="result-total-row">
          <span class="total-label">合計</span>
          <span class="total-value ${scoreClass(t.sum)}">${formatScore(t.sum)}</span>
        </div>
      </div>`;
    });
    document.getElementById('result-list').innerHTML = html;
  }

  /* ---------- 通算成績 ---------- */
  function sessionHasData(s){
    return (s.hanchans || []).some(h => (h.scores || []).some(v => v !== null && v !== undefined));
  }

  function computeCareerStats(){
    const records = [];
    if(sessionHasData(state) && state.selfIndex !== null && state.selfIndex !== undefined && state.selfIndex < state.playerCount){
      records.push(state);
    }
    historyList.forEach(row => {
      const s = Object.assign(defaultState(), row.state || {});
      if(sessionHasData(s) && s.selfIndex !== null && s.selfIndex !== undefined && s.selfIndex < s.playerCount){
        records.push(s);
      }
    });
    if(records.length === 0) return null;

    let totalSum = 0, rankSum = 0, firstCount = 0;
    records.forEach(s => {
      const totals = computeTotals(s);
      const rank = totals.findIndex(t => t.idx === s.selfIndex);
      totalSum += totals[rank].sum;
      rankSum += rank + 1;
      if(rank === 0) firstCount++;
    });
    return {
      count: records.length,
      totalSum,
      avgRank: rankSum / records.length,
      firstCount
    };
  }

  function renderCareerStats(){
    const el = document.getElementById('career-stats');
    if(!el) return;
    const stats = computeCareerStats();
    if(!stats){
      el.innerHTML = '<p class="hint">卓の設定でプレイヤー名の横の「自分」ボタンを選ぶと、通算成績が集計されます。</p>';
      return;
    }
    el.innerHTML = `
      <div class="career-grid">
        <div class="career-item">
          <div class="career-label">記録数</div>
          <div class="career-value">${stats.count}</div>
        </div>
        <div class="career-item">
          <div class="career-label">通算収支</div>
          <div class="career-value ${scoreClass(stats.totalSum)}">${formatScore(stats.totalSum)}</div>
        </div>
        <div class="career-item">
          <div class="career-label">平均順位</div>
          <div class="career-value">${stats.avgRank.toFixed(2)}位</div>
        </div>
        <div class="career-item">
          <div class="career-label">1位回数</div>
          <div class="career-value">${stats.firstCount}回</div>
        </div>
      </div>
    `;
  }

  /* ---------- グループ ---------- */
  async function loadGroups(){
    const { data, error } = await sb.from('groups')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });
    if(error){ console.error(error); groupsList = []; return; }
    groupsList = data || [];
  }

  function renderGroups(){
    const container = document.getElementById('group-list');
    if(!groupsList || groupsList.length === 0){
      container.innerHTML = '<p class="hint">まだグループがありません。</p>';
    }else{
      let html = '';
      groupsList.forEach(g => {
        const members = (g.players || []).map(n => escapeHtml(n || '')).join('・');
        html += `<div class="history-item" data-group-open="${g.id}">
          <div class="history-main">
            <div class="history-title">${escapeHtml(g.name)}</div>
            <div class="history-date">${(g.players || []).length}人登録・${members}</div>
          </div>
          <button class="del-btn" data-group-del="${g.id}" type="button" aria-label="削除">✕</button>
        </div>`;
      });
      container.innerHTML = html;
      document.querySelectorAll('[data-group-del]').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          deleteGroup(e.currentTarget.dataset.groupDel);
        });
      });
      document.querySelectorAll('[data-group-open]').forEach(item => {
        item.addEventListener('click', e => openGroupDetail(e.currentTarget.dataset.groupOpen));
      });
    }
    renderGroupSelect();
  }

  function renderGroupSelect(){
    const select = document.getElementById('group-select');
    if(!select) return;
    let html = '<option value="">グループを選択…</option>';
    groupsList.forEach(g => {
      html += `<option value="${g.id}">${escapeHtml(g.name)}</option>`;
    });
    select.innerHTML = html;
    select.value = currentGroupId || '';
  }

  function onGroupSelectChange(groupId){
    if(!groupId){
      currentGroupId = null;
      persistGroupId();
      return;
    }
    const group = groupsList.find(g => String(g.id) === String(groupId));
    if(!group) return;
    if((group.players || []).length <= state.playerCount){
      applyGroupWithMembers(group, group.players.map((_, i) => i));
    }else{
      openGroupPlayerPicker(group);
    }
  }

  async function applyGroupWithMembers(group, indices){
    currentGroupId = group.id;
    const names = indices.map(i => group.players[i] || '');
    for(let i = 0; i < 4; i++){ state.players[i] = names[i] || ''; }
    const selfPos = indices.indexOf(group.self_index);
    state.selfIndex = selfPos >= 0 ? selfPos : null;
    renderPlayerSetup();
    renderHanchanTable();
    renderChipSection();
    renderFinalResults();
    renderCareerStats();
    renderGroupSelect();
    await persistGroupId();
    scheduleSave();
  }

  async function persistGroupId(){
    if(!currentSessionId) return;
    await sb.from('game_sessions').update({ group_id: currentGroupId }).eq('id', currentSessionId);
  }

  async function deleteGroup(id){
    if(!confirm('このグループを削除します。よろしいですか？（作成済みの記録は削除されません）')) return;
    const { error } = await sb.from('groups').delete().eq('id', id);
    if(error){ alert('削除に失敗しました'); return; }
    if(currentGroupId === id) currentGroupId = null;
    await loadGroups();
    renderGroups();
  }

  /* ---------- グループの参加者選択 ---------- */
  let pendingGroupForPicker = null;
  let pickedMemberIndices = [];

  function openGroupPlayerPicker(group){
    pendingGroupForPicker = group;
    pickedMemberIndices = [];
    renderGroupPickerList();
    document.getElementById('group-player-picker-overlay').style.display = 'flex';
  }

  function closeGroupPlayerPicker(){
    document.getElementById('group-player-picker-overlay').style.display = 'none';
    pendingGroupForPicker = null;
    document.getElementById('group-select').value = currentGroupId || '';
  }

  function renderGroupPickerList(){
    const group = pendingGroupForPicker;
    const need = state.playerCount;
    const remain = need - pickedMemberIndices.length;
    document.getElementById('group-picker-hint').textContent =
      remain > 0 ? `今日参加する${need}人を選んでください（あと${remain}人）` : `${need}人選択しました`;
    let html = '';
    group.players.forEach((name, i) => {
      const checked = pickedMemberIndices.includes(i);
      const label = (name && name.trim() !== '') ? name : defaultName(i);
      html += `<button type="button" class="group-picker-item${checked ? ' active' : ''}" data-idx="${i}">${escapeHtml(label)}${group.self_index === i ? '（自分）' : ''}</button>`;
    });
    document.getElementById('group-picker-list').innerHTML = html;
    document.querySelectorAll('.group-picker-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        const pos = pickedMemberIndices.indexOf(idx);
        if(pos >= 0){
          pickedMemberIndices.splice(pos, 1);
        }else{
          if(pickedMemberIndices.length >= need) return;
          pickedMemberIndices.push(idx);
        }
        renderGroupPickerList();
      });
    });
    const applyBtn = document.getElementById('group-picker-apply-btn');
    applyBtn.disabled = pickedMemberIndices.length !== need;
  }

  function confirmGroupPicker(){
    if(!pendingGroupForPicker || pickedMemberIndices.length !== state.playerCount) return;
    const group = pendingGroupForPicker;
    const indices = pickedMemberIndices.slice();
    applyGroupWithMembers(group, indices);
    document.getElementById('group-player-picker-overlay').style.display = 'none';
    pendingGroupForPicker = null;
  }

  /* ---------- グループ作成フォーム ---------- */
  function renderGroupNameGrid(){
    const grid = document.getElementById('group-name-grid');
    grid.innerHTML = '';
    groupForm.players.forEach((name, i) => {
      const field = document.createElement('div');
      field.className = 'name-field';
      const label = document.createElement('label');
      label.textContent = `メンバー${i+1}`;
      const row = document.createElement('div');
      row.className = 'name-input-row';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = name || '';
      input.placeholder = defaultName(i);
      input.addEventListener('input', e => { groupForm.players[i] = e.target.value; });
      const selfBtn = document.createElement('button');
      selfBtn.type = 'button';
      selfBtn.className = 'self-btn' + (groupForm.selfIndex === i ? ' active' : '');
      selfBtn.textContent = '自分';
      selfBtn.addEventListener('click', () => {
        groupForm.selfIndex = (groupForm.selfIndex === i) ? null : i;
        renderGroupNameGrid();
      });
      row.appendChild(input);
      row.appendChild(selfBtn);
      if(groupForm.players.length > 3){
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-member-btn';
        removeBtn.textContent = '−';
        removeBtn.setAttribute('aria-label', 'このメンバーを削除');
        removeBtn.addEventListener('click', () => {
          groupForm.players.splice(i, 1);
          if(groupForm.selfIndex === i) groupForm.selfIndex = null;
          else if(groupForm.selfIndex !== null && groupForm.selfIndex > i) groupForm.selfIndex -= 1;
          renderGroupNameGrid();
        });
        row.appendChild(removeBtn);
      }
      field.appendChild(label);
      field.appendChild(row);
      grid.appendChild(field);
    });
  }

  function addGroupMember(){
    if(groupForm.players.length >= 8) return;
    groupForm.players.push('');
    renderGroupNameGrid();
  }

  function openGroupForm(){
    groupForm = { players: ['', '', '', ''], selfIndex: null };
    document.getElementById('group-name-input').value = '';
    renderGroupNameGrid();
    document.getElementById('group-form-overlay').style.display = 'flex';
  }

  function closeGroupForm(){
    document.getElementById('group-form-overlay').style.display = 'none';
  }

  async function saveGroup(){
    const name = document.getElementById('group-name-input').value.trim();
    if(!name){ alert('グループ名を入力してください'); return; }
    const selfName = (groupForm.selfIndex !== null) ? (groupForm.players[groupForm.selfIndex] || '').trim() : '';
    const players = groupForm.players.map(p => (p || '').trim()).filter(p => p !== '');
    if(players.length < 3){ alert('メンバーを3人以上入力してください'); return; }
    const selfIndex = selfName !== '' ? players.indexOf(selfName) : -1;
    const { error } = await sb.from('groups').insert({
      user_id: currentUser.id,
      name,
      player_count: players.length,
      players,
      self_index: selfIndex >= 0 ? selfIndex : null
    });
    if(error){ alert('グループの作成に失敗しました'); return; }
    closeGroupForm();
    await loadGroups();
    renderGroups();
  }

  /* ---------- グループの成績 ---------- */
  function renderGroupStatsBody(group, sessions){
    if(sessions.length === 0){
      return '<section class="panel"><p class="hint">このグループにはまだ記録がありません。卓の設定で「グループから読み込む」を選んで記録を作成してください。</p></section>';
    }
    const statsByName = new Map();
    sessions.forEach(s => {
      const totals = computeTotals(s);
      totals.forEach((t, rank) => {
        if(!statsByName.has(t.name)){
          statsByName.set(t.name, { name: t.name, count: 0, totalSum: 0, rankSum: 0 });
        }
        const rec = statsByName.get(t.name);
        rec.count += 1;
        rec.totalSum += t.sum;
        rec.rankSum += (rank + 1);
      });
    });
    const selfName = (group.self_index !== null && group.self_index !== undefined)
      ? (group.players[group.self_index] || '').trim() : '';
    const stats = Array.from(statsByName.values()).map(r => ({
      name: r.name,
      isSelf: selfName !== '' && selfName === r.name,
      count: r.count,
      totalSum: r.totalSum,
      avgRank: r.count ? r.rankSum / r.count : null
    }));
    stats.sort((a, b) => b.totalSum - a.totalSum);

    let html = '<div class="result-list">';
    stats.forEach((t, rank) => {
      html += `<div class="result-item ${rank === 0 ? 'rank-1' : ''}">
        <div class="result-top">
          <div class="rank-badge">${rank+1}位</div>
          <div class="result-main"><div class="result-name">${escapeHtml(t.name)}${t.isSelf ? '（自分）' : ''}</div></div>
          <div class="result-stats">
            <div class="result-stat">
              <div class="stat-label">記録数</div>
              <div class="stat-value">${t.count}</div>
            </div>
            <div class="result-stat">
              <div class="stat-label">平均順位</div>
              <div class="stat-value">${t.avgRank !== null ? t.avgRank.toFixed(2) + '位' : '-'}</div>
            </div>
          </div>
        </div>
        <div class="result-total-row">
          <span class="total-label">通算収支</span>
          <span class="total-value ${scoreClass(t.totalSum)}">${formatScore(t.totalSum)}</span>
        </div>
      </div>`;
    });
    html += '</div>';
    return `<section class="panel">${html}</section>`;
  }

  async function openGroupDetail(id){
    const group = groupsList.find(g => String(g.id) === String(id));
    if(!group) return;
    document.getElementById('group-detail-title-text').textContent = group.name;
    document.getElementById('group-detail-body').innerHTML = '<p class="hint">読み込み中…</p>';
    document.getElementById('group-detail-overlay').style.display = 'flex';

    const { data, error } = await sb.from('game_sessions')
      .select('state')
      .eq('user_id', currentUser.id)
      .eq('group_id', group.id);
    if(error){
      document.getElementById('group-detail-body').innerHTML = '<p class="hint">読み込みに失敗しました。</p>';
      return;
    }
    const sessions = (data || [])
      .map(row => Object.assign(defaultState(), row.state || {}))
      .filter(sessionHasData);
    document.getElementById('group-detail-body').innerHTML = renderGroupStatsBody(group, sessions);
  }

  function closeGroupDetail(){
    document.getElementById('group-detail-overlay').style.display = 'none';
  }

  /* ---------- 過去の記録 ---------- */
  function renderHistory(){
    const container = document.getElementById('history-list');
    if(!historyList || historyList.length === 0){
      container.innerHTML = '<p class="hint">まだ保存された記録はありません。</p>';
      return;
    }
    let html = '';
    historyList.forEach(row => {
      const s = Object.assign(defaultState(), row.state || {});
      const totals = computeTotals(s);
      const top = totals[0];
      const d = new Date(row.created_at);
      const dateStr = `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
      html += `<div class="history-item" data-history-open="${row.id}">
        <div class="history-main">
          <div class="history-title">${escapeHtml(row.title || '記録')}</div>
          <div class="history-date">${dateStr}</div>
        </div>
        <div class="history-top ${top ? scoreClass(top.sum) : ''}">${top ? escapeHtml(top.name) + ' ' + formatScore(top.sum) : ''}</div>
        <button class="del-btn" data-history-del="${row.id}" type="button" aria-label="削除">✕</button>
      </div>`;
    });
    container.innerHTML = html;
    document.querySelectorAll('[data-history-del]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        deleteHistoryItem(e.currentTarget.dataset.historyDel);
      });
    });
    document.querySelectorAll('[data-history-open]').forEach(item => {
      item.addEventListener('click', e => openHistoryDetail(e.currentTarget.dataset.historyOpen));
    });
  }

  /* ---------- 過去の記録の詳細 ---------- */
  function renderHistoryDetailBody(s){
    const nameOf = i => (s.players && s.players[i] && s.players[i].trim() !== '') ? s.players[i] : defaultName(i);

    let namesHtml = '<div class="name-grid">';
    for(let i = 0; i < s.playerCount; i++){
      namesHtml += `<div class="name-field"><label>プレイヤー${i+1}${s.selfIndex === i ? '（自分）' : ''}</label><div class="detail-name">${escapeHtml(nameOf(i))}</div></div>`;
    }
    namesHtml += '</div>';

    let theadHtml = '<tr><th>半荘</th>';
    for(let i = 0; i < s.playerCount; i++){ theadHtml += `<th>${escapeHtml(nameOf(i))}</th>`; }
    theadHtml += '</tr>';

    let bodyRows = '';
    (s.hanchans || []).forEach((h, rowIdx) => {
      bodyRows += `<tr><th>${rowIdx+1}</th>`;
      for(let i = 0; i < s.playerCount; i++){
        const val = h.scores[i];
        const shown = (val === null || val === undefined) ? '-' : formatScore(val);
        bodyRows += `<td class="${val ? scoreClass(val) : ''}">${shown}</td>`;
      }
      bodyRows += '</tr>';
    });

    const hanchanTotals = new Array(s.playerCount).fill(0);
    (s.hanchans || []).forEach(h => { for(let i = 0; i < s.playerCount; i++){ hanchanTotals[i] += (h.scores[i] || 0); } });
    let footHtml = '<tr><th>合計</th>';
    hanchanTotals.forEach(t => { footHtml += `<td class="${scoreClass(t)}">${formatScore(t)}</td>`; });
    footHtml += '</tr>';

    const hanchanHtml = `<div class="table-scroll"><table class="detail-table"><thead>${theadHtml}</thead><tbody>${bodyRows}</tbody><tfoot>${footHtml}</tfoot></table></div>`;

    let chipHtml = '<div class="chip-rows">';
    for(let i = 0; i < s.playerCount; i++){
      const c = (s.chips && s.chips[i]) || { plus: 0, minus: 0 };
      const total = (c.plus - c.minus) * (s.chipValue || 0);
      chipHtml += `<div class="chip-row"><span class="cname">${escapeHtml(nameOf(i))}</span><span class="detail-chip-count">＋${c.plus} / −${c.minus}枚</span><span class="chip-total ${scoreClass(total)}">${formatScore(total)}</span></div>`;
    }
    chipHtml += '</div>';

    const totals = computeTotals(s);
    let resultHtml = '<div class="result-list">';
    totals.forEach((t, rank) => {
      resultHtml += `<div class="result-item ${rank === 0 ? 'rank-1' : ''}">
        <div class="result-top">
          <div class="rank-badge">${rank+1}位</div>
          <div class="result-main"><div class="result-name">${escapeHtml(t.name)}${t.idx === s.selfIndex ? '（自分）' : ''}</div></div>
          <div class="result-stats">
            <div class="result-stat">
              <div class="stat-label">半荘</div>
              <div class="stat-value ${scoreClass(t.hYen)}">${formatScore(t.hYen)}円</div>
              <div class="stat-sub">${formatScore(t.hTotal)}点</div>
            </div>
            <div class="result-stat">
              <div class="stat-label">チップ</div>
              <div class="stat-value ${scoreClass(t.chipTotal)}">${formatScore(t.chipTotal)}</div>
            </div>
          </div>
        </div>
        <div class="result-total-row">
          <span class="total-label">合計</span>
          <span class="total-value ${scoreClass(t.sum)}">${formatScore(t.sum)}</span>
        </div>
      </div>`;
    });
    resultHtml += '</div>';

    return `
      <section class="panel"><div class="panel-title">卓の設定</div>${namesHtml}</section>
      <section class="panel"><div class="panel-title">半荘ごとの収支（1点＝${s.hanchanRate}円）</div>${hanchanHtml}</section>
      <section class="panel"><div class="panel-title">チップ精算（1枚＝${s.chipValue}点）</div>${chipHtml}</section>
      <section class="panel"><div class="panel-title">最終結果</div>${resultHtml}</section>
    `;
  }

  function openHistoryDetail(id){
    const row = historyList.find(r => String(r.id) === String(id));
    if(!row) return;
    currentHistoryDetailId = id;
    const s = Object.assign(defaultState(), row.state || {});
    const d = new Date(row.created_at);
    document.getElementById('history-detail-title-text').textContent = row.title || '記録';
    document.getElementById('history-detail-date').textContent = `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
    document.getElementById('history-detail-body').innerHTML = renderHistoryDetailBody(s);
    document.getElementById('history-detail-overlay').style.display = 'flex';
  }

  function closeHistoryDetail(){
    document.getElementById('history-detail-overlay').style.display = 'none';
  }

  /* ---------- 過去の記録の編集 ---------- */
  function editHistoryItem(id){
    const row = historyList.find(r => String(r.id) === String(id));
    if(!row) return;

    if(!isEditingHistory){
      editingBackup = {
        sessionId: currentSessionId,
        state: state,
        groupId: currentGroupId,
        title: document.getElementById('session-title-input').value
      };
    }
    isEditingHistory = true;
    currentSessionId = row.id;
    currentGroupId = row.group_id || null;
    state = row.state || defaultState();
    normalizeState();

    document.getElementById('session-title-input').value = row.title || defaultTitle();
    document.getElementById('hanchan-rate-input').value = state.hanchanRate;
    document.getElementById('chip-value-input').value = state.chipValue;
    renderPlayerSetup();
    renderHanchanTable();
    renderChipSection();
    renderFinalResults();
    renderGroupSelect();
    document.getElementById('editing-banner').style.display = 'flex';

    closeHistoryDetail();
    switchTab('record');
  }

  async function exitEditingHistory(){
    if(!editingBackup) return;
    clearTimeout(saveDebounceTimer);
    await doSaveState();

    currentSessionId = editingBackup.sessionId;
    state = editingBackup.state;
    currentGroupId = editingBackup.groupId;
    normalizeState();
    document.getElementById('session-title-input').value = editingBackup.title;
    document.getElementById('hanchan-rate-input').value = state.hanchanRate;
    document.getElementById('chip-value-input').value = state.chipValue;
    isEditingHistory = false;
    editingBackup = null;

    renderPlayerSetup();
    renderHanchanTable();
    renderChipSection();
    renderFinalResults();
    renderGroupSelect();
    document.getElementById('editing-banner').style.display = 'none';

    await loadHistory();
    renderHistory();
    renderCareerStats();
  }

  /* ---------- リセット ---------- */
  async function resetAll(){
    if(!confirm('今回の記録をリセットします。よろしいですか？')) return;
    state = defaultState();
    renderPlayerSetup();
    renderHanchanTable();
    renderChipSection();
    renderFinalResults();
    renderCareerStats();
    scheduleSave();
  }

  /* ---------- アプリ初期化（ログイン後） ---------- */
  async function initAppForUser(){
    showScreen('loading');
    document.getElementById('user-email').textContent = currentUser.email || '';
    await loadCurrentSession();
    await loadHistory();
    await loadGroups();
    renderPlayerSetup();
    renderHanchanTable();
    renderChipSection();
    renderFinalResults();
    renderHistory();
    renderCareerStats();
    renderGroups();
    document.getElementById('hanchan-rate-input').value = state.hanchanRate;
    switchTab('record');
    showScreen('app');
  }

  /* ---------- タブ切り替え ---------- */
  function switchTab(name){
    document.getElementById('tab-record').style.display = name === 'record' ? '' : 'none';
    document.getElementById('tab-mypage').style.display = name === 'mypage' ? '' : 'none';
    document.getElementById('tab-btn-record').classList.toggle('active', name === 'record');
    document.getElementById('tab-btn-mypage').classList.toggle('active', name === 'mypage');
  }

  /* ---------- 初期化 ---------- */
  function wireStaticListeners(){
    document.getElementById('auth-submit-btn').addEventListener('click', handleAuthSubmit);
    document.getElementById('auth-toggle-btn').addEventListener('click', () => {
      authMode = authMode === 'signin' ? 'signup' : 'signin';
      updateAuthModeUI();
    });
    document.getElementById('logout-btn').addEventListener('click', handleSignOut);
    document.getElementById('tab-btn-record').addEventListener('click', () => switchTab('record'));
    document.getElementById('tab-btn-mypage').addEventListener('click', () => switchTab('mypage'));
    document.getElementById('btn-3p').addEventListener('click', () => setPlayerCount(3));
    document.getElementById('btn-4p').addEventListener('click', () => setPlayerCount(4));
    document.getElementById('add-hanchan-btn').addEventListener('click', addHanchan);
    document.querySelectorAll('.score-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => setScoreMode(btn.dataset.scoreMode));
    });
    document.querySelectorAll('.return-score-btn').forEach(btn => {
      btn.addEventListener('click', () => setReturnScore(Number(btn.dataset.returnScore)));
    });
    document.querySelectorAll('.uma-btn').forEach(btn => {
      btn.addEventListener('click', () => setUmaEnabled(btn.dataset.uma === 'on'));
    });
    document.querySelectorAll('.tobi-btn').forEach(btn => {
      btn.addEventListener('click', () => setTobiEnabled(btn.dataset.tobi === 'on'));
    });
    document.querySelectorAll('.tobi-amount-btn').forEach(btn => {
      btn.addEventListener('click', () => setTobiAmount(Number(btn.dataset.tobiAmount)));
    });
    document.getElementById('reset-btn').addEventListener('click', resetAll);
    document.getElementById('new-session-btn').addEventListener('click', startNewSession);
    document.getElementById('history-detail-back').addEventListener('click', closeHistoryDetail);
    document.getElementById('history-detail-edit-btn').addEventListener('click', () => editHistoryItem(currentHistoryDetailId));
    document.getElementById('exit-editing-btn').addEventListener('click', exitEditingHistory);

    document.getElementById('group-select').addEventListener('change', e => onGroupSelectChange(e.target.value));
    document.getElementById('add-group-btn').addEventListener('click', openGroupForm);
    document.getElementById('group-form-back').addEventListener('click', closeGroupForm);
    document.getElementById('group-save-btn').addEventListener('click', saveGroup);
    document.getElementById('add-group-member-btn').addEventListener('click', addGroupMember);
    document.getElementById('group-detail-back').addEventListener('click', closeGroupDetail);
    document.getElementById('group-picker-back').addEventListener('click', closeGroupPlayerPicker);
    document.getElementById('group-picker-apply-btn').addEventListener('click', confirmGroupPicker);

    const hanchanRateInput = document.getElementById('hanchan-rate-input');
    attachSelectOnFocus(hanchanRateInput);
    hanchanRateInput.addEventListener('input', e => {
      const raw = e.target.value;
      state.hanchanRate = raw === '' ? 0 : Number(raw);
      renderFinalResults();
      scheduleSave();
    });

    const chipValueInput = document.getElementById('chip-value-input');
    attachSelectOnFocus(chipValueInput);
    chipValueInput.addEventListener('input', e => {
      const raw = e.target.value;
      state.chipValue = raw === '' ? 0 : Number(raw);
      for(let i = 0; i < state.playerCount; i++) updateChipTotal(i);
      renderFinalResults();
      scheduleSave();
    });

    const sessionTitleInput = document.getElementById('session-title-input');
    sessionTitleInput.addEventListener('input', e => {
      const val = e.target.value;
      clearTimeout(titleDebounceTimer);
      titleDebounceTimer = setTimeout(async () => {
        if(!currentSessionId) return;
        await sb.from('game_sessions').update({ title: val || defaultTitle() }).eq('id', currentSessionId);
      }, 600);
    });

    updateAuthModeUI();
  }

  function init(){
    wireStaticListeners();
    showScreen('loading');
    sb.auth.onAuthStateChange((event, session) => {
      if(session && session.user){
        currentUser = session.user;
        initAppForUser();
      }else{
        currentUser = null;
        currentSessionId = null;
        showScreen('auth');
      }
    });
  }

  init();
