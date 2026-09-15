  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  let currentUser = null;
  let currentSessionId = null;
  let currentGroupId = null;
  let state = defaultState();
  let historyList = [];
  let groupsList = [];
  let groupForm = { playerCount: 3, players: ['', '', '', ''], selfIndex: null };
  let authMode = 'signin';
  let saveDebounceTimer = null;
  let titleDebounceTimer = null;
  let flashTimer = null;

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
      selfIndex: null
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
    state.hanchans.forEach(h => { while(h.scores.length < 4) h.scores.push(null); });
  }

  function defaultName(i){ return ['A','B','C','D'][i]; }
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
    let theadHtml = '<tr><th>半荘</th>';
    for(let i = 0; i < state.playerCount; i++){
      theadHtml += `<th data-name-idx="${i}">${escapeHtml(playerDisplayName(i))}</th>`;
    }
    theadHtml += '<th>判定</th><th></th></tr>';
    document.querySelector('#hanchan-table thead').innerHTML = theadHtml;

    let rows = '';
    state.hanchans.forEach((h, rowIdx) => {
      rows += `<tr><th>${rowIdx+1}</th>`;
      for(let i = 0; i < state.playerCount; i++){
        const val = h.scores[i];
        const isNeg = (val !== null && val !== undefined && val < 0);
        const abs = (val === null || val === undefined) ? '' : Math.abs(val);
        const signChar = isNeg ? '\u2212' : '+';
        rows += `<td><div class="score-cell">
          <button type="button" class="sign-btn${isNeg ? ' sign-minus' : ''}" data-sign="${isNeg ? '-' : '+'}" data-row="${rowIdx}" data-player="${i}" aria-label="符号を切り替え">${signChar}</button>
          <input type="text" inputmode="numeric" pattern="[0-9]*" value="${abs}" data-row="${rowIdx}" data-player="${i}" class="score-input">
        </div></td>`;
      }
      rows += `<td class="status-cell" id="status-${rowIdx}"></td>`;
      rows += `<td><button class="del-btn" data-del="${rowIdx}" type="button" aria-label="この半荘を削除">✕</button></td></tr>`;
    });
    document.querySelector('#hanchan-table tbody').innerHTML = rows;

    function recomputeScoreCell(r, p){
      const inp = document.querySelector(`.score-input[data-row="${r}"][data-player="${p}"]`);
      const btn = document.querySelector(`.sign-btn[data-row="${r}"][data-player="${p}"]`);
      if(!inp || !btn) return;
      const magStr = inp.value;
      let val;
      if(magStr === ''){ val = null; }
      else { const mag = Number(magStr); val = (btn.dataset.sign === '-') ? -mag : mag; }
      state.hanchans[r].scores[p] = val;
      updateRowStatus(r);
      updateFooter();
      renderFinalResults();
      scheduleSave();
    }

    document.querySelectorAll('.score-input').forEach(inp => {
      inp.addEventListener('input', e => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '');
        const r = Number(e.target.dataset.row), p = Number(e.target.dataset.player);
        recomputeScoreCell(r, p);
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
        recomputeScoreCell(r, p);
      });
    });

    document.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', e => {
        const idx = Number(e.currentTarget.dataset.del);
        state.hanchans.splice(idx, 1);
        if(state.hanchans.length === 0) state.hanchans.push({ scores:[null,null,null,null] });
        renderHanchanTable();
        renderFinalResults();
        scheduleSave();
      });
    });

    updateFooter();
    state.hanchans.forEach((_, idx) => updateRowStatus(idx));
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
    state.hanchans.push({ scores:[null,null,null,null] });
    renderHanchanTable();
    renderFinalResults();
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
  function computeTotals(s){
    const totals = [];
    for(let i = 0; i < s.playerCount; i++){
      let hTotal = 0;
      (s.hanchans || []).forEach(h => { hTotal += (h.scores[i] || 0); });
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
        const members = (g.players || []).slice(0, g.player_count).map(n => escapeHtml(n || '')).join('・');
        html += `<div class="history-item" data-group-open="${g.id}">
          <div class="history-main">
            <div class="history-title">${escapeHtml(g.name)}</div>
            <div class="history-date">${g.player_count}人打ち・${members}</div>
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

  async function applyGroup(groupId){
    if(!groupId){
      currentGroupId = null;
      await persistGroupId();
      return;
    }
    const group = groupsList.find(g => String(g.id) === String(groupId));
    if(!group) return;
    currentGroupId = group.id;
    state.playerCount = group.player_count;
    for(let i = 0; i < 4; i++){ state.players[i] = group.players[i] || ''; }
    state.selfIndex = (group.self_index !== null && group.self_index !== undefined) ? group.self_index : null;
    renderPlayerSetup();
    renderHanchanTable();
    renderChipSection();
    renderFinalResults();
    renderCareerStats();
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

  /* ---------- グループ作成フォーム ---------- */
  function renderGroupNameGrid(){
    const grid = document.getElementById('group-name-grid');
    grid.innerHTML = '';
    for(let i = 0; i < groupForm.playerCount; i++){
      const field = document.createElement('div');
      field.className = 'name-field';
      const label = document.createElement('label');
      label.textContent = `プレイヤー${i+1}`;
      const row = document.createElement('div');
      row.className = 'name-input-row';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = groupForm.players[i] || '';
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
      field.appendChild(label);
      field.appendChild(row);
      grid.appendChild(field);
    }
    document.getElementById('group-btn-3p').classList.toggle('active', groupForm.playerCount === 3);
    document.getElementById('group-btn-4p').classList.toggle('active', groupForm.playerCount === 4);
  }

  function setGroupPlayerCount(n){
    if(groupForm.playerCount === n) return;
    groupForm.playerCount = n;
    renderGroupNameGrid();
  }

  function openGroupForm(){
    groupForm = { playerCount: 3, players: ['', '', '', ''], selfIndex: null };
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
    const { error } = await sb.from('groups').insert({
      user_id: currentUser.id,
      name,
      player_count: groupForm.playerCount,
      players: groupForm.players.slice(0, groupForm.playerCount),
      self_index: groupForm.selfIndex
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
    const n = group.player_count;
    const stats = [];
    for(let i = 0; i < n; i++){
      let totalSum = 0, rankSum = 0, firstCount = 0, count = 0;
      sessions.forEach(s => {
        if(i >= s.playerCount) return;
        const totals = computeTotals(s);
        const rank = totals.findIndex(t => t.idx === i);
        if(rank === -1) return;
        totalSum += totals[rank].sum;
        rankSum += rank + 1;
        count++;
        if(rank === 0) firstCount++;
      });
      const name = (group.players[i] && group.players[i].trim() !== '') ? group.players[i] : defaultName(i);
      stats.push({ name, isSelf: group.self_index === i, count, totalSum, avgRank: count ? rankSum / count : null });
    }
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
    document.getElementById('reset-btn').addEventListener('click', resetAll);
    document.getElementById('new-session-btn').addEventListener('click', startNewSession);
    document.getElementById('history-detail-back').addEventListener('click', closeHistoryDetail);

    document.getElementById('group-select').addEventListener('change', e => applyGroup(e.target.value));
    document.getElementById('add-group-btn').addEventListener('click', openGroupForm);
    document.getElementById('group-form-back').addEventListener('click', closeGroupForm);
    document.getElementById('group-save-btn').addEventListener('click', saveGroup);
    document.getElementById('group-btn-3p').addEventListener('click', () => setGroupPlayerCount(3));
    document.getElementById('group-btn-4p').addEventListener('click', () => setGroupPlayerCount(4));
    document.getElementById('group-detail-back').addEventListener('click', closeGroupDetail);

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
