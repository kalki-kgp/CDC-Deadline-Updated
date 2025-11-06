const $$ = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));
const $ = (sel, ctx=document) => ctx.querySelector(sel);

const defaultColors = { applied: '#a5fc03', open: '#ffea00', missed: '#fc2403' };
let colorPrefs = { ...defaultColors };
let selectedBuckets = new Set(['APPLIED','OPEN','MISSED']);
let allItems = [];

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
    chrome.storage.local.get(['allCompanies','allCompaniesUpdatedAt','statusCounts','colors'], data => {
      resolve({
        list: data.allCompanies || [],
        updatedAt: data.allCompaniesUpdatedAt || 0,
        counts: data.statusCounts || { applied: 0, open: 0, missed: 0 },
        colors: data.colors || null
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
  const byBucket = base.filter(it => selectedBuckets.has((it.statusBucket || 'APPLIED').toUpperCase()));
  return applySearch(byBucket, q);
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

async function bootstrap(){
  const state = await loadFromStorage();
  if (state.colors) { colorPrefs = { ...defaultColors, ...state.colors }; }
  applyColorVars(colorPrefs);
  allItems = state.list;
  updateCounts(state.counts || {});
  setMeta(allItems.length, state.updatedAt);
  renderList(filteredItems(allItems));

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
  $$('.chip-toggle').forEach(ch => {
    ch.addEventListener('click', () => {
      const b = ch.getAttribute('data-bucket');
      if (ch.classList.contains('active')) {
        ch.classList.remove('active');
        selectedBuckets.delete(b);
      } else {
        ch.classList.add('active');
        selectedBuckets.add(b);
      }
      const filtered = filteredItems(allItems);
      setMeta(filtered.length, state.updatedAt);
      renderList(filtered);
    });
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

  // Progress updates from content script
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'DEEP_SCAN_PROGRESS') return;
    const pct = Math.max(0, Math.min(100, Math.round(msg.progress || 0)));
    setProgress(pct);
  });
}

document.addEventListener('DOMContentLoaded', bootstrap);
