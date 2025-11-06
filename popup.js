const $$ = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));
const $ = (sel, ctx=document) => ctx.querySelector(sel);

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
    chrome.storage.local.get(['appliedCompanies','appliedCompaniesUpdatedAt'], data => {
      resolve({
        list: data.appliedCompanies || [],
        updatedAt: data.appliedCompaniesUpdatedAt || 0
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
    return await chrome.tabs.sendMessage(tab.id, { type: 'GET_APPLIED_COMPANIES', deep: true });
  } catch (e) {
    return null;
  }
}

function openERP(){
  chrome.tabs.create({ url: 'https://erp.iitkgp.ac.in/IIT_ERP3/showmenu.htm' });
}

async function bootstrap(){
  const state = await loadFromStorage();
  let items = state.list;
  setMeta(items.length, state.updatedAt);
  renderList(items);

  $('#searchInput').addEventListener('input', (e) => {
    const filtered = applySearch(items, e.target.value);
    setMeta(filtered.length, state.updatedAt);
    renderList(filtered);
  });

  $('#refreshBtn').addEventListener('click', async () => {
    const btn = $('#refreshBtn');
    const old = btn.textContent;
    btn.textContent = '…';
    btn.disabled = true;
    const resp = await tryRefreshFromActiveTab();
    const latest = resp || await loadFromStorage();
    items = latest.list || latest.appliedCompanies || [];
    setMeta(items.length, latest.updatedAt || latest.appliedCompaniesUpdatedAt);
    const q = $('#searchInput').value;
    renderList(applySearch(items, q));
    btn.textContent = old;
    btn.disabled = false;
  });

  $('#openERPBtn').addEventListener('click', openERP);
}

document.addEventListener('DOMContentLoaded', bootstrap);
