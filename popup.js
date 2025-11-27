const $$ = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));
const $ = (sel, ctx=document) => ctx.querySelector(sel);

const defaultColors = { applied: '#a5fc03', open: '#ffea00', missed: '#fc2403' };
let colorPrefs = { ...defaultColors };
let activeBucket = 'APPLIED';
let allItems = [];
let currentSort = 'deadline_asc';
let isFetchingCGPA = false;
let userCGPA = null;

function formatTime(ts){
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch (e) { return '—'; }
}

function renderList(items){
  const list = $('#list');
  list.innerHTML = '';
  const tpl = $('#itemTemplate');
  if (!items || items.length === 0){
    $('#empty').classList.remove('hidden');
    return;
  }
  $('#empty').classList.add('hidden');
  for (const it of items){
    const node = tpl.content.firstElementChild.cloneNode(true);
    $('.company', node).textContent = it.company || '—';
    $('.role', node).textContent = it.role || '—';
    $('.ctc', node).textContent = it.ctc || '—';
    const ded = it.deadlineEnd || it.deadline || '—';
    $('.deadline', node).textContent = ded;
    const chip = $('.chip-status', node);
    const b = (it.statusBucket || 'APPLIED').toUpperCase();
    chip.textContent = (b === 'APPLIED') ? 'Applied' : (b === 'OPEN' ? 'Can Apply' : (b === 'MISSED' ? 'Missed' : b));
    chip.classList.remove('chip-green','chip-yellow','chip-red');
    chip.classList.add(b === 'APPLIED' ? 'chip-green' : b === 'OPEN' ? 'chip-yellow' : 'chip-red');
    node.dataset.bucket = b;
    
    // CGPA display
    const cgpaEl = $('.cgpa', node);
    const cgpaBadge = $('.cgpa-badge', node);
    const cgpaRow = $('.cgpa-row', node);
    
    if (it.cgpa) {
      cgpaEl.textContent = it.cgpa;
      
      // Calculate eligibility based on user's CGPA
      const requiredCGPA = parseFloat(it.cgpa);
      const isEligible = userCGPA ? (userCGPA >= requiredCGPA) : null;
      
      if (isEligible === true) {
        cgpaBadge.textContent = '✓ Eligible';
        cgpaBadge.classList.add('eligible');
      } else if (isEligible === false) {
        cgpaBadge.textContent = '✗ Not Eligible';
        cgpaBadge.classList.add('not-eligible');
      } else {
        cgpaBadge.textContent = 'Set your CGPA';
        cgpaBadge.classList.add('unknown');
      }
    } else if (b === 'OPEN') {
      cgpaEl.textContent = '—';
      cgpaBadge.textContent = 'Not fetched';
      cgpaBadge.classList.add('unknown');
    } else {
      // Hide CGPA row for non-OPEN companies without data
      cgpaRow.style.display = 'none';
    }
    
    list.appendChild(node);
  }
}

function applySearch(items, q){
  if (!q) return items;
  const qq = q.trim().toLowerCase();
  return items.filter(it => (it.company || '').toLowerCase().includes(qq));
}

function setMeta(count, updatedAt){
  $('#count').textContent = `${count}`;
  $('#updated').textContent = updatedAt ? `Updated ${formatTime(updatedAt)}` : '—';
}

async function loadFromStorage(){
  return new Promise(resolve => {
    chrome.storage.local.get(['allCompanies','allCompaniesUpdatedAt','statusCounts','colors','prefs','cgpaCache','cgpaCacheUpdatedAt','userCGPA'], data => {
      resolve({
        list: data.allCompanies || [],
        updatedAt: data.allCompaniesUpdatedAt || 0,
        counts: data.statusCounts || { applied: 0, open: 0, missed: 0 },
        colors: data.colors || null,
        prefs: data.prefs || null,
        cgpaCache: data.cgpaCache || {},
        cgpaCacheUpdatedAt: data.cgpaCacheUpdatedAt || 0,
        userCGPA: data.userCGPA || null
      });
    });
  });
}

async function tryRefreshFromActiveTab(){
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) return null;
    // Ask content script in active tab to rescan; ignore if not present
    return await chrome.tabs.sendMessage(tab.id, { type: 'GET_COMPANIES', deep: true });
  } catch (e) {
    return null;
  }
}

function openERP(){
  chrome.tabs.create({ url: 'https://erp.iitkgp.ac.in/IIT_ERP3/showmenu.htm' });
}

function applyColorVars(colors){
  const root = document.documentElement;
  root.style.setProperty('--green', colors.applied || defaultColors.applied);
  root.style.setProperty('--yellow', colors.open || defaultColors.open);
  root.style.setProperty('--red', colors.missed || defaultColors.missed);
}

function updateCounts(counts){
  $('#cnt-applied').textContent = String(counts.applied || 0);
  $('#cnt-open').textContent = String(counts.open || 0);
  $('#cnt-missed').textContent = String(counts.missed || 0);
}

function filteredItems(base){
  const q = $('#searchInput').value;
  const byBucket = base.filter(it => (it.statusBucket || 'APPLIED').toUpperCase() === activeBucket);
  const searched = applySearch(byBucket, q);
  return sortItems(searched, currentSort);
}

function parseDeadline(s){
  if (!s) return NaN;
  // ERP now uses yyyy-mm-dd hh:mm format
  const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (!m) return NaN;
  const [_, y, mo, d, h, mi] = m;
  const dt = new Date(Number(y), Number(mo)-1, Number(d), Number(h), Number(mi));
  return dt.getTime();
}

function sortItems(items, key){
  const arr = items.slice();
  if (key === 'name_asc' || key === 'name_desc'){
    arr.sort((a,b) => (a.company||'').localeCompare(b.company||'', undefined, {sensitivity:'base'}));
    if (key === 'name_desc') arr.reverse();
  } else if (key === 'deadline_asc' || key === 'deadline_desc'){
    arr.sort((a,b) => {
      const ta = parseDeadline(a.deadlineEnd || a.deadline);
      const tb = parseDeadline(b.deadlineEnd || b.deadline);
      const aa = isNaN(ta) ? Number.POSITIVE_INFINITY : ta;
      const bb = isNaN(tb) ? Number.POSITIVE_INFINITY : tb;
      return aa - bb;
    });
    if (key === 'deadline_desc') arr.reverse();
  }
  return arr;
}

function setProgress(pct){
  const wrap = $('#progress');
  const bar = $('#progressBar');
  const txt = $('#progressText');
  if (pct == null) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
  txt.textContent = 'Scanning… ' + (isFinite(pct) ? pct + '%' : '');
}

function setCGPAProgress(pct, completed, total){
  const wrap = $('#cgpaProgress');
  const bar = $('#cgpaProgressBar');
  const txt = $('#cgpaProgressText');
  const btn = $('#fetchCGPABtn');
  const status = $('#cgpaStatus');
  
  if (pct == null) {
    wrap.classList.add('hidden');
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">📊</span> Fetch CGPA';
    isFetchingCGPA = false;
    return;
  }
  
  wrap.classList.remove('hidden');
  bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
  txt.textContent = `Fetching CGPA… ${completed || 0}/${total || '?'}`;
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span> Fetching...';
  isFetchingCGPA = true;
}

function updateCGPAStatus(cgpaCache){
  const status = $('#cgpaStatus');
  if (!cgpaCache) {
    status.textContent = '';
    return;
  }
  const count = Object.keys(cgpaCache).length;
  if (count > 0) {
    status.textContent = `${count} CGPA cached`;
  } else {
    status.textContent = 'No CGPA data';
  }
}

async function triggerCGPAFetch(){
  if (isFetchingCGPA) return;
  
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) {
      alert('Please open the ERP CDC page first');
      return;
    }
    
    setCGPAProgress(0, 0, 0);
    
    // Send message to content script to start CGPA fetch
    chrome.tabs.sendMessage(tab.id, { type: 'FETCH_CGPA' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error:', chrome.runtime.lastError);
        setCGPAProgress(null);
        alert('Failed to start CGPA fetch. Make sure you are on the ERP CDC page.');
      }
    });
  } catch (e) {
    console.error('Error triggering CGPA fetch:', e);
    setCGPAProgress(null);
  }
}

async function notifyContentScriptCGPAUpdate(){
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'RECOLOR' });
    }
  } catch (e) {}
}

async function bootstrap(){
  const state = await loadFromStorage();
  if (state.colors) { colorPrefs = { ...defaultColors, ...state.colors }; }
  applyColorVars(colorPrefs);
  // Load preferences (active tab + sort) if saved
  if (state.prefs) {
    const ab = String(state.prefs.activeBucket || '').toUpperCase();
    if (ab === 'APPLIED' || ab === 'OPEN' || ab === 'MISSED') activeBucket = ab;
    const sk = String(state.prefs.sortKey || '');
    if (sk === 'deadline_asc' || sk === 'deadline_desc' || sk === 'name_asc' || sk === 'name_desc') currentSort = sk;
  }

  // Reflect prefs in UI
  $$('.tab').forEach(t => {
    if ((t.getAttribute('data-bucket') || '').toUpperCase() === activeBucket) t.classList.add('active');
    else t.classList.remove('active');
  });
  const sortSel = $('#sortSelect');
  if (sortSel) sortSel.value = currentSort;

  allItems = state.list;
  updateCounts(state.counts || {});
  setMeta(allItems.length, state.updatedAt);
  
  // Load user's CGPA
  if (state.userCGPA) {
    userCGPA = parseFloat(state.userCGPA);
    $('#userCGPAInput').value = userCGPA;
  }
  
  renderList(filteredItems(allItems));
  
  // Update CGPA status
  updateCGPAStatus(state.cgpaCache);

  $('#searchInput').addEventListener('input', (e) => {
    const filtered = filteredItems(allItems);
    setMeta(filtered.length, state.updatedAt);
    renderList(filtered);
  });

  $('#refreshBtn').addEventListener('click', async () => {
    const btn = $('#refreshBtn');
    const old = btn.textContent;
    btn.textContent = '…';
    btn.disabled = true;
    setProgress(0);
    const resp = await tryRefreshFromActiveTab();
    const latest = resp || await loadFromStorage();
    allItems = (latest.allCompanies || latest.list) || [];
    updateCounts(latest.counts || {});
    setMeta(allItems.length, latest.updatedAt || latest.appliedCompaniesUpdatedAt);
    renderList(filteredItems(allItems));
    setProgress(null);
    btn.textContent = old;
    btn.disabled = false;
  });

  $('#openERPBtn').addEventListener('click', openERP);

  // Filters
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeBucket = (tab.getAttribute('data-bucket') || 'APPLIED').toUpperCase();
      const filtered = filteredItems(allItems);
      setMeta(filtered.length, state.updatedAt);
      renderList(filtered);
      // persist tab choice
      chrome.storage.local.set({ prefs: { activeBucket, sortKey: currentSort } });
    });
  });

  $('#sortSelect').addEventListener('change', (e) => {
    currentSort = e.target.value;
    const filtered = filteredItems(allItems);
    setMeta(filtered.length, state.updatedAt);
    renderList(filtered);
    // persist sort choice
    chrome.storage.local.set({ prefs: { activeBucket, sortKey: currentSort } });
  });

  // Settings
  $('#settingsBtn').addEventListener('click', () => {
    $('#settings').classList.toggle('hidden');
  });
  // Load current colors
  $('#colorApplied').value = colorPrefs.applied || defaultColors.applied;
  $('#colorOpen').value = colorPrefs.open || defaultColors.open;
  $('#colorMissed').value = colorPrefs.missed || defaultColors.missed;
  $('#saveColorsBtn').addEventListener('click', async () => {
    colorPrefs = {
      applied: $('#colorApplied').value,
      open: $('#colorOpen').value,
      missed: $('#colorMissed').value
    };
    applyColorVars(colorPrefs);
    chrome.storage.local.set({ colors: colorPrefs });
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'RECOLOR' });
      }
    } catch (e) {}
  });
  $('#resetColorsBtn').addEventListener('click', () => {
    colorPrefs = { ...defaultColors };
    $('#colorApplied').value = colorPrefs.applied;
    $('#colorOpen').value = colorPrefs.open;
    $('#colorMissed').value = colorPrefs.missed;
    applyColorVars(colorPrefs);
    chrome.storage.local.set({ colors: colorPrefs });
  });

  // CGPA fetch button
  $('#fetchCGPABtn').addEventListener('click', triggerCGPAFetch);
  
  // User CGPA input
  $('#saveCGPABtn').addEventListener('click', () => {
    const input = $('#userCGPAInput');
    const val = parseFloat(input.value);
    if (isNaN(val) || val < 0 || val > 10) {
      alert('Please enter a valid CGPA between 0 and 10');
      return;
    }
    userCGPA = val;
    chrome.storage.local.set({ userCGPA: val });
    // Re-render list with updated eligibility
    renderList(filteredItems(allItems));
    // Notify content script
    notifyContentScriptCGPAUpdate();
  });
  
  // Also save on Enter key
  $('#userCGPAInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      $('#saveCGPABtn').click();
    }
  });

  // Progress updates from content script
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    
    if (msg.type === 'DEEP_SCAN_PROGRESS') {
      const pct = Math.max(0, Math.min(100, Math.round(msg.progress || 0)));
      setProgress(pct);
    }
    
    if (msg.type === 'CGPA_FETCH_PROGRESS') {
      const pct = Math.max(0, Math.min(100, Math.round(msg.progress || 0)));
      setCGPAProgress(pct, msg.completed, msg.total);
    }
    
    if (msg.type === 'CGPA_FETCH_COMPLETE') {
      setCGPAProgress(null);
      // Update the list with new CGPA data
      if (msg.allCompanies) {
        allItems = msg.allCompanies;
        renderList(filteredItems(allItems));
        // Update CGPA status
        loadFromStorage().then(state => {
          updateCGPAStatus(state.cgpaCache);
        });
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', bootstrap);
