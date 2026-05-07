// ── CONFIG (edit these after deploying) ──────────────────────────────────
// These are stored in localStorage after first setup, so only needed once.
const CONFIG_KEYS = { token: 'at_gh_token', repo: 'at_gh_repo', path: 'at_gh_path' };
const DEFAULT_FILENAME = 'asset_tracker_data.json';
// ─────────────────────────────────────────────────────────────────────────

let statuses = {}, tags = {}, assets = [], videoLinks = {};
let activeFilter = new Set(), activeTagFilter = null, searchQuery = '';
let activeImgHandle = null, activeWorkHandle = null, activeVideoHandle = null;
let tagTarget = null;
let ghFileSha = null;
let editMode = false;
let videoBlobMap = {}; // filename (no ext) → blob URL, populated at runtime
let saveTimer, toastT, searchTimer, zoomRaf, _lastHideNames = null;
const STATUS_CYCLE = [null,'green','red','yellow','blue'];

// ── LOCALSTORAGE CONFIG ──
const getCfg = k => localStorage.getItem(CONFIG_KEYS[k]) || '';
const setCfg = (k,v) => localStorage.setItem(CONFIG_KEYS[k], v);
const hasCfg = () => getCfg('token') && getCfg('repo') && getCfg('path');

// ── INDEXEDDB (image folder handle only) ──
const dbP = new Promise(res => { try { const r=indexedDB.open('AssetTrackerV4',1); r.onupgradeneeded=e=>{ const db=e.target.result; if(!db.objectStoreNames.contains('h')) db.createObjectStore('h'); if(!db.objectStoreNames.contains('thumbs')) db.createObjectStore('thumbs'); }; r.onsuccess=e=>res(e.target.result); r.onerror=()=>res(null); } catch{res(null);} });
async function saveH(k,v){try{const db=await dbP;if(!db)return;db.transaction('h','readwrite').objectStore('h').put(v,k);}catch{}}
async function getH(k){try{const db=await dbP;if(!db)return null;return new Promise(r=>{const q=db.transaction('h').objectStore('h').get(k);q.onsuccess=()=>r(q.result);q.onerror=()=>r(null)});}catch{return null;}}
async function clearH(){try{const db=await dbP;if(!db)return;db.transaction('h','readwrite').objectStore('h').clear();}catch{}}
async function getThumb(k){try{const db=await dbP;if(!db)return null;return new Promise(r=>{const q=db.transaction('thumbs').objectStore('thumbs').get(k);q.onsuccess=()=>r(q.result||null);q.onerror=()=>r(null)});}catch{return null;}}
async function saveThumb(k,blob){try{const db=await dbP;if(!db)return;db.transaction('thumbs','readwrite').objectStore('thumbs').put(blob,k);}catch{}}
async function clearThumbs(){try{const db=await dbP;if(!db)return;db.transaction('thumbs','readwrite').objectStore('thumbs').clear();}catch{}}

// ── SIZE ──
const SIZES = { xs: 70, s: 110, m: 150, l: 220 };
function setSize(key){
  const v = SIZES[key];
  document.documentElement.style.setProperty('--cell', v+'px');
  document.body.classList.toggle('hide-names', v < 90);
  ['xs','s','m','l'].forEach(k => document.getElementById('sz-'+k).classList.toggle('active', k===key));
  localStorage.setItem('atZoom', key);
  if(!localStorage.getItem('atDot') && !localStorage.getItem('atTint')){
    const dotOn = key !== 'xs';
    document.getElementById('dot-toggle').checked = dotOn;
    document.body.classList.toggle('no-dot', !dotOn);
    document.getElementById('tint-toggle').checked = true;
    document.body.classList.remove('no-tint');
  }
}
const savedSize = localStorage.getItem('atZoom') || 'm';
const validSize = SIZES[savedSize] ? savedSize : 'm';
setSize(validSize);

// ── THEME ──
function setTheme(t){
  document.body.classList.remove('theme-light','theme-bolt');
  if(t==='light') document.body.classList.add('theme-light');
  if(t==='bolt')  document.body.classList.add('theme-bolt');
  ['dark','light','bolt'].forEach(k=>document.getElementById('th-'+k).classList.toggle('active',k===t));
  localStorage.setItem('atTheme',t);
}
setTheme(localStorage.getItem('atTheme')||'dark');

// ── TINT ──
const tintToggle = document.getElementById('tint-toggle');
tintToggle.checked = localStorage.getItem('atTint') !== 'off';
document.body.classList.toggle('no-tint', !tintToggle.checked);
tintToggle.addEventListener('change', () => { document.body.classList.toggle('no-tint', !tintToggle.checked); localStorage.setItem('atTint', tintToggle.checked ? 'on' : 'off'); });

// ── DOT ──
const dotToggle = document.getElementById('dot-toggle');
if(localStorage.getItem('atDot') !== null){
  dotToggle.checked = localStorage.getItem('atDot') !== 'off';
} else {
  dotToggle.checked = validSize !== 'xs';
}
document.body.classList.toggle('no-dot', !dotToggle.checked);
dotToggle.addEventListener('change', () => { document.body.classList.toggle('no-dot', !dotToggle.checked); localStorage.setItem('atDot', dotToggle.checked ? 'on' : 'off'); });

const imgOnlyToggle = document.getElementById('imgonly-toggle');
imgOnlyToggle.checked = localStorage.getItem('atImgOnly') === 'on';
document.body.classList.toggle('images-only', imgOnlyToggle.checked);
imgOnlyToggle.addEventListener('change', () => { document.body.classList.toggle('images-only', imgOnlyToggle.checked); localStorage.setItem('atImgOnly', imgOnlyToggle.checked ? 'on' : 'off'); });

// ── SEARCH ──
const searchInput = document.getElementById('search-input');
searchInput.addEventListener('input', e=>{
  searchInput.classList.toggle('has-value', !!e.target.value);
  clearTimeout(searchTimer);
  searchTimer=setTimeout(()=>{searchQuery=e.target.value.trim().toLowerCase();render();},80);
});
document.getElementById('search-clear').addEventListener('click', clearSearch);
document.getElementById('sb-clr').addEventListener('click', clearSearch);
function clearSearch(){searchInput.value='';searchInput.classList.remove('has-value');searchQuery='';render();}

// ── TOAST & STATUS ──
function toast(m,d=2400){const el=document.getElementById('toast');el.textContent=m;el.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>el.classList.remove('show'),d);}
function setStatus(s,t){document.getElementById('status-bar').className=s;document.getElementById('status-text').textContent=t;}

// ── HELPERS ──
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function hi(text,q){if(!q)return esc(text);const i=text.toLowerCase().indexOf(q);if(i<0)return esc(text);return esc(text.slice(0,i))+'<mark>'+esc(text.slice(i,i+q.length))+'</mark>'+esc(text.slice(i+q.length));}

// ── GITHUB API ──
function ghHeaders(){ return { 'Authorization': 'token '+getCfg('token'), 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }; }
function ghUrl(){ return `https://api.github.com/repos/${getCfg('repo')}/contents/${getCfg('path')}`; }

async function ghLoad(){
  setStatus('saving','Loading from GitHub…');
  try {
    const res = await fetch(ghUrl(), { headers: ghHeaders() });
    if(res.status === 404){
      ghFileSha = null;
      setStatus('synced','Ready');
      return {statuses:{}, tags:{}, videoLinks:{}};
    }
    if(!res.ok) throw new Error('HTTP '+res.status);
    const json = await res.json();
    ghFileSha = json.sha;
    const raw = JSON.parse(atob(json.content.replace(/\n/g,'')));
    if(raw.statuses !== undefined || raw.tags !== undefined) return {statuses: raw.statuses||{}, tags: raw.tags||{}, videoLinks: raw.videoLinks||{}};
    return {statuses: raw, tags: {}, videoLinks: {}};
  } catch(e){
    setStatus('error', 'GitHub error');
    toast('⚠ Could not load from GitHub: '+e.message);
    return {statuses:{}, tags:{}, videoLinks:{}};
  }
}

let ghSavePromise = Promise.resolve();
function ghSave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(()=>{
    ghSavePromise = ghSavePromise.then(async ()=>{
      try {
        setStatus('saving','Saving…');
        const content = btoa(unescape(encodeURIComponent(JSON.stringify({statuses,tags,videoLinks},null,2))));
        const body = { message: 'Update asset statuses', content };
        if(ghFileSha) body.sha = ghFileSha;
        const res = await fetch(ghUrl(), { method:'PUT', headers: ghHeaders(), body: JSON.stringify(body) });
        if(res.status === 409){
          const fresh = await fetch(ghUrl(), { headers: ghHeaders() });
          if(fresh.ok){ const fj = await fresh.json(); ghFileSha = fj.sha; }
          const body2 = { message: 'Update asset statuses', content };
          if(ghFileSha) body2.sha = ghFileSha;
          const res2 = await fetch(ghUrl(), { method:'PUT', headers: ghHeaders(), body: JSON.stringify(body2) });
          if(!res2.ok) throw new Error('HTTP '+res2.status);
          const json2 = await res2.json();
          ghFileSha = json2.content.sha;
        } else {
          if(!res.ok) throw new Error('HTTP '+res.status);
          const json = await res.json();
          ghFileSha = json.content.sha;
        }
        setStatus('synced','Saved');
      } catch(e){
        console.error('[ghSave]', e);
        setStatus('error','Save failed');
        toast('⚠ Could not save: '+e.message);
      }
    });
  }, 800);
}

// ── INIT ──
async function init(){
  if(!hasCfg()){
    renderSetup();
    return;
  }
  const d = await ghLoad();
  statuses = d.statuses; tags = d.tags; videoLinks = d.videoLinks;
  setStatus('synced','Loaded');

  const imgH = await getH('img');
  const workH = await getH('work');
  const videoH = await getH('video');
  updateImgBtn(imgH);
  updateVideoBtn(videoH);

  if(imgH){
    try {
      const perm = await imgH.queryPermission({mode:'read'});
      if(perm === 'granted'){
        activeImgHandle = imgH;
        activeWorkHandle = workH || null;
        if(videoH){ const vp = await videoH.queryPermission({mode:'read'}); if(vp==='granted'){ activeVideoHandle=videoH; await buildVideoBlobMap(); } }
        await loadImages();
        document.getElementById('btn-scan').disabled = false;
        return;
      }
      showImgBanner(imgH.name);
    } catch(e){ showImgBanner(imgH ? imgH.name : ''); }
  } else {
    renderNeedsImages();
  }
}

// ── SETUP SCREEN ──
function renderSetup(){
  document.getElementById('app').innerHTML='';
  document.getElementById('setup-screen').innerHTML=`
    <div class="setup-title">Set up <span>Asset Tracker</span></div>
    <p class="setup-sub">One-time setup. Your token and repo are saved in your browser's localStorage — they never leave your machine.</p>

    <div class="setup-card" id="sc-token">
      <h3><span class="step-badge">1</span> GitHub Personal Access Token</h3>
      <p>Create a token at <a href="https://github.com/settings/tokens/new" target="_blank" style="color:var(--blue)">github.com/settings/tokens/new</a>.<br>
      Scopes needed: tick <code>repo</code> (or just <code>public_repo</code> if your repo is public).<br>
      Copy the token — you only see it once.</p>
      <div class="setup-input-row">
        <input class="setup-input" id="inp-token" type="password" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" value="${getCfg('token')}">
        <button class="setup-btn" onclick="saveToken()">Save</button>
      </div>
    </div>

    <div class="setup-card" id="sc-repo">
      <h3><span class="step-badge">2</span> Repository & file path</h3>
      <p>The repo where your data file will live, and the path to the JSON file inside it.<br>
      Example repo: <code>yourname/asset-tracker</code><br>
      Example path: <code>data/asset_tracker_data.json</code></p>
      <div class="setup-input-row" style="margin-bottom:8px">
        <input class="setup-input" id="inp-repo" placeholder="username/repo-name" value="${getCfg('repo')}">
      </div>
      <div class="setup-input-row">
        <input class="setup-input" id="inp-path" placeholder="data/asset_tracker_data.json" value="${getCfg('path')||DEFAULT_FILENAME}">
        <button class="setup-btn" onclick="saveRepo()">Save</button>
      </div>
    </div>

    <div class="setup-card" id="sc-go">
      <h3><span class="step-badge">3</span> Connect</h3>
      <p>Test the connection and load your data.</p>
      <button class="setup-btn" onclick="testAndConnect()">Connect to GitHub →</button>
    </div>

    <div class="setup-hint">
      💡 <strong>Hosting tip:</strong> Push <code>index.html</code> to the same repo, enable GitHub Pages (Settings → Pages → Deploy from branch → main), and your tracker will be live at <code>https://yourname.github.io/asset-tracker</code>.
    </div>`;
  document.getElementById('setup-screen').style.display='block';
}

function saveToken(){
  const v = document.getElementById('inp-token').value.trim();
  if(!v){ toast('Paste your token first'); return; }
  setCfg('token', v);
  document.getElementById('sc-token').classList.add('done');
  toast('✓ Token saved');
}
function saveRepo(){
  const r = document.getElementById('inp-repo').value.trim();
  const p = document.getElementById('inp-path').value.trim() || DEFAULT_FILENAME;
  if(!r){ toast('Enter your repo name first'); return; }
  setCfg('repo', r); setCfg('path', p);
  document.getElementById('sc-repo').classList.add('done');
  toast('✓ Repo saved');
}
async function testAndConnect(){
  if(!getCfg('token') || !getCfg('repo')){ toast('Save token and repo first'); return; }
  setStatus('saving','Connecting…');
  try {
    const res = await fetch(`https://api.github.com/repos/${getCfg('repo')}`, { headers: ghHeaders() });
    if(res.status === 401){ toast('⚠ Token invalid or expired'); setStatus('error','Auth error'); return; }
    if(res.status === 404){ toast('⚠ Repo not found — check the name'); setStatus('error','Repo not found'); return; }
    if(!res.ok) throw new Error('HTTP '+res.status);
  } catch(e){ toast('⚠ '+e.message); setStatus('error','Error'); return; }
  document.getElementById('setup-screen').innerHTML='';
  document.getElementById('setup-screen').style.display='none';
  init();
}

// ── NEEDS IMAGES SCREEN ──
function renderNeedsImages(){
  document.getElementById('setup-screen').style.display='block';
  document.getElementById('setup-screen').innerHTML=`
    <div class="setup-title">Link your <span>images</span></div>
    <p class="setup-sub">GitHub is connected ✓. Now point to your local Dropbox images folder. This is remembered in your browser.</p>
    <div class="setup-card">
      <h3><span class="step-badge">🖼</span> Images folder</h3>
      <p>Select the root folder containing your illustration PNGs, organised into sub-folders by category.</p>
      <button class="setup-btn" onclick="linkImgFolder()">Choose images folder →</button>
    </div>`;
  setStatus('synced','Choose images folder');
}

function renderNeedsPermission(imgH){
  document.getElementById('setup-screen').style.display='block';
  document.getElementById('setup-screen').innerHTML=`
    <div class="setup-title">Ready to <span>load</span></div>
    <p class="setup-sub">Click below to load your images from <strong>${esc(imgH.name)}</strong>.</p>
    <div class="setup-card">
      <button class="setup-btn" onclick="reGrantPermission()">Load images →</button>
      <br><br>
      <button class="setup-btn secondary" style="margin-top:10px" onclick="linkImgFolder()">Choose a different folder</button>
    </div>`;
  setStatus('synced','Click to load images');
}

function showImgBanner(folderName){
  const b = document.getElementById('img-banner');
  document.getElementById('img-banner-text').textContent = '🖼 Click to load ' + (folderName || 'images');
  b.style.display = 'flex';
  setStatus('synced', 'Click banner to load images');
}

async function syncImages(){
  const imgH = await getH('img');
  if(!imgH){ renderNeedsImages(); return; }
  try {
    const perm = await imgH.requestPermission({mode:'read'});
    if(perm !== 'granted'){ toast('Permission denied'); return; }
    activeImgHandle = imgH;
    const workH = await getH('work');
    activeWorkHandle = workH || null;
    document.getElementById('setup-screen').innerHTML='';
    document.getElementById('setup-screen').style.display='none';
    document.getElementById('img-banner').style.display='none';
    updateImgBtn(imgH);
    document.getElementById('btn-scan').disabled = false;
    await loadImages();
  } catch(e){ toast('Could not load images'); }
}

async function reGrantPermission(){ await syncImages(); }

// ── LINK IMAGE FOLDER ──
async function linkImgFolder(){
  if(!window.showDirectoryPicker){ toast('Requires Chrome or Edge'); return; }
  try {
    const h = await showDirectoryPicker({mode:'read'});
    await saveH('img', h);
    activeImgHandle = h;
    updateImgBtn(h);
    document.getElementById('setup-screen').innerHTML='';
    document.getElementById('setup-screen').style.display='none';
    await loadImages();
  } catch(e){ if(e.name !== 'AbortError') toast('Could not open folder'); }
}

async function linkWorkFolder(){
  if(!window.showDirectoryPicker){ toast('Requires Chrome or Edge'); return; }
  try {
    const h = await showDirectoryPicker({mode:'read'});
    await saveH('work', h);
    activeWorkHandle = h;
    toast('✓ Work folder linked');
  } catch(e){}
}

function updateImgBtn(h){
  const btn = document.getElementById('btn-images');
  if(h){ btn.textContent = '🖼 Illustrations linked'; btn.title = h.name; }
  else { btn.textContent = '🖼 Link Images'; }
}

function updateVideoBtn(h){
  const btn = document.getElementById('btn-videos');
  if(h){ btn.textContent = '🎬 Videos linked'; btn.title = h.name; btn.style.borderColor='var(--blue)'; btn.style.color='var(--blue)'; }
  else { btn.textContent = '🎬 Link Videos'; btn.style.borderColor=''; btn.style.color=''; }
}

async function linkVideoFolder(){
  if(!window.showDirectoryPicker){ toast('Requires Chrome or Edge'); return; }
  try {
    const h = await showDirectoryPicker({mode:'read'});
    await saveH('video', h);
    activeVideoHandle = h;
    updateVideoBtn(h);
    await buildVideoBlobMap();
    toast('✓ Videos linked — auto-matched');
  } catch(e){ if(e.name !== 'AbortError') toast('Could not open folder'); }
}

async function buildVideoBlobMap(){
  if(!activeVideoHandle) return;
  videoBlobMap = {};
  async function scanDir(dirH){
    for await(const [name, h] of dirH.entries()){
      if(h.kind==='file' && /\.(mp4|webm|mov)$/i.test(name)){
        const base = name.replace(/\.[^/.]+$/,'').toLowerCase();
        const f = await h.getFile();
        videoBlobMap[base] = URL.createObjectURL(f);
      } else if(h.kind==='directory') await scanDir(h);
    }
  }
  await scanDir(activeVideoHandle);
  let changed = 0;
  const videoKeys = Object.keys(videoBlobMap);
  assets.forEach(cat => cat.items.forEach(item => {
    const manualVideoName = videoLinks[item.name];
    if(manualVideoName){
      const manualBase = manualVideoName.replace(/\.[^/.]+$/,'').toLowerCase();
      if(videoBlobMap[manualBase] && item.status !== 'blue'){ item.status='blue'; statuses[item.name]='blue'; changed++; }
      return;
    }
    const base = item.name.replace(/\.[^/.]+$/,'').toLowerCase();
    const stripped = base.replace(/_[\w\d]+$/, '');
    const hasVideo = !!videoBlobMap[base] || (stripped.length >= 5 && videoKeys.some(k => k.startsWith(stripped)));
    if(hasVideo && item.status !== 'blue'){ item.status='blue'; statuses[item.name]='blue'; changed++; }
  }));
  if(changed){ render(); ghSave(); toast(`🎬 ${changed} illustrations marked animated`); }
}

function getVideoSrc(item){
  const manualBase = videoLinks[item.name] ? videoLinks[item.name].replace(/\.[^/.]+$/,'').toLowerCase() : null;
  if(manualBase) return videoBlobMap[manualBase] || null;

  const autoBase = item.name.replace(/\.[^/.]+$/,'').toLowerCase();
  if(videoBlobMap[autoBase]) return videoBlobMap[autoBase];
  const stripped = autoBase.replace(/_[\w\d]+$/, '');
  const videoKeys = Object.keys(videoBlobMap);
  const match = videoKeys.find(k => k.startsWith(stripped) && stripped.length >= 5);
  return match ? videoBlobMap[match] : null;
}

// ── LOAD IMAGES ──
async function collectImages(dirH, arr){
  for await(const [name,h] of dirH.entries()){
    if(h.kind==='file'){
      const f = await h.getFile();
      if(f.type.startsWith('image/'))
        arr.push({name:f.name, src:null, fullSrc:URL.createObjectURL(f), fileRef:f, status:statuses[f.name]||null, tags:[...(tags[f.name]||[])]});
    } else if(h.kind==='directory') await collectImages(h, arr);
  }
}

async function generateThumb(file, maxSize=220){
  return new Promise(res=>{
    const img=new Image(); img.onload=()=>{
      const scale=Math.min(1, maxSize/Math.max(img.width,img.height));
      const w=Math.round(img.width*scale), h=Math.round(img.height*scale);
      const c=document.createElement('canvas'); c.width=w; c.height=h;
      const ctx=c.getContext('2d');
      ctx.clearRect(0,0,w,h);
      ctx.drawImage(img,0,0,w,h);
      c.toBlob(b=>{ if(b) res(b); else c.toBlob(b2=>res(b2),'image/png'); },'image/webp',0.85);
    }; img.onerror=()=>res(null);
    img.src=URL.createObjectURL(file);
  });
}

async function loadImages(){
  setStatus('saving','Loading images…');
  assets = [];
  for await(const [name,h] of activeImgHandle.entries()){
    if(h.kind==='directory'){
      const items = []; await collectImages(h, items);
      items.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}));
      if(items.length) assets.push({categoryName:name, items});
    }
  }
  assets.sort((a,b)=>a.categoryName.localeCompare(b.categoryName));

  let thumbMisses = [];
  await Promise.all(assets.flatMap(cat=>cat.items.map(async item=>{
    const blob = await getThumb(item.name);
    if(blob){ item.src = URL.createObjectURL(blob); }
    else { item.src = item.fullSrc; thumbMisses.push(item); }
  })));

  setStatus('synced','Ready');
  render();

  if(thumbMisses.length){
    setStatus('saving', `Generating ${thumbMisses.length} thumbnails…`);
    let done=0;
    const BATCH=8;
    for(let i=0;i<thumbMisses.length;i+=BATCH){
      const batch=thumbMisses.slice(i,i+BATCH);
      await Promise.all(batch.map(async item=>{
        const blob = await generateThumb(item.fileRef);
        if(!blob) return;
        await saveThumb(item.name, blob);
        const thumbUrl = URL.createObjectURL(blob);
        item.src = thumbUrl;
        assets.forEach((cat,ci)=>{ const ii=cat.items.indexOf(item); if(ii>=0){ const card=document.querySelector(`.asset-item[data-ci="${ci}"][data-ii="${ii}"]`); if(card){ const el=card.querySelector('img'); if(el) el.src=thumbUrl; } } });
        done++;
      }));
      setStatus('saving',`Generating thumbnails… ${done}/${thumbMisses.length}`);
      await new Promise(r=>setTimeout(r,0));
    }
    setStatus('synced','Ready');
  }
}

// ── AUTO SCAN ──
function fuzzyMatch(ib, fn){
  const ci = ib.toLowerCase().replace(/[^a-z0-9]/g,'');
  const cf = fn.toLowerCase().replace(/[^a-z0-9]/g,'');
  if(!ci || !cf) return false;
  if(ci === cf) return true;
  if(ci.length >= 5 && cf.includes(ci)) return true;
  if(cf.length >= 5 && ci.includes(cf)) return true;
  const wi = ib.toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>2);
  const wf = fn.toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>2);
  if(wi.length >= 2 && wi.filter(w=>wf.includes(w)).length / wi.length >= 0.75) return true;
  if(ci.length < 6 || cf.length < 6) return false;
  const dp=Array(ci.length+1).fill(0).map(()=>Array(cf.length+1).fill(0)); let mx=0;
  for(let i=1;i<=ci.length;i++) for(let j=1;j<=cf.length;j++) if(ci[i-1]===cf[j-1]){dp[i][j]=dp[i-1][j-1]+1;mx=Math.max(mx,dp[i][j]);}
  return mx>=6 && mx/ci.length>=0.75 && mx/cf.length>=0.75;
}
async function collectWorkNames(dirH, arr, depth){
  depth = depth||0;
  for await(const [name,h] of dirH.entries()){
    if(h.kind==='file'){
      arr.push(name.replace(/\.[^/.]+$/,'').toLowerCase());
    } else if(h.kind==='directory'){
      arr.push(name.toLowerCase());
      await collectWorkNames(h, arr, depth+1);
    }
    if(arr.length % 200 === 0){
      setStatus('saving', `Scanning… ${arr.length} found`);
      await new Promise(r=>setTimeout(r,0));
    }
  }
}
async function autoScanWorkFiles(){
  if(!activeWorkHandle){
    await linkWorkFolder();
    if(!activeWorkHandle) return;
  }
  if(!assets.length){ toast('Load images first'); return; }
  setStatus('saving','Scanning…');
  const names=[];
  await collectWorkNames(activeWorkHandle, names);
  setStatus('saving',`Matching ${names.length} entries…`);
  await new Promise(r=>setTimeout(r,0));
  let changed=0;
  assets.forEach(cat=>cat.items.forEach(item=>{
    if(item.status==='blue'||item.status==='green') return;
    const base=item.name.replace(/\.[^/.]+$/,'').toLowerCase();
    const found=names.some(n=>fuzzyMatch(base,n));
    const next = found ? 'green' : (item.status==='yellow' ? 'yellow' : 'red');
    if(item.status!==next){item.status=next;statuses[item.name]=next;changed++;}
  }));
  if(changed){render();ghSave();setStatus('synced','Ready');toast(`✓ Scan done — ${changed} updated`);}
  else{toast('✓ Scan done — nothing changed');setStatus('synced','Ready');}
}

// ── VISIBILITY ──
function itemVisible(item){
  if(activeFilter.size>0&&!activeFilter.has(item.status||null)) return false;
  if(activeTagFilter&&!(item.tags||[]).includes(activeTagFilter)) return false;
  if(searchQuery){
    const words = searchQuery.split(/\s+/).filter(Boolean);
    const itemTags = (item.tags||[]).map(t=>t.toLowerCase());
    const itemName = item.name.toLowerCase();
    if(!words.every(w => itemName.includes(w) || itemTags.some(t=>t.includes(w)))) return false;
  }
  return true;
}

// ── FILTER ──
function setFilter(f){
  if(f===null){
    activeFilter.clear();
  } else {
    if(activeFilter.has(f)) activeFilter.delete(f); else activeFilter.add(f);
  }
  ['green','red','yellow','blue'].forEach(k=>document.getElementById('f-'+k).classList.toggle('active', activeFilter.has(k)));
  document.getElementById('f-all').classList.toggle('active', activeFilter.size===0);
  render();
}

function getAllTags(){const m={};assets.forEach(c=>c.items.forEach(i=>(i.tags||[]).forEach(t=>{m[t]=(m[t]||0)+1;})));return m;}

let tagListExpanded = false;
const TAG_COMPACT_LIMIT = 30;

function toggleTagExpand(){
  tagListExpanded = !tagListExpanded;
  buildTagFilterSidebar();
}

function buildTagFilterSidebar(){
  const all=getAllTags(),keys=Object.keys(all).sort();
  const sec=document.getElementById('tag-filter-section'),list=document.getElementById('tag-filter-list');
  if(!keys.length){sec.style.display='none';return;}
  sec.style.display='block'; list.innerHTML='';
  const showAll = tagListExpanded || keys.length <= TAG_COMPACT_LIMIT;
  const visible = showAll ? keys : keys.slice(0, TAG_COMPACT_LIMIT);
  visible.forEach(t=>{
    const p=document.createElement('div');
    p.className='tag-pill'+(activeTagFilter===t?' active':'');
    p.innerHTML=esc(t)+' <span class="tp-n">'+all[t]+'</span>';
    p.onclick=()=>{activeTagFilter=activeTagFilter===t?null:t;render();};
    list.appendChild(p);
  });
  const btn = document.getElementById('tag-expand-btn');
  if(keys.length > TAG_COMPACT_LIMIT){
    btn.textContent = showAll ? '▲ less' : `▼ +${keys.length - TAG_COMPACT_LIMIT} more`;
  } else {
    btn.textContent = '';
  }
}

// ── RENDER ──
function render(){
  const app=document.getElementById('app'); app.innerHTML='';
  updateCounts(); buildCatNav(); buildTagFilterSidebar();

  const banner=document.getElementById('search-banner');
  if(searchQuery){
    let mc=0; assets.forEach(c=>c.items.forEach(i=>{if(itemVisible(i))mc++;}));
    banner.classList.add('vis');
    document.getElementById('sb-text').innerHTML=`<strong>${mc}</strong> result${mc!==1?'s':''} for "<strong>${esc(searchQuery)}</strong>"`;
  } else banner.classList.remove('vis');

  if(!assets.length) return;

  assets.forEach((cat,ci)=>{
    const visible=cat.items.filter(itemVisible);
    if(!visible.length) return;

    const sec=document.createElement('div'); sec.className='cat-section'; sec.id='cat-'+ci;
    const cg=cat.items.filter(i=>i.status==='green').length;
    const cr=cat.items.filter(i=>i.status==='red').length;
    const cy=cat.items.filter(i=>i.status==='yellow').length;
    const cb=cat.items.filter(i=>i.status==='blue').length;

    const hdr=document.createElement('div'); hdr.className='cat-header';
    hdr.innerHTML=`<span class="cat-name">${esc(cat.categoryName)}</span><span class="cat-count">${visible.length}</span>
      <div class="cat-stats">
        <div class="cat-stat"><div class="csd" style="background:var(--green)"></div>${cg}</div>
        <div class="cat-stat"><div class="csd" style="background:var(--red)"></div>${cr}</div>
        <div class="cat-stat"><div class="csd" style="background:var(--yellow)"></div>${cy}</div>
        <div class="cat-stat"><div class="csd" style="background:var(--blue)"></div>${cb}</div>
      </div>`;
    sec.appendChild(hdr);

    const gallery=document.createElement('div'); gallery.className='gallery';

    visible.forEach(item=>{
      const idx=cat.items.indexOf(item);
      const div=document.createElement('div');
      div.className='asset-item'+(item.status?' s-'+item.status:'')+((item.tags&&item.tags.length)?' has-tags':'');
      div.dataset.ci=ci; div.dataset.ii=idx;

      const tb=document.createElement('button'); tb.className='tag-btn'; tb.textContent='#'; tb.title='Edit tags';
      tb.onclick=e=>{e.stopPropagation();openTagModal(ci,idx);};

      const qlb=document.createElement('button'); qlb.className='ql-btn'; qlb.textContent='⌕'; qlb.title='Quick look';
      qlb.onclick=e=>{e.stopPropagation();openQuickLook(item);};

      const img=document.createElement('img'); img.src=item.src; img.loading='lazy';

      const nameEl=document.createElement('div'); nameEl.className='asset-name';
      nameEl.innerHTML=hi(item.name,searchQuery);

      const tagsEl=document.createElement('div'); tagsEl.className='asset-tags';
      (item.tags||[]).forEach(t=>{
        const chip=document.createElement('span'); chip.className='asset-tag-chip';
        chip.innerHTML=hi(t,searchQuery);
        chip.onclick=e=>{e.stopPropagation();activeTagFilter=t;render();};
        tagsEl.appendChild(chip);
      });

      const pip=document.createElement('div');
      pip.className='status-pip'+(item.status?' pip-'+item.status:'');

      div.onclick=()=>{ if(editMode) toggleStatus(ci,idx); else openQuickLook(item); };
      div.appendChild(tb); div.appendChild(qlb); div.appendChild(img);
      div.appendChild(nameEl); div.appendChild(tagsEl); div.appendChild(pip);
      gallery.appendChild(div);
    });

    sec.appendChild(gallery); app.appendChild(sec);
  });

  if(!app.children.length){
    app.innerHTML='<div class="empty-state"><div class="esi">🔍</div><p>No results match your filters.</p></div>';
  }

  updateSummaryBar();
}

function updateCounts(){
  let all=0,g=0,r=0,y=0,b=0;
  assets.forEach(c=>c.items.forEach(i=>{all++;if(i.status==='green')g++;else if(i.status==='red')r++;else if(i.status==='yellow')y++;else if(i.status==='blue')b++;}));
  document.getElementById('fc-all').textContent=all;
  document.getElementById('fc-green').textContent=g;
  document.getElementById('fc-red').textContent=r;
  document.getElementById('fc-yellow').textContent=y;
  document.getElementById('fc-blue').textContent=b;
}

function buildCatNav(){
  const nav=document.getElementById('cat-nav'); nav.innerHTML='';
  assets.forEach((cat,ci)=>{
    const el=document.createElement('div'); el.className='cat-nav-item';
    el.innerHTML=esc(cat.categoryName)+' <span class="cn-c">'+cat.items.length+'</span>';
    el.onclick=()=>document.getElementById('cat-'+ci)?.scrollIntoView({behavior:'smooth',block:'start'});
    nav.appendChild(el);
  });
}

function updateSummaryBar(){
  let total=0,g=0,r=0,y=0,b=0;
  assets.forEach(c=>c.items.forEach(i=>{
    if(!itemVisible(i)) return;
    total++;
    if(i.status==='green')g++; else if(i.status==='red')r++; else if(i.status==='yellow')y++; else if(i.status==='blue')b++;
  }));
  document.getElementById('summary-bar').classList.toggle('visible',total>0);
  document.getElementById('sum-g').textContent=g;
  document.getElementById('sum-r').textContent=r;
  document.getElementById('sum-y').textContent=y;
  document.getElementById('sum-b').textContent=b;
  document.getElementById('sum-t').textContent=total+' total';
}

// ── TOGGLE STATUS ──
function toggleStatus(ci,ii){
  if(!editMode){ return; }
  if(!assets[ci]||!assets[ci].items[ii]){ console.error('[toggle] bad index',ci,ii,assets.length); return; }
  const item=assets[ci].items[ii];
  const prev=item.status;
  const next=STATUS_CYCLE[(STATUS_CYCLE.indexOf(prev)+1)%STATUS_CYCLE.length];
  item.status=next;
  if(next===null) delete statuses[item.name]; else statuses[item.name]=next;

  const card=document.querySelector(`.asset-item[data-ci="${ci}"][data-ii="${ii}"]`);
  if(card){
    if(prev) card.classList.remove('s-'+prev);
    if(next) card.classList.add('s-'+next);
    const pip=card.querySelector('.status-pip');
    if(pip) pip.className='status-pip'+(next?' pip-'+next:'');
  }

  updateCounts();
  updateSummaryBar();
  ghSave();
}

// ── TAG MODAL ──
function openTagModal(ci,ii){
  tagTarget={ci,ii};
  const item=assets[ci].items[ii];
  document.getElementById('tm-file').textContent=item.name;
  document.getElementById('tag-input').value='';
  renderModalTags(item); renderModalSugs(item);
  document.getElementById('tm-backdrop').classList.add('open');
  setTimeout(()=>document.getElementById('tag-input').focus(),50);
}
document.getElementById('tm-close').onclick=closeModal;
document.getElementById('tm-backdrop').addEventListener('click',e=>{if(e.target===document.getElementById('tm-backdrop'))closeModal();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
document.getElementById('tag-input').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addTagFromInput();}});
document.getElementById('tag-add-btn').onclick=addTagFromInput;
function closeModal(){document.getElementById('tm-backdrop').classList.remove('open');tagTarget=null;}

function renderModalTags(item){
  const el=document.getElementById('tm-cur'); el.innerHTML='';
  if(!item.tags||!item.tags.length){el.innerHTML='<span class="tm-notag">No tags yet</span>';return;}
  item.tags.forEach(t=>{const d=document.createElement('div');d.className='tm-tag';d.textContent=t;d.title='Click to remove';d.onclick=()=>removeTag(t);el.appendChild(d);});
}
function renderModalSugs(item){
  const el=document.getElementById('tm-sug'); el.innerHTML='';
  const all=getAllTags();
  const existing=new Set(item.tags||[]);
  const others=Object.keys(all).filter(t=>!existing.has(t)).sort((a,b)=>all[b]-all[a]).slice(0,14);
  if(!others.length) return;
  el.innerHTML='<div class="tm-sug-lbl">Existing tags</div><div class="tm-sug-pills" id="tm-pills"></div>';
  const pills=document.getElementById('tm-pills');
  others.forEach(t=>{const p=document.createElement('div');p.className='tm-sug-pill';p.textContent=t;p.onclick=()=>applyTag(t);pills.appendChild(p);});
}
function addTagFromInput(){const input=document.getElementById('tag-input');const val=input.value.trim().toLowerCase().replace(/\s+/g,' ');if(!val)return;applyTag(val);input.value='';}
function applyTag(tag){
  if(!tagTarget) return;
  const item=assets[tagTarget.ci].items[tagTarget.ii];
  if(!item.tags) item.tags=[];
  if(item.tags.includes(tag)){toast('Tag already added');return;}
  item.tags.push(tag); tags[item.name]=[...item.tags];
  renderModalTags(item); renderModalSugs(item);
  const card=document.querySelector(`.asset-item[data-ci="${tagTarget.ci}"][data-ii="${tagTarget.ii}"]`);
  if(card){
    card.classList.add('has-tags');
    const tagsEl=card.querySelector('.asset-tags'); tagsEl.innerHTML='';
    item.tags.forEach(t=>{const chip=document.createElement('span');chip.className='asset-tag-chip';chip.textContent=t;chip.onclick=e=>{e.stopPropagation();activeTagFilter=t;render();};tagsEl.appendChild(chip);});
  }
  buildTagFilterSidebar(); ghSave();
}
function removeTag(tag){
  if(!tagTarget) return;
  const item=assets[tagTarget.ci].items[tagTarget.ii];
  item.tags=(item.tags||[]).filter(t=>t!==tag);
  if(item.tags.length) tags[item.name]=item.tags; else delete tags[item.name];
  renderModalTags(item); renderModalSugs(item);
  const card=document.querySelector(`.asset-item[data-ci="${tagTarget.ci}"][data-ii="${tagTarget.ii}"]`);
  if(card){
    if(!item.tags.length) card.classList.remove('has-tags');
    const tagsEl=card.querySelector('.asset-tags'); tagsEl.innerHTML='';
    item.tags.forEach(t=>{const chip=document.createElement('span');chip.className='asset-tag-chip';chip.textContent=t;chip.onclick=e=>{e.stopPropagation();activeTagFilter=t;render();};tagsEl.appendChild(chip);});
  }
  buildTagFilterSidebar(); ghSave();
}

// ── EXPORT ──
function exportData(){
  let out='Assets to Request:\n\n'; let found=false;
  assets.forEach(cat=>{
    const yItems=cat.items.filter(i=>i.status==='yellow');
    if(!yItems.length) return;
    found=true;
    out+=`--- ${cat.categoryName.toUpperCase()} ---\n`;
    yItems.forEach(i=>{out+=`[Need to Request] ${i.name}`+(i.tags&&i.tags.length?` [tags: ${i.tags.join(', ')}]`:'')+'\n';});
    out+='\n';
  });
  if(!found){toast('No "Need to Request" items to export');return;}
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([out],{type:'text/plain'}));
  a.download='Asset_Request_List.txt'; a.click(); toast('✓ Exported');
}

// ── RESET ──
async function clearAll(){
  if(!confirm('Reset everything? This clears your GitHub config, folder links, and filters. Your data file on GitHub is untouched.')) return;
  await clearH(); await clearThumbs();
  Object.values(CONFIG_KEYS).forEach(k=>localStorage.removeItem(k));
  assets=[]; statuses={}; tags={}; activeFilter=new Set(); activeTagFilter=null; searchQuery=''; ghFileSha=null;
  activeImgHandle=activeWorkHandle=null;
  document.getElementById('app').innerHTML='';
  searchInput.value=''; searchInput.classList.remove('has-value');
  document.getElementById('summary-bar').classList.remove('visible');
  setStatus('','—');
  init();
}

// ── EDIT MODE ──
function toggleEditMode(){
  if(editMode){
    exitEditMode();
  } else {
    document.getElementById('pw-input').value='';
    document.getElementById('pw-error').textContent='';
    document.getElementById('pw-backdrop').classList.add('open');
    setTimeout(()=>document.getElementById('pw-input').focus(), 50);
  }
}
function exitEditMode(){
  editMode = false;
  document.body.classList.remove('edit-mode');
  document.getElementById('btn-edit').textContent = '🔒 Edit Mode';
  toast('Edit mode off');
}
function submitPassword(){
  const val = document.getElementById('pw-input').value.trim().toLowerCase();
  if(val === 'neepal'){
    editMode = true;
    document.body.classList.add('edit-mode');
    document.getElementById('btn-edit').textContent = '🔓 Editing';
    document.getElementById('pw-backdrop').classList.remove('open');
    toast('✓ Edit mode on — click cards to change status');
  } else {
    document.getElementById('pw-error').textContent = 'Wrong password, try again.';
    document.getElementById('pw-input').value='';
    document.getElementById('pw-input').focus();
  }
}
document.getElementById('pw-close').onclick = () => document.getElementById('pw-backdrop').classList.remove('open');
document.getElementById('pw-backdrop').addEventListener('click', e => { if(e.target===document.getElementById('pw-backdrop')) document.getElementById('pw-backdrop').classList.remove('open'); });
document.getElementById('pw-input').addEventListener('keydown', e => { if(e.key==='Enter') submitPassword(); });

// ── QUICK LOOK ──
const STATUS_LABELS = { green:'Have files', red:'Missing', yellow:'Need to request', blue:'Animated' };
const STATUS_COLORS = { green:'var(--green)', red:'var(--red)', yellow:'var(--yellow)', blue:'var(--blue)' };
let qlItems = [], qlIndex = 0;

function openQuickLook(item){
  qlItems = [];
  assets.forEach(cat => cat.items.filter(itemVisible).forEach(i => qlItems.push(i)));
  qlIndex = qlItems.indexOf(item);
  renderQuickLook(item);
  document.getElementById('ql-backdrop').classList.add('open');
}

function renderQuickLook(item){
  const videoSrc = getVideoSrc(item);
  const imgEl = document.getElementById('ql-img');
  const vidEl = document.getElementById('ql-video');
  const toggleBtn = document.getElementById('ql-toggle-media');

  imgEl.src = item.fullSrc || item.src;
  vidEl.src = videoSrc || '';
  vidEl.style.display = 'none';
  imgEl.style.display = '';

  if(videoSrc){
    toggleBtn.style.display = 'flex';
    toggleBtn.textContent = '▶';
    toggleBtn._showingVideo = false;
  } else {
    toggleBtn.style.display = 'none';
  }

  document.getElementById('ql-name').textContent = item.name;
  const sr = document.getElementById('ql-status-row');
  if(item.status){
    sr.innerHTML = `<div class="ql-status-dot" style="background:${STATUS_COLORS[item.status]}"></div><span>${STATUS_LABELS[item.status]||item.status}</span>`;
  } else {
    sr.innerHTML = '<span style="color:var(--muted)">No status set</span>';
  }
  const tl = document.getElementById('ql-tags');
  tl.innerHTML = '';
  if(item.tags && item.tags.length){
    item.tags.forEach(t => { const d=document.createElement('div'); d.className='ql-tag'; d.textContent=t; const x=document.createElement('button'); x.className='ql-tag-del'; x.textContent='×'; x.onclick=()=>qlRemoveTag(item,t); d.appendChild(x); tl.appendChild(d); });
  }
  document.getElementById('ql-counter').textContent = qlItems.length > 1 ? `${qlIndex+1} / ${qlItems.length}` : '';
  document.getElementById('ql-link-video').textContent = videoSrc ? '🎬 Relink video' : '＋ Link video';
  document.getElementById('ql-link-video')._item = item;
  document.getElementById('ql-tag-row').style.display = editMode ? 'block' : 'none';
  document.getElementById('ql-tag-input').value = '';
  document.getElementById('ql-tag-input')._item = item;
  if(editMode) setTimeout(()=>document.getElementById('ql-tag-input').focus(), 80);
}

function qlNavigate(dir){
  if(!qlItems.length) return;
  const vidEl = document.getElementById('ql-video');
  vidEl.pause();
  qlIndex = (qlIndex + dir + qlItems.length) % qlItems.length;
  renderQuickLook(qlItems[qlIndex]);
}

document.getElementById('ql-close').addEventListener('click', () => { document.getElementById('ql-video').pause(); document.getElementById('ql-backdrop').classList.remove('open'); });
document.getElementById('ql-backdrop').addEventListener('click', e => { if(e.target===document.getElementById('ql-backdrop')) document.getElementById('ql-backdrop').classList.remove('open'); });
function qlRemoveTag(item, tag){
  item.tags = (item.tags||[]).filter(t=>t!==tag);
  if(item.tags.length) tags[item.name]=[...item.tags]; else delete tags[item.name];
  const tl=document.getElementById('ql-tags'); tl.innerHTML='';
  item.tags.forEach(t=>{ const d=document.createElement('div'); d.className='ql-tag'; d.textContent=t; const x=document.createElement('button'); x.className='ql-tag-del'; x.textContent='×'; x.onclick=()=>qlRemoveTag(item,t); d.appendChild(x); tl.appendChild(d); });
  ghSave();
}

document.getElementById('ql-tag-input').addEventListener('keydown', e => {
  const input = e.currentTarget;
  const item = input._item;
  if(e.key === 'Enter'){
    e.stopPropagation();
    const val = input.value.trim().toLowerCase().replace(/\s+/g,' ');
    if(!val || !item) return;
    if(!item.tags) item.tags = [];
    if(!item.tags.includes(val)){
      item.tags.push(val);
      tags[item.name] = [...item.tags];
      const tl = document.getElementById('ql-tags'); tl.innerHTML='';
      item.tags.forEach(t=>{ const d=document.createElement('div'); d.className='ql-tag'; d.textContent=t; const x=document.createElement('button'); x.className='ql-tag-del'; x.textContent='×'; x.onclick=()=>qlRemoveTag(item,t); d.appendChild(x); tl.appendChild(d); });
      ghSave();
    }
    input.value = '';
  } else if((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && input.value === ''){
    e.preventDefault();
    qlNavigate(e.key === 'ArrowLeft' ? -1 : 1);
  } else {
    e.stopPropagation();
  }
});
document.getElementById('ql-next').onclick = e => { e.stopPropagation(); qlNavigate(1); };

document.getElementById('ql-toggle-media').onclick = e => {
  e.stopPropagation();
  const btn = e.currentTarget;
  const imgEl = document.getElementById('ql-img');
  const vidEl = document.getElementById('ql-video');
  btn._showingVideo = !btn._showingVideo;
  if(btn._showingVideo){
    imgEl.style.display = 'none'; vidEl.style.display = ''; vidEl.play();
    btn.textContent = '🖼';
  } else {
    vidEl.pause(); vidEl.style.display = 'none'; imgEl.style.display = '';
    btn.textContent = '▶';
  }
};

document.getElementById('ql-link-video').onclick = async e => {
  e.stopPropagation();
  const item = e.currentTarget._item;
  if(!item) return;
  try {
    const [fileHandle] = await window.showOpenFilePicker({ types: [{ description: 'Video', accept: { 'video/*': ['.mp4','.webm','.mov'] } }] });
    const file = await fileHandle.getFile();
    const base = file.name.replace(/\.[^/.]+$/,'').toLowerCase();
    videoBlobMap[base] = URL.createObjectURL(file);
    videoLinks[item.name] = file.name;
    if(item.status !== 'blue'){ item.status = 'blue'; statuses[item.name] = 'blue'; }
    ghSave(); render();
    renderQuickLook(item);
    toast('✓ Video linked to ' + item.name);
  } catch(e){ if(e.name !== 'AbortError') toast('Could not open file'); }
};

document.getElementById('ql-download').onclick = e => {
  e.stopPropagation();
  const img = document.getElementById('ql-img');
  const a = document.createElement('a');
  a.href = img.src;
  a.download = document.getElementById('ql-name').textContent;
  a.click();
};
document.addEventListener('keydown', e => {
  const qlOpen = document.getElementById('ql-backdrop').classList.contains('open');
  if(qlOpen && e.key==='ArrowLeft'){ qlNavigate(-1); return; }
  if(qlOpen && e.key==='ArrowRight'){ qlNavigate(1); return; }
  if(e.key==='Escape'){ closeModal(); document.getElementById('ql-backdrop').classList.remove('open'); document.getElementById('pw-backdrop').classList.remove('open'); }
});

init();