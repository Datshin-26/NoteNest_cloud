(() => {
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const KEY = 'cloudnotes_data_v1', SYNC_PENDING_KEY = 'cloudnotes_sync_pending_v1', QUOTA = 50 * 1024 * 1024;
const DEFAULT_CATEGORIES = ['Personal','Work','Study','Ideas','Code Projects'];
const COLORS = ['#6366f1','#f59e0b','#10b981','#ec4899','#06b6d4','#8b5cf6','#ef4444'];
let state = load();
let ui = { view:'all', cat:null, tag:null, q:'', sort:'updated-desc', editing:null, sharing:null };
let syncQueue = Promise.resolve(), saveVersion = 0;

function load(){
  try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.notes) return d; } catch(e){}
  return { notes:[], categories:DEFAULT_CATEGORIES.slice(), dark:false };
}
function save(){
  const body = JSON.stringify(state), version = ++saveVersion;
  localStorage.setItem(KEY, body);
  localStorage.setItem(SYNC_PENDING_KEY, 'true');
  setSync('busy');
  syncQueue = syncQueue.then(async () => {
    const response = await fetch('/api/state', {
      method:'PUT', headers:{'Content-Type':'application/json'}, body
    });
    if (!response.ok) throw new Error(`Backend returned HTTP ${response.status}`);
  }).then(() => {
    if (version === saveVersion) {
      localStorage.removeItem(SYNC_PENDING_KEY);
      setSync('connected');
    }
  }).catch(error => {
    console.error('NoteNest backend sync failed:', error);
    if (version === saveVersion) {
      setSync('error');
      toast('Saved locally, but backend sync failed');
    }
  });
  return syncQueue;
}
function setSync(status, message){
  $('#syncStatus').classList.toggle('busy', status==='busy');
  $('#syncStatus').classList.toggle('error', status==='error');
  $('#syncText').textContent = message || (status==='busy' ? 'Syncing…' : status==='connected' ? 'Backend connected' : 'Backend unavailable');
}
async function initializeBackend(){
  const version = saveVersion;
  try {
    setSync('busy','Connecting…');
    const response = await fetch('/api/state');
    if (!response.ok) throw new Error(`Backend returned HTTP ${response.status}`);
    const remote = await response.json();
    if (version !== saveVersion) return;
    const hasLocalData = state.notes.length || state.dark ||
      state.categories.join('\u0000') !== DEFAULT_CATEGORIES.join('\u0000');
    if ((!remote.initialized && hasLocalData) || localStorage.getItem(SYNC_PENDING_KEY)==='true') {
      save();
      render();
      return;
    }
    state = { notes:remote.notes, categories:remote.categories, dark:remote.dark };
    localStorage.setItem(KEY, JSON.stringify(state));
    render();
    setSync('connected');
  } catch (error) {
    console.error('NoteNest backend connection failed:', error);
    if (version === saveVersion) {
      setSync('error');
      toast('Backend unavailable; changes will stay in this browser');
    }
  }
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const esc = s => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const words = t => (t.trim().match(/\S+/g) || []).length;
const catColor = c => COLORS[Math.max(0, state.categories.indexOf(c)) % COLORS.length];
function toast(m){ const t=$('#toast'); t.textContent=m; t.classList.add('show'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),2000); }

/* Markdown */
function md(src){
  let h = esc(src);
  const blocks = [];
  h = h.replace(/```([\s\S]*?)```/g, (_, c) => { blocks.push(`<pre><code>${c.trim()}</code></pre>`); return `\u0000${blocks.length-1}\u0000`; });
  h = h.replace(/^### (.*)$/gm,'<h3>$1</h3>').replace(/^## (.*)$/gm,'<h2>$1</h2>').replace(/^# (.*)$/gm,'<h1>$1</h1>')
   .replace(/^&gt; (.*)$/gm,'<blockquote>$1</blockquote>')
   .replace(/^- \[x\] (.*)$/gm,'<div>☑ $1</div>').replace(/^- \[ \] (.*)$/gm,'<div>☐ $1</div>')
   .replace(/^(?:- |\* )(.*)$/gm,'<li>$1</li>').replace(/^\d+\. (.*)$/gm,'<li>$1</li>')
   .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
   .replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/\*(.+?)\*/g,'<i>$1</i>').replace(/~~(.+?)~~/g,'<s>$1</s>')
   .replace(/`([^`]+)`/g,'<code>$1</code>')
   .replace(/\[(.+?)\]\((https?:[^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>')
   .replace(/\n(?!<)/g,'<br>');
  return h.replace(/\u0000(\d+)\u0000/g,(_, i)=>blocks[i]);
}

/* Filtering */
function visible(){
  let list = state.notes.filter(n => ui.view==='trash' ? n.trashed : !n.trashed);
  if (ui.view==='pinned') list = list.filter(n=>n.pinned);
  if (ui.view==='favorites') list = list.filter(n=>n.fav);
  if (ui.cat) list = list.filter(n=>n.category===ui.cat);
  if (ui.tag) list = list.filter(n=>n.tags.includes(ui.tag));
  if (ui.q) { const q = ui.q.toLowerCase(); list = list.filter(n => (n.title+n.body+n.tags.join(' ')).toLowerCase().includes(q)); }
  const [k, d] = ui.sort.split('-'), m = d==='asc'?1:-1;
  return list.sort((a,b) => k==='title' ? a.title.localeCompare(b.title)*m : (a[k==='created'?'created':'updated']-b[k==='created'?'created':'updated'])*m);
}

/* Render */
function render(){
  document.body.classList.toggle('dark', !!state.dark);
  const active = state.notes.filter(n=>!n.trashed);
  $('#cnt-all').textContent = active.length;
  $('#cnt-pinned').textContent = active.filter(n=>n.pinned).length;
  $('#cnt-favorites').textContent = active.filter(n=>n.fav).length;
  $('#cnt-trash').textContent = state.notes.length - active.length;
  $$('.nav-item[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view===ui.view && !ui.cat));

  $('#categoryList').innerHTML = state.categories.map(c => `<button class="nav-item ${ui.cat===c?'active':''}" data-cat="${esc(c)}"><span class="cat-dot" style="background:${catColor(c)}"></span>${esc(c)}<span class="count">${active.filter(n=>n.category===c).length}</span></button>`).join('');
  const tags = [...new Set(active.flatMap(n=>n.tags))].sort();
  $('#tagList').innerHTML = tags.length ? tags.map(t=>`<span class="tag ${ui.tag===t?'active':''}" data-tag="${esc(t)}">#${esc(t)}</span>`).join('') : '<small style="color:var(--muted)">No tags yet</small>';

  const titles = {all:['All Notes','Showing all active notes'],pinned:['Pinned','Notes you pinned to the top'],favorites:['Favorites','Your starred notes'],trash:['Trash','Deleted notes can be restored']};
  let [t, s] = titles[ui.view];
  if (ui.cat) { t = ui.cat; s = `Notes in the ${ui.cat} category`; }
  if (ui.tag) { t = '#'+ui.tag; s = 'Notes with this tag'; }
  $('#viewTitle').textContent = t; $('#viewSub').textContent = s;
  $('#emptyTrash').classList.toggle('hidden', ui.view!=='trash' || !state.notes.some(n=>n.trashed));

  const list = visible(), area = $('#notesArea');
  if (!list.length) {
    area.innerHTML = `<div class="empty"><div class="big">☁️</div><h3>No Notes Found</h3><p>Start capturing ideas, tasks, or study materials in your notebook.</p>${ui.view==='trash'?'':'<button class="btn primary" id="emptyCreate">Create Note</button>'}</div>`;
  } else {
    const pinned = list.filter(n=>n.pinned && ui.view!=='trash'), others = list.filter(n=>!(n.pinned && ui.view!=='trash'));
    area.innerHTML = (pinned.length ? `<div class="section-label">PINNED NOTES</div><div class="grid">${pinned.map(card).join('')}</div>` : '')
      + (others.length ? (pinned.length ? '<div class="section-label">OTHER NOTES</div>' : '') + `<div class="grid">${others.map(card).join('')}</div>` : '');
  }
  updateQuota();
}
function card(n){
  const tr = n.trashed;
  return `<div class="card" data-id="${n.id}" style="--cc:${n.color||catColor(n.category)}">
    <h3><span>${esc(n.title||'Untitled')}</span><span>${n.pinned?'📌':''}${n.fav?'⭐':''}</span></h3>
    <p>${esc(n.body.slice(0,260))||'<em>Empty note</em>'}</p>
    <div class="meta"><span class="chip">${esc(n.category)}</span>${n.tags.map(t=>`<span class="chip">#${esc(t)}</span>`).join('')}<span style="margin-left:auto">${new Date(n.updated).toLocaleDateString()}</span></div>
    <div class="actions">${tr
      ? `<button data-act="restore" title="Restore">♻️</button><button data-act="purge" title="Delete forever">❌</button>`
      : `<button data-act="pin" title="Pin">📌</button><button data-act="fav" title="Favorite">⭐</button><button data-act="share" title="Share">🔗</button><button data-act="dup" title="Duplicate">📄</button><button data-act="trash" title="Move to trash">🗑</button>`}</div></div>`;
}
function size(){ return new Blob([JSON.stringify(state.notes)]).size; }
function fmtSize(b){ return b<1024*1024 ? Math.max(1,Math.round(b/1024))+' KB' : (b/1048576).toFixed(1)+' MB'; }
function updateQuota(){ const b = size(); $('#quotaText').textContent = `${fmtSize(b)} / 50 MB`; $('#quotaBar').style.width = Math.max(1, b/QUOTA*100)+'%'; }

/* Modals */
const open = id => $('#'+id).classList.add('open'), close = id => $('#'+id).classList.remove('open');
$$('[data-close]').forEach(b => b.onclick = () => close(b.dataset.close));
$$('.modal').forEach(m => m.addEventListener('mousedown', e => { if (e.target===m) m.classList.remove('open'); }));

/* Editor */
function openEditor(id){
  ui.editing = id || null;
  const n = id ? state.notes.find(x=>x.id===id) : null;
  $('#noteCat').innerHTML = state.categories.map(c=>`<option ${n&&n.category===c?'selected':''}>${esc(c)}</option>`).join('');
  $('#noteTitle').value = n ? n.title : ''; $('#noteBody').value = n ? n.body : '';
  $('#noteTags').value = n ? n.tags.join(', ') : ''; $('#noteColor').value = n ? (n.color||'') : '';
  if (!n && ui.cat) $('#noteCat').value = ui.cat;
  setTab('edit'); stats(); open('editorModal'); $('#noteTitle').focus();
}
function stats(){ const t=$('#noteBody').value, w=words(t); $('#wordStats').textContent = `${w} words • ${t.length} chars • ${Math.max(1,Math.ceil(w/200))} min read`; }
function setTab(t){
  $$('.tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===t));
  $('#noteBody').classList.toggle('hidden', t!=='edit'); $('#notePreview').classList.toggle('hidden', t!=='preview');
  if (t==='preview') $('#notePreview').innerHTML = md($('#noteBody').value) || '<em>Nothing to preview</em>';
}
$$('.tab').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
$('#noteBody').addEventListener('input', stats);
const FMT = {bold:['**','**','bold'],italic:['*','*','italic'],strike:['~~','~~','text'],code:['`','`','code'],
  h1:['# ','','Heading'],h2:['## ','','Heading'],h3:['### ','','Heading'],ul:['- ','','List item'],ol:['1. ','','List item'],task:['- [ ] ','','Task'],quote:['> ','','Quote']};
$$('[data-md]').forEach(b => b.onclick = () => {
  const ta = $('#noteBody'); setTab('edit'); const a = ta.selectionStart, z = ta.selectionEnd;
  let ins;
  if (b.dataset.md==='time') ins = new Date().toLocaleString();
  else { const [p,s,d] = FMT[b.dataset.md]; ins = p + (ta.value.slice(a,z)||d) + s; }
  ta.setRangeText(ins, a, z, 'end'); ta.focus(); stats();
});
$('#saveNote').onclick = () => {
  const title = $('#noteTitle').value.trim(), body = $('#noteBody').value;
  if (!title && !body.trim()) return toast('Add a title or some content first');
  const tags = [...new Set($('#noteTags').value.split(',').map(t=>t.trim().replace(/^#/,'')).filter(Boolean))];
  const data = { title: title||'Untitled', body, category:$('#noteCat').value, tags, color:$('#noteColor').value, updated:Date.now() };
  if (ui.editing) Object.assign(state.notes.find(n=>n.id===ui.editing), data);
  else state.notes.push({ id:uid(), created:Date.now(), pinned:false, fav:false, trashed:false, ...data });
  save(); close('editorModal'); render(); toast('Note saved; syncing to backend');
};

/* Note actions */
$('#notesArea').addEventListener('click', e => {
  if (e.target.id==='emptyCreate') return openEditor();
  const c = e.target.closest('.card'); if (!c) return;
  const n = state.notes.find(x=>x.id===c.dataset.id), act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return n.trashed ? toast('Restore this note to edit it') : openEditor(n.id);
  if (act==='pin') n.pinned=!n.pinned;
  else if (act==='fav') n.fav=!n.fav;
  else if (act==='trash') { n.trashed=true; n.pinned=false; toast('Moved to trash'); }
  else if (act==='restore') { n.trashed=false; toast('Note restored'); }
  else if (act==='purge') { if(!confirm('Delete this note forever?')) return; state.notes=state.notes.filter(x=>x!==n); }
  else if (act==='dup') state.notes.push({...n, id:uid(), title:n.title+' (copy)', created:Date.now(), updated:Date.now(), pinned:false});
  else if (act==='share') return openShare(n);
  save(); render();
});
$('#emptyTrash').onclick = () => { if(confirm('Permanently delete all trashed notes?')){ state.notes=state.notes.filter(n=>!n.trashed); save(); render(); } };

/* Sidebar */
$('.sidebar').addEventListener('click', e => {
  const v = e.target.closest('[data-view]'), c = e.target.closest('[data-cat]'), t = e.target.closest('[data-tag]');
  if (v) { ui.view=v.dataset.view; ui.cat=ui.tag=null; }
  else if (c) { ui.cat = ui.cat===c.dataset.cat ? null : c.dataset.cat; ui.view='all'; ui.tag=null; }
  else if (t) { ui.tag = ui.tag===t.dataset.tag ? null : t.dataset.tag; ui.view='all'; ui.cat=null; }
  else return;
  $('#sidebar').classList.remove('open'); render();
});
$('#addCatBtn').onclick = () => { $('#newCatName').value=''; open('catModal'); $('#newCatName').focus(); };
$('#saveCat').onclick = () => {
  const n = $('#newCatName').value.trim();
  if (!n) return; if (state.categories.includes(n)) return toast('Category already exists');
  state.categories.push(n); save(); close('catModal'); render();
};
$('#newCatName').addEventListener('keydown', e => e.key==='Enter' && $('#saveCat').click());
['#newNoteBtn','#newNoteBtn2'].forEach(s => $(s).onclick = () => openEditor());
$('#menuBtn').onclick = () => $('#sidebar').classList.add('open');
$('#closeSide').onclick = () => $('#sidebar').classList.remove('open');
$('#themeBtn').onclick = () => { state.dark=!state.dark; save(); render(); };
$('#search').addEventListener('input', e => { ui.q=e.target.value; render(); });
$('#sortSel').onchange = e => { ui.sort=e.target.value; render(); };
document.addEventListener('keydown', e => {
  if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='k') { e.preventDefault(); $('#search').focus(); }
  if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='s' && $('#editorModal').classList.contains('open')) { e.preventDefault(); $('#saveNote').click(); }
  if (e.key==='Escape') $$('.modal.open').forEach(m=>m.classList.remove('open'));
});

/* Analytics */
$('#analyticsBtn').onclick = () => {
  const a = state.notes.filter(n=>!n.trashed);
  $('#stTotal').textContent = a.length; $('#stWords').textContent = a.reduce((s,n)=>s+words(n.body),0);
  $('#stSpace').textContent = fmtSize(size()); $('#stPinned').textContent = a.filter(n=>n.pinned).length;
  $('#catDist').innerHTML = state.categories.map(c => { const k=a.filter(n=>n.category===c).length, p=a.length?k/a.length*100:0;
    return `<div class="dist-row"><span class="lab">${esc(c)}</span><div class="track"><div class="fill" style="width:${p}%;background:${catColor(c)}"></div></div><span>${k}</span></div>`; }).join('');
  open('analyticsModal');
};

/* Backup */
$('#backupBtn').onclick = () => open('backupModal');
function download(name, text, type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type})); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
$('#exportBtn').onclick = () => { download(`notenest-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(state,null,2), 'application/json'); toast('Backup downloaded'); };
$('#importBtn').onclick = () => $('#importFile').click();
$('#importFile').onchange = e => {
  const f = e.target.files[0]; if (!f) return; const r = new FileReader();
  r.onload = () => { try {
    const d = JSON.parse(r.result); if (!Array.isArray(d.notes)) throw 0;
    const ids = new Set(state.notes.map(n=>n.id)); let added = 0;
    d.notes.forEach(n => { if (!ids.has(n.id)) { state.notes.push({tags:[],body:'',title:'Untitled',category:'Personal',...n}); added++; } });
    (d.categories||[]).forEach(c => !state.categories.includes(c) && state.categories.push(c));
    save(); render(); close('backupModal'); toast(`Restored ${added} note(s)`);
  } catch { toast('Invalid backup file'); } e.target.value=''; };
  r.readAsText(f);
};

/* Share */
function noteText(n){ return `# ${n.title}\n\nCategory: ${n.category}${n.tags.length?'\nTags: '+n.tags.map(t=>'#'+t).join(' '):''}\n\n${n.body}`; }
function openShare(n){ ui.sharing=n; $('#shareLink').value = `${location.origin}${location.pathname}#note=${n.id}`; open('shareModal'); }
$('#copyLink').onclick = () => navigator.clipboard.writeText($('#shareLink').value).then(()=>toast('Link copied'));
$('#copyText').onclick = () => navigator.clipboard.writeText(noteText(ui.sharing)).then(()=>toast('Text copied'));
$('#dlMd').onclick = () => download((ui.sharing.title||'note').replace(/[^\w-]+/g,'_')+'.md', noteText(ui.sharing), 'text/markdown');
$('#printNote').onclick = () => {
  let p = $('#printArea'); if (!p) { p=document.createElement('div'); p.id='printArea'; document.body.appendChild(p); }
  p.innerHTML = `<h1>${esc(ui.sharing.title)}</h1>` + md(ui.sharing.body); window.print();
};

render();
initializeBackend();
})();
