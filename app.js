const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const nowIso = () => new Date().toISOString();
const toIsoDate = (d = new Date()) => {
  const x = new Date(d); x.setHours(0,0,0,0);
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
};
const fromIsoDate = (s) => { const [y,m,d]=String(s).split('-').map(Number); return new Date(y,(m||1)-1,d||1); };
const shiftDate = (iso, days) => { const d=fromIsoDate(iso); d.setDate(d.getDate()+days); return toIsoDate(d); };
const getTodayIso = () => toIsoDate(new Date());
const todayString = () => new Date().toLocaleDateString('pt-PT');
const yesterdayString = () => { const d=new Date(); d.setDate(d.getDate()-1); return d.toLocaleDateString('pt-PT'); };
const formatEuro=n=>`${Number(n||0).toLocaleString('pt-PT',{minimumFractionDigits:0,maximumFractionDigits:2})} €`;
const pad=n=>String(n).padStart(2,'0');
const fmtDuration=s=>{s=Math.max(0,Math.floor(s));return `${pad(Math.floor(s/3600))}:${pad(Math.floor(s%3600/60))}:${pad(s%60)}`};
const initials=name=>String(name||'').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
const displayDate = iso => fromIsoDate(iso).toLocaleDateString('pt-PT',{day:'numeric',month:'long'});
const displayFullDate = iso => fromIsoDate(iso).toLocaleDateString('pt-PT',{weekday:'long',day:'numeric',month:'long'});
const monthTitle = d => d.toLocaleDateString('pt-PT',{month:'long',year:'numeric'}).replace(/^./,m=>m.toUpperCase());
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
const minutesFromTime=t=>{const [h,m]=String(t||'').split(':').map(Number);return Number.isFinite(h)&&Number.isFinite(m)?h*60+m:null};
const parseJobDateTime=j=>new Date(`${j.date}T${j.time||'00:00'}:00`);
const withUpdated = obj => ({...obj, updatedAt: obj.updatedAt || nowIso()});

const demoClients=[
  {id:uid(),name:'João Silva',phone:'912 345 678',location:'Santarém',notes:'Prefere contacto por mensagem.'},
  {id:uid(),name:'Marta Costa',phone:'913 222 111',location:'Coruche',notes:'Apartamento, 2.º andar.'},
  {id:uid(),name:'Rui Almeida',phone:'916 700 400',location:'Almeirim',notes:'Cliente recorrente.'}
].map(withUpdated);
const demoToday=getTodayIso();
const defaultJobs=[
  {id:uid(),client:'João Silva',title:'Montagem de roupeiro',location:'Santarém',date:demoToday,time:'15:00',price:45,notes:'Roupeiro IKEA PAX, 2 módulos.',status:'scheduled',startedAt:null},
  {id:uid(),client:'Marta Costa',title:'Montagem de cama',location:'Coruche',date:demoToday,time:'17:30',price:30,notes:'Cama de casal com gavetões.',status:'scheduled',startedAt:null},
  {id:uid(),client:'Rui Almeida',title:'Montagem de secretária',location:'Almeirim',date:shiftDate(demoToday,7),time:'11:00',price:40,notes:'Montagem agendada para a próxima semana.',status:'scheduled',startedAt:null}
].map(withUpdated);

const loadedJobs=JSON.parse(localStorage.getItem('mj_jobs')||'null');
const state={
  jobs:(loadedJobs||defaultJobs).map(j=>withUpdated({...j,date:j.date||getTodayIso(),tags:Array.isArray(j.tags)?j.tags:[]})),
  clients:(JSON.parse(localStorage.getItem('mj_clients')||'null')||demoClients).map(withUpdated),
  history:(JSON.parse(localStorage.getItem('mj_history')||'[]')).map(h=>withUpdated({...h,tags:Array.isArray(h.tags)?h.tags:[]})),
  deleted:JSON.parse(localStorage.getItem('mj_deleted')||'[]'),
  activeJobId:localStorage.getItem('mj_active_job')||null,
  selectedDate:getTodayIso(), agendaMode:'day', timerInterval:null, finishDuration:0,
  pendingDeleteId:null, editingJobId:null, jobDate:getTodayIso(), syncTimer:null,
  agendaSearch:'', agendaType:'all', agendaStatus:'all', agendaClient:'all', agendaTag:'all', formTags:[], map:null, mapLayer:null
};
let agendaCalendarMonth=new Date(fromIsoDate(state.selectedDate).getFullYear(),fromIsoDate(state.selectedDate).getMonth(),1);
let jobCalendarMonth=new Date(agendaCalendarMonth);
let supabaseClient=null, supabaseConfigKey='';

function touch(item){item.updatedAt=nowIso();return item}
function tombstone(kind,itemId){
  const existing=state.deleted.find(x=>x.kind===kind&&x.itemId===itemId);
  if(existing) existing.updatedAt=nowIso(); else state.deleted.push({kind,itemId,updatedAt:nowIso()});
}
function save({cloud=true}={}){
  localStorage.setItem('mj_jobs',JSON.stringify(state.jobs));
  localStorage.setItem('mj_clients',JSON.stringify(state.clients));
  localStorage.setItem('mj_history',JSON.stringify(state.history));
  localStorage.setItem('mj_deleted',JSON.stringify(state.deleted));
  state.activeJobId?localStorage.setItem('mj_active_job',state.activeJobId):localStorage.removeItem('mj_active_job');
  if(cloud) scheduleCloudSync();
}
function isToday(iso){return iso===getTodayIso()}
function isTomorrow(iso){return iso===shiftDate(getTodayIso(),1)}
function summarySuffix(){if(isToday(state.selectedDate))return 'hoje';if(isTomorrow(state.selectedDate))return 'amanhã';return `a ${displayDate(state.selectedDate)}`}
function jobsForDate(iso){return state.jobs.filter(j=>j.date===iso)}
function compareJobs(a,b){return a.date!==b.date?a.date.localeCompare(b.date):a.time.localeCompare(b.time)}
function jobsInWeek(anchorIso){
  const start=fromIsoDate(anchorIso),dow=start.getDay();start.setDate(start.getDate()+(dow===0?-6:1-dow));start.setHours(0,0,0,0);
  const end=new Date(start);end.setDate(end.getDate()+7);
  return state.jobs.filter(j=>{const d=fromIsoDate(j.date);return d>=start&&d<end});
}
function svgIcon(type='hammer'){
  const open='<svg viewBox="0 0 24 24" aria-hidden="true">',close='</svg>';
  if(type==='bed')return `${open}<path d="M3 12h18v6H3zM5 10V7h5a3 3 0 0 1 3 3M21 18v2M3 18v2M13 10h4a4 4 0 0 1 4 4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>${close}`;
  if(type==='table')return `${open}<path d="M4 8h16v4H4zM7 12v7M17 12v7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>${close}`;
  if(type==='chair')return `${open}<path d="M7 4v8h10V4M6 12h12v4H6zM8 16v4M16 16v4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>${close}`;
  if(type==='shelf')return `${open}<path d="M5 4h14v16H5zM5 9h14M5 14h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>${close}`;
  return `${open}<path d="M4 20l7.2-7.2M10.2 5.1l2.1-2.1 8.7 8.7-2.1 2.1-3-3-2.2 2.2-3.5-3.5 2.2-2.2zM3 21l3.2-.7-2.5-2.5z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>${close}`;
}
function serviceKind(title=''){
  const t=title.toLowerCase();
  if(t.includes('cama')||t.includes('beliche')||t.includes('berço')||t.includes('berco'))return {icon:svgIcon('bed'),cls:'bed',label:'Cama'};
  if(t.includes('mesa')||t.includes('secretária')||t.includes('secretaria')||t.includes('aparador'))return {icon:svgIcon('table'),cls:'table',label:'Mesa / secretária'};
  if(t.includes('cadeira')||t.includes('sofá')||t.includes('sofa')||t.includes('poltrona'))return {icon:svgIcon('chair'),cls:'chair',label:'Cadeira / sofá'};
  if(t.includes('estante')||t.includes('prateleira')||t.includes('sapateira'))return {icon:svgIcon('shelf'),cls:'shelf',label:'Estante / prateleira'};
  return {icon:svgIcon('hammer'),cls:'tools',label:'Montagem'};
}

function normalizeTag(tag){return String(tag||'').trim().replace(/\s+/g,' ').slice(0,24)}
function uniqueTags(tags=[]){return [...new Set((tags||[]).map(normalizeTag).filter(Boolean))]}
function tagHtml(tags=[]){return uniqueTags(tags).map(t=>`<span class="job-tag">${esc(t)}</span>`).join('')}
function allTags(){return uniqueTags([...state.jobs.flatMap(j=>j.tags||[]),...state.history.flatMap(h=>h.tags||[])])}
function renderSelectedTags(){
  const host=document.getElementById('selectedTags');if(!host)return;
  state.formTags=uniqueTags(state.formTags);
  host.innerHTML=state.formTags.length?state.formTags.map(t=>`<button type="button" class="selected-tag" data-remove-tag="${esc(t)}">${esc(t)} <b>×</b></button>`).join(''):'<small>Sem tags selecionadas.</small>';
  host.querySelectorAll('[data-remove-tag]').forEach(b=>b.onclick=()=>{state.formTags=state.formTags.filter(t=>t!==b.dataset.removeTag);renderSelectedTags();renderTagPresets()});
}
function renderTagPresets(){document.querySelectorAll('#tagPresets [data-tag]').forEach(b=>b.classList.toggle('active',state.formTags.includes(b.dataset.tag)))}
function addFormTag(tag){const t=normalizeTag(tag);if(!t)return;state.formTags=uniqueTags([...state.formTags,t]);renderSelectedTags();renderTagPresets()}
function renderTagFilter(){const sel=document.getElementById('jobTagFilter');if(!sel)return;const current=state.agendaTag;sel.innerHTML='<option value="all">Todas as tags</option>'+allTags().map(t=>`<option value="${esc(t)}"># ${esc(t)}</option>`).join('');sel.value=allTags().includes(current)?current:'all';if(sel.value==='all')state.agendaTag='all'}

function monthKeyFromIso(iso){return String(iso||'').slice(0,7)}
function historyIso(h){return h.serviceDate||String(h.completedAt||'').slice(0,10)||getTodayIso()}
function monthlySnapshot(){
  const key=monthKeyFromIso(getTodayIso()),prevDate=new Date();prevDate.setMonth(prevDate.getMonth()-1);const prevKey=`${prevDate.getFullYear()}-${pad(prevDate.getMonth()+1)}`;
  const completed=state.history.filter(h=>monthKeyFromIso(historyIso(h))===key),previous=state.history.filter(h=>monthKeyFromIso(historyIso(h))===prevKey),scheduled=state.jobs.filter(j=>monthKeyFromIso(j.date)===key);
  const revenue=completed.reduce((a,h)=>a+Number(h.price||0),0),prevRevenue=previous.reduce((a,h)=>a+Number(h.price||0),0),forecast=scheduled.reduce((a,j)=>a+Number(j.price||0),0),avg=completed.length?revenue/completed.length:0;
  return {completed,scheduled,revenue,prevRevenue,forecast,avg,totalCount:completed.length+scheduled.length};
}
function renderMonthlyDashboard(){
  const snap=monthlySnapshot();const now=new Date();
  const badge=document.getElementById('monthBadge');if(!badge)return;badge.textContent=now.toLocaleDateString('pt-PT',{month:'long'}).replace(/^./,m=>m.toUpperCase());
  document.getElementById('monthRevenue').textContent=formatEuro(snap.revenue);document.getElementById('monthForecast').textContent=formatEuro(snap.revenue+snap.forecast);document.getElementById('monthServices').textContent=String(snap.totalCount);document.getElementById('monthAverage').textContent=formatEuro(snap.avg);
  const compare=document.getElementById('monthCompare');if(snap.prevRevenue>0){const pct=Math.round(((snap.revenue-snap.prevRevenue)/snap.prevRevenue)*100);compare.textContent=`${pct>=0?'↑ +':'↓ '}${pct}% vs. mês anterior`;compare.className=pct>=0?'positive':'negative'}else{compare.textContent='Sem comparação anterior';compare.className=''}
  const target=Math.max(snap.revenue+snap.forecast, snap.revenue, 1);document.getElementById('monthProgressBar').style.width=`${Math.min(100,(snap.revenue/target)*100)}%`;document.getElementById('monthProgressText').textContent=`${formatEuro(snap.revenue)} faturados · ${formatEuro(snap.forecast)} por concluir`;
}

function currentThemeChoice(){return localStorage.getItem('mj_theme')||'dark'}
function resolvedTheme(choice=currentThemeChoice()){if(choice==='system')return matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';return choice}
function applyTheme(choice=currentThemeChoice()){
  if(!['dark','light','system'].includes(choice))choice='dark';localStorage.setItem('mj_theme',choice);document.documentElement.dataset.theme=resolvedTheme(choice);
  const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.setAttribute('content',resolvedTheme(choice)==='light'?'#f6f2ed':'#0a0909');
  document.querySelectorAll('[data-theme-choice]').forEach(b=>b.classList.toggle('active',b.dataset.themeChoice===choice));
}

const knownZoneCoords={
  'santarem':[39.2369,-8.6850],'santarém':[39.2369,-8.6850],'coruche':[38.9595,-8.5252],'almeirim':[39.2081,-8.6263],'cartaxo':[39.1602,-8.7874],'salvaterra de magos':[39.0275,-8.7934],'benavente':[38.9792,-8.8076],'lisboa':[38.7223,-9.1393],'setubal':[38.5244,-8.8882],'setúbal':[38.5244,-8.8882],'evora':[38.5714,-7.9135],'évora':[38.5714,-7.9135],'leiria':[39.7436,-8.8071],'porto':[41.1579,-8.6291]
};
function normZone(z){return String(z||'').trim().toLowerCase()}
function zoneStats(){
  const m=new Map();const add=(location,price=0,completed=false)=>{const name=String(location||'').trim();if(!name)return;const key=normZone(name);if(!m.has(key))m.set(key,{key,name,count:0,completed:0,revenue:0,scheduled:0});const z=m.get(key);z.count++;if(completed){z.completed++;z.revenue+=Number(price||0)}else z.scheduled++};
  state.jobs.forEach(j=>add(j.location,j.price,false));state.history.forEach(h=>add(h.location,h.price,true));return [...m.values()].sort((a,b)=>b.count-a.count||b.revenue-a.revenue);
}
function renderZoneRanking(){const host=document.getElementById('zoneRanking');if(!host)return;const zones=zoneStats();host.innerHTML=zones.length?zones.slice(0,6).map((z,i)=>`<div class="zone-row"><b>${i+1}</b><div><strong>${esc(z.name)}</strong><span>${z.count} ${z.count===1?'serviço':'serviços'} · ${z.scheduled} agendados</span></div><em>${formatEuro(z.revenue)}</em></div>`).join(''):'<div class="empty-state">Quando adicionares serviços, as zonas aparecem aqui.</div>'}
async function geocodeZone(zone){
  const key=normZone(zone);if(knownZoneCoords[key])return knownZoneCoords[key];const cache=JSON.parse(localStorage.getItem('mj_geocode_cache')||'{}');if(cache[key])return cache[key];
  if(!navigator.onLine)return null;try{const r=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=pt&q=${encodeURIComponent(zone+', Portugal')}`,{headers:{'Accept':'application/json'}});if(!r.ok)return null;const data=await r.json();if(!data?.[0])return null;const coords=[Number(data[0].lat),Number(data[0].lon)];cache[key]=coords;localStorage.setItem('mj_geocode_cache',JSON.stringify(cache));return coords}catch{return null}
}
async function renderZoneMap(force=false){
  renderZoneRanking();const host=document.getElementById('zonesMap'),fallback=document.getElementById('mapFallback');if(!host)return;if(!window.L){fallback?.classList.remove('hidden');return}fallback?.classList.add('hidden');
  if(!state.map){state.map=L.map(host,{zoomControl:true,attributionControl:true}).setView([39.45,-8.2],7);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(state.map);state.mapLayer=L.layerGroup().addTo(state.map)}else{state.map.invalidateSize();state.mapLayer.clearLayers()}
  const zones=zoneStats();const bounds=[];for(const z of zones){let c=knownZoneCoords[z.key]||null;if(!c&&force)c=await geocodeZone(z.name);if(!c)continue;bounds.push(c);const radius=Math.min(22,8+z.count*2);L.circleMarker(c,{radius,color:'#ff7a14',weight:2,fillColor:'#ff8b19',fillOpacity:.72}).addTo(state.mapLayer).bindPopup(`<strong>${esc(z.name)}</strong><br>${z.count} serviços<br>${formatEuro(z.revenue)} faturados`)}
  if(bounds.length===1)state.map.setView(bounds[0],11);else if(bounds.length>1)state.map.fitBounds(bounds,{padding:[28,28],maxZoom:11});else state.map.setView([39.45,-8.2],7);setTimeout(()=>state.map?.invalidateSize(),120)
}

function renderMonthCalendar(containerId,monthDate,selectedIso,onSelect,showJobs=true){
  const host=document.getElementById(containerId);if(!host)return;const y=monthDate.getFullYear(),m=monthDate.getMonth(),first=new Date(y,m,1),days=new Date(y,m+1,0).getDate(),lead=(first.getDay()+6)%7;let html='';
  for(let i=0;i<lead;i++)html+='<span class="calendar-empty"></span>';
  for(let day=1;day<=days;day++){const iso=toIsoDate(new Date(y,m,day)),count=showJobs?jobsForDate(iso).length:0;html+=`<button type="button" class="calendar-day ${iso===selectedIso?'selected':''} ${isToday(iso)?'today':''} ${count?'has-jobs':''}" data-date="${iso}"><span>${day}</span>${count?`<small>${count}</small>`:''}</button>`}
  host.innerHTML=html;host.querySelectorAll('[data-date]').forEach(btn=>btn.onclick=()=>onSelect(btn.dataset.date));
}
function renderAgendaCalendar(){
  document.getElementById('agendaMonthTitle').textContent=monthTitle(agendaCalendarMonth);
  renderMonthCalendar('agendaCalendar',agendaCalendarMonth,state.selectedDate,iso=>{state.selectedDate=iso;state.agendaMode='day';const d=fromIsoDate(iso);agendaCalendarMonth=new Date(d.getFullYear(),d.getMonth(),1);renderAll()},true);
}
function renderJobCalendar(){
  document.getElementById('jobMonthTitle').textContent=monthTitle(jobCalendarMonth);
  renderMonthCalendar('jobCalendar',jobCalendarMonth,state.jobDate,iso=>{state.jobDate=iso;document.getElementById('jobDateField').value=iso;renderJobCalendar();updateJobDateDisplay();renderBusyTimes();updateTimeWarning()},false);
}
function updateJobDateDisplay(){const el=document.getElementById('jobDateDisplay');el.textContent=displayFullDate(state.jobDate).replace(/^./,m=>m.toUpperCase())}
function moveMonth(date,delta){return new Date(date.getFullYear(),date.getMonth()+delta,1)}
function renderDate(){
  const count=jobsForDate(state.selectedDate).length;document.getElementById('todaySummary').textContent=`Tens ${count} ${count===1?'serviço':'serviços'} ${summarySuffix()}`;
  const strip=document.getElementById('weekStrip');strip.innerHTML='';const base=fromIsoDate(state.selectedDate);
  for(let i=-2;i<=2;i++){const d=new Date(base);d.setDate(base.getDate()+i);const iso=toIsoDate(d),day=d.toLocaleDateString('pt-PT',{weekday:'short'}).replace('.','').replace(/^./,x=>x.toUpperCase());strip.insertAdjacentHTML('beforeend',`<button class="day-pill ${iso===state.selectedDate?'active':''}" data-date="${iso}"><small>${day}</small><strong>${d.getDate()}</strong></button>`)}
  strip.querySelectorAll('[data-date]').forEach(b=>b.onclick=()=>{state.selectedDate=b.dataset.date;state.agendaMode='day';const d=fromIsoDate(state.selectedDate);agendaCalendarMonth=new Date(d.getFullYear(),d.getMonth(),1);renderAll()});
}
function revenueOn(date){return state.history.filter(h=>h.date===date).reduce((a,b)=>a+Number(b.price||0),0)}
function totalRevenue(){return state.history.reduce((a,b)=>a+Number(b.price||0),0)}
function renderStats(){
  const t=revenueOn(todayString()),y=revenueOn(yesterdayString());document.getElementById('revenueStat').textContent=formatEuro(t);const delta=document.getElementById('revenueDelta');
  if(y>0){const pct=Math.round(((t-y)/y)*100);delta.textContent=`${pct>=0?'↑ +':'↓ '}${pct}% face a ontem`;delta.style.color=pct>=0?'var(--green)':'#ff817a'}else{delta.textContent=t>0?'✓ Faturado hoje':'Sem faturação concluída hoje';delta.style.color=t>0?'var(--green)':'#aaa49f'}
  document.getElementById('historyCount').textContent=`${state.history.length} ${state.history.length===1?'trabalho guardado':'trabalhos guardados'}`;document.getElementById('allRevenue').textContent=`${formatEuro(totalRevenue())} no total`;
}
function jobCard(j){const k=serviceKind(j.title),tags=uniqueTags(j.tags);return `<article class="job-card ${k.cls}" data-job="${j.id}"><div class="job-icon">${k.icon}</div><div class="job-main"><span class="time">${esc(j.time)} · ${esc(displayDate(j.date))}</span><b>${esc(j.title)}</b><span>⌖ ${esc(j.location)}</span><span>♙ ${esc(j.client)}</span>${tags.length?`<div class="job-tags">${tagHtml(tags.slice(0,3))}</div>`:''}</div><div class="job-price">${formatEuro(j.price)}</div>${j.status==='active'?'<div class="job-status">● Serviço em andamento</div>':`<button class="job-start" data-start="${j.id}">▷ Iniciar serviço</button>`}</article>`}
function bindJobCards(root){root.querySelectorAll('[data-job]').forEach(c=>c.addEventListener('click',e=>{if(e.target.closest('[data-start]'))return;openJob(c.dataset.job)}));root.querySelectorAll('[data-start]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();startJob(b.dataset.start)}))}
function renderJobs(){const w=document.getElementById('jobsList'),jobs=[...jobsForDate(state.selectedDate)].sort(compareJobs);w.innerHTML=jobs.length?jobs.map(jobCard).join(''):`<div class="empty-state">Sem serviços marcados ${summarySuffix()}.</div>`;bindJobCards(w)}
function agendaFilteredJobs(){
  let jobs=(state.agendaMode==='week'?[...jobsInWeek(state.selectedDate)]:[...jobsForDate(state.selectedDate)]).sort(compareJobs);
  const q=state.agendaSearch.trim().toLowerCase();
  if(q)jobs=jobs.filter(j=>`${j.title} ${j.client} ${j.location} ${j.notes||''} ${(j.tags||[]).join(' ')}`.toLowerCase().includes(q));
  if(state.agendaType!=='all')jobs=jobs.filter(j=>serviceKind(j.title).cls===state.agendaType);
  if(state.agendaStatus!=='all')jobs=jobs.filter(j=>j.status===state.agendaStatus);
  if(state.agendaClient!=='all')jobs=jobs.filter(j=>j.client===state.agendaClient);
  if(state.agendaTag!=='all')jobs=jobs.filter(j=>(j.tags||[]).includes(state.agendaTag));
  return jobs;
}
function renderAgenda(){
  const jobs=agendaFilteredJobs(),w=document.getElementById('agendaList');
  document.getElementById('agendaDateLabel').textContent=(state.agendaMode==='week'?`Semana de ${displayDate(state.selectedDate)}`:displayFullDate(state.selectedDate)).replace(/^./,m=>m.toUpperCase());
  document.getElementById('agendaWeekBtn').classList.toggle('active',state.agendaMode==='week');document.getElementById('agendaWeekBtn').textContent=state.agendaMode==='week'?'Ver dia':'Ver semana';
  w.innerHTML=jobs.length?jobs.map(j=>`<div class="timeline-row"><div class="timeline-time">${esc(j.time)}</div><button class="timeline-card ${serviceKind(j.title).cls}" data-job="${j.id}"><strong>${esc(j.title)}</strong><span>${esc(j.client)} · ${esc(j.location)}</span><span>${esc(displayDate(j.date))} · ${formatEuro(j.price)}</span></button></div>`).join(''):'<div class="empty-state">Nenhum serviço corresponde aos filtros.</div>';
  w.querySelectorAll('[data-job]').forEach(b=>b.onclick=()=>openJob(b.dataset.job));renderAgendaCalendar();
}
function clientServiceCount(name){return state.jobs.filter(j=>j.client===name).length+state.history.filter(h=>h.client===name).length}
function clientSpent(name){return state.history.filter(h=>h.client===name).reduce((a,b)=>a+Number(b.price||0),0)}
function renderClients(filter=''){
  const w=document.getElementById('clientsList'),q=filter.trim().toLowerCase(),arr=state.clients.filter(c=>!q||`${c.name} ${c.location||''} ${c.phone||''}`.toLowerCase().includes(q));
  w.innerHTML=arr.length?arr.map(c=>`<button class="client-card" data-client="${c.id}"><div class="client-avatar">${esc(initials(c.name))}</div><div><strong>${esc(c.name)}</strong><span>${esc(c.location||'Zona não indicada')}${c.phone?` · ${esc(c.phone)}`:''}</span></div><div class="client-count">${clientServiceCount(c.name)} serv.</div></button>`).join(''):'<div class="empty-state">Nenhum cliente encontrado.</div>';
  w.querySelectorAll('[data-client]').forEach(b=>b.onclick=()=>openClient(b.dataset.client));
  document.getElementById('clientOptions').innerHTML=state.clients.map(c=>`<option value="${esc(c.name)}"></option>`).join('');
  const sel=document.getElementById('jobClientFilter'); if(sel){const current=state.agendaClient;sel.innerHTML='<option value="all">Todos os clientes</option>'+state.clients.map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');sel.value=current;}
  renderTagFilter();
}
function receiptNumber(h){const d=(h.completedAt||new Date().toISOString()).slice(0,10).replaceAll('-','');return `MJ-${d}-${String(h.id||'').slice(0,6).toUpperCase()}`}
function renderHistory(){
  const w=document.getElementById('historyList');
  w.innerHTML=state.history.length?[...state.history].reverse().map(h=>`<article class="history-card"><div class="row"><div><h4>${esc(h.title)}</h4><p>${esc(h.client)} · ${esc(h.location)}</p><p>${esc(h.date)} · ${esc(h.duration)}</p></div><div class="amount">${formatEuro(h.price)}</div></div><div class="history-actions"><span class="signature-badge">✓ Assinado · ${esc(h.payment)}</span><button class="receipt-btn" data-receipt="${h.id}">Comprovativo</button></div></article>`).join(''):'<div class="empty-state">Os serviços concluídos vão aparecer aqui.</div>';
  w.querySelectorAll('[data-receipt]').forEach(b=>b.onclick=()=>printReceipt(b.dataset.receipt));
}
function printReceipt(id){
  const h=state.history.find(x=>x.id===id);if(!h)return;
  const logo=new URL('assets/logo.png',location.href).href, sig=h.signature||'', num=receiptNumber(h);
  const win=window.open('','_blank'); if(win)win.opener=null; if(!win){alert('O navegador bloqueou a janela do comprovativo. Permite pop-ups para esta página.');return}
  const html=`<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(num)}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;background:#f4f1ed;color:#171310}.page{max-width:720px;margin:30px auto;background:white;padding:40px;border-radius:18px;box-shadow:0 12px 40px #0001}.logo{width:190px;height:80px;object-fit:contain;object-position:left}.top{display:flex;justify-content:space-between;gap:20px;align-items:start}.muted{color:#716a63}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:28px 0}.box{border:1px solid #e5ded7;border-radius:12px;padding:14px}.box span{display:block;font-size:11px;color:#847b73;text-transform:uppercase;letter-spacing:.08em}.box strong{display:block;margin-top:5px}.amount{font-size:30px;color:#f17016}.sig{margin-top:24px;border-top:1px solid #e5ded7;padding-top:20px}.sig img{max-width:320px;max-height:120px;border:1px solid #eee;border-radius:10px;background:#fff}.note{font-size:12px;color:#847b73;margin-top:28px}.print{position:fixed;right:20px;bottom:20px;background:#ff7a14;color:#1a0d04;border:0;border-radius:14px;padding:14px 18px;font-weight:800}@media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none;border-radius:0}.print{display:none}}</style></head><body><div class="page"><div class="top"><div><img class="logo" src="${logo}" alt="MontaJá"><h1>Comprovativo de serviço</h1><p class="muted">${esc(num)}</p></div><div><strong>${esc(h.date)}</strong><p class="muted">Serviço concluído</p></div></div><div class="grid"><div class="box"><span>Cliente</span><strong>${esc(h.client)}</strong></div><div class="box"><span>Serviço</span><strong>${esc(h.title)}</strong></div><div class="box"><span>Local</span><strong>${esc(h.location)}</strong></div><div class="box"><span>Duração</span><strong>${esc(h.duration)}</strong></div><div class="box"><span>Pagamento</span><strong>${esc(h.payment)}</strong></div><div class="box"><span>Valor</span><strong class="amount">${formatEuro(h.price)}</strong></div></div><div class="sig"><strong>Confirmação do cliente</strong><p class="muted">Assinatura recolhida no final do serviço.</p>${sig?`<img src="${sig}" alt="Assinatura do cliente">`:''}</div><p class="note">Este documento é um comprovativo de execução do serviço e não substitui fatura ou recibo fiscal quando estes sejam legalmente exigíveis.</p></div><button class="print" onclick="window.print()">Imprimir / Guardar PDF</button></body></html>`;
  win.document.open();win.document.write(html);win.document.close();
}
function timeConflicts(date,time,excludeId=null){
  const target=minutesFromTime(time);if(target===null)return {exact:[],near:[]};const jobs=jobsForDate(date).filter(j=>j.id!==excludeId&&j.status!=='cancelled');
  const exact=jobs.filter(j=>j.time===time),near=jobs.filter(j=>{const m=minutesFromTime(j.time);return j.time!==time&&m!==null&&Math.abs(m-target)<90});return {exact,near};
}
function duplicateTimeConflicts(){
  const groups=new Map();state.jobs.forEach(j=>{const k=`${j.date}|${j.time}`;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(j)});return [...groups.values()].filter(g=>g.length>1);
}
function notificationItems(){
  const items=[],now=new Date(),active=state.jobs.find(j=>j.status==='active');if(active)items.push({icon:'⏱',title:'Serviço em andamento',text:`${active.title} com ${active.client}. O cronómetro está ativo.`});
  const soon=state.jobs.filter(j=>j.status==='scheduled'&&j.date===getTodayIso()).map(j=>({j,diff:(parseJobDateTime(j)-now)/60000})).filter(x=>x.diff>=0&&x.diff<=60).sort((a,b)=>a.diff-b.diff)[0];if(soon)items.push({icon:'🔔',title:`Serviço daqui a ${Math.max(1,Math.round(soon.diff))} min`,text:`${soon.j.title} com ${soon.j.client}, às ${soon.j.time}.`});
  const tomorrow=jobsForDate(shiftDate(getTodayIso(),1));if(tomorrow.length)items.push({icon:'📅',title:`${tomorrow.length} ${tomorrow.length===1?'serviço':'serviços'} amanhã`,text:`O primeiro começa às ${[...tomorrow].sort(compareJobs)[0].time}.`});
  const conflicts=duplicateTimeConflicts();if(conflicts.length)items.push({icon:'⚠️',title:'Horários sobrepostos',text:`Há ${conflicts.length} ${conflicts.length===1?'horário com mais de um serviço':'horários com mais de um serviço'}.`});
  const noPhone=state.clients.filter(c=>!String(c.phone||'').trim()).length;if(noPhone)items.push({icon:'👤',title:'Contactos por completar',text:`${noPhone} ${noPhone===1?'cliente não tem':'clientes não têm'} telemóvel guardado.`});
  const future=state.jobs.filter(j=>j.date>getTodayIso()).sort(compareJobs)[0];if(future)items.push({icon:'↗',title:'Próxima marcação futura',text:`${future.title} a ${displayDate(future.date)}, ${future.time}.`});
  if(!items.length)items.push({icon:'✓',title:'Tudo em ordem',text:'Não tens notificações pendentes neste momento.'});return items;
}
function renderNotifications(){const list=document.getElementById('notificationsList'),items=notificationItems();list.innerHTML=items.map(n=>`<div class="notification-card"><div class="notification-symbol">${n.icon}</div><div><strong>${esc(n.title)}</strong><p>${esc(n.text)}</p></div></div>`).join('');document.getElementById('notificationDot').classList.toggle('hidden',items.length===1&&items[0].title==='Tudo em ordem')}
function renderAll(){renderDate();renderStats();renderMonthlyDashboard();renderJobs();renderClients(document.getElementById('clientSearch')?.value||'');renderAgenda();renderHistory();renderNotifications();renderSyncSummary();applyTheme(currentThemeChoice());renderZoneRanking()}

function openJob(id){
  const j=state.jobs.find(x=>x.id===id);if(!j)return;const d=document.getElementById('jobDialog'),host=document.getElementById('jobDialogContent'),tpl=document.getElementById('jobDetailsTemplate').content.cloneNode(true);
  tpl.querySelector('[data-bind="title"]').textContent=j.title;tpl.querySelector('[data-bind="client"]').textContent=j.client;tpl.querySelector('[data-bind="location"]').textContent=j.location;tpl.querySelector('[data-bind="time"]').textContent=`${displayDate(j.date)} · ${j.time}`;tpl.querySelector('[data-bind="price"]').textContent=formatEuro(j.price);tpl.querySelector('[data-bind="notes"]').textContent=j.notes||'Sem notas.';const tagsDetail=tpl.querySelector('#jobTagsDetail');if(tagsDetail&&uniqueTags(j.tags).length){tagsDetail.classList.remove('hidden');tagsDetail.innerHTML='<span>Tags</span><div>'+tagHtml(j.tags)+'</div>'}
  host.innerHTML='';host.appendChild(tpl);host.querySelector('[data-close]').onclick=()=>d.close();const editBtn=host.querySelector('#editJobBtn'),delBtn=host.querySelector('#deleteJobBtn'),actions=host.querySelector('#jobManagementActions');
  if(j.status==='active'){actions.style.display='none'}else{editBtn.onclick=()=>{d.close();openJobForm(j)};delBtn.onclick=()=>askDeleteJob(j.id)}renderTimerArea(j);d.showModal();
}
function setSmartTime(time=''){
  const [h='',m='']=String(time||'').split(':');document.getElementById('jobHour').value=h;document.getElementById('jobMinute').value=m;document.getElementById('jobTimeField').value=time||'';updateTimeWarning();
}
function smartTimeValue(){
  const h=document.getElementById('jobHour').value.trim(),m=document.getElementById('jobMinute').value.trim();if(!h||!m)return '';
  const hh=Number(h),mm=Number(m);if(!Number.isInteger(hh)||hh<0||hh>23||!Number.isInteger(mm)||mm<0||mm>59)return '';return `${pad(hh)}:${pad(mm)}`;
}
function syncTimeHidden(){const value=smartTimeValue();document.getElementById('jobTimeField').value=value;updateTimeWarning();return value}
function renderBusyTimes(){
  const host=document.getElementById('busyTimes');if(!host)return;const jobs=jobsForDate(state.jobDate).filter(j=>j.id!==state.editingJobId).sort(compareJobs);
  host.innerHTML=jobs.length?`<span>HORAS OCUPADAS</span><div>${jobs.map(j=>`<button type="button" class="busy-chip" data-busy="${j.time}"><b>${esc(j.time)}</b> ${esc(j.title)}</button>`).join('')}</div>`:'<span>HORAS OCUPADAS</span><p>Livre — ainda não tens serviços marcados neste dia.</p>';
}
function updateTimeWarning(){
  const box=document.getElementById('timeWarning');if(!box)return;const time=smartTimeValue();if(!time){box.classList.add('hidden');return}const c=timeConflicts(state.jobDate,time,state.editingJobId);box.classList.remove('danger','warn','hidden');
  if(c.exact.length){box.classList.add('danger');box.textContent=`Esta hora já está ocupada por “${c.exact[0].title}”. Escolhe outra hora.`}
  else if(c.near.length){box.classList.add('warn');box.textContent=`Atenção: tens “${c.near[0].title}” às ${c.near[0].time}, a menos de 90 minutos.`}
  else box.classList.add('hidden');
}
function openJobForm(job=null){
  const form=document.getElementById('newJobForm');form.reset();state.editingJobId=job?.id||null;document.getElementById('jobFormEyebrow').textContent=job?'EDITAR SERVIÇO':'NOVO SERVIÇO';document.getElementById('jobFormTitle').textContent=job?'Alterar marcação':'Adicionar à agenda';document.getElementById('jobFormSubmit').textContent=job?'Guardar alterações':'Guardar serviço';document.getElementById('jobIdField').value=job?.id||'';
  state.formTags=uniqueTags(job?.tags||[]);renderSelectedTags();renderTagPresets();document.getElementById('customTagInput').value='';
  if(job){form.elements.client.value=job.client;form.elements.title.value=job.title;form.elements.location.value=job.location;form.elements.price.value=job.price;form.elements.notes.value=job.notes||'';state.jobDate=job.date;setSmartTime(job.time)}else{state.jobDate=state.selectedDate||getTodayIso();setSmartTime('')}
  document.getElementById('jobDateField').value=state.jobDate;const d=fromIsoDate(state.jobDate);jobCalendarMonth=new Date(d.getFullYear(),d.getMonth(),1);updateJobDateDisplay();renderJobCalendar();renderBusyTimes();handleRecurringClient();document.getElementById('newJobDialog').showModal();
}
function handleRecurringClient(){
  const input=document.getElementById('jobClientInput'),card=document.getElementById('recurringClientCard');if(!input||!card)return;const c=state.clients.find(x=>x.name.toLowerCase()===input.value.trim().toLowerCase());
  if(!c){card.classList.add('hidden');card.innerHTML='';return}const loc=document.querySelector('#newJobForm [name="location"]');if(loc&&!loc.value.trim()&&c.location)loc.value=c.location;
  card.classList.remove('hidden');card.innerHTML=`<div class="recurring-icon">↻</div><div><strong>Cliente recorrente</strong><span>${clientServiceCount(c.name)} serviços · ${esc(c.phone||'sem telemóvel')}${c.location?` · ${esc(c.location)}`:''}</span></div>`;
}
function askDeleteJob(id){state.pendingDeleteId=id;document.getElementById('jobDialog').close();document.getElementById('confirmDeleteDialog').showModal()}
function deletePendingJob(){if(!state.pendingDeleteId)return;const id=state.pendingDeleteId;state.jobs=state.jobs.filter(j=>j.id!==id);tombstone('job',id);if(state.activeJobId===id)state.activeJobId=null;state.pendingDeleteId=null;save();document.getElementById('confirmDeleteDialog').close();renderAll()}
function startJob(id){const j=state.jobs.find(x=>x.id===id);if(!j)return;if(state.activeJobId&&state.activeJobId!==j.id){alert('Já tens outro serviço em andamento.');return}j.status='active';j.startedAt=Date.now();touch(j);state.activeJobId=j.id;save();renderAll();openJob(j.id)}
function renderTimerArea(j){clearInterval(state.timerInterval);const a=document.getElementById('timerArea');if(j.status==='active'&&j.startedAt){a.innerHTML=`<div class="timer-panel"><div class="label">SERVIÇO EM ANDAMENTO</div><div class="timer-display" id="timerDisplay">00:00:00</div><div class="timer-meta">Iniciado às ${new Date(j.startedAt).toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'})}</div><button class="danger-btn" id="finishJobBtn">Terminar serviço</button></div>`;const tick=()=>{const el=document.getElementById('timerDisplay');if(el)el.textContent=fmtDuration((Date.now()-j.startedAt)/1000)};tick();state.timerInterval=setInterval(tick,1000);document.getElementById('finishJobBtn').onclick=()=>beginFinish(j)}else{a.innerHTML=`<div class="timer-panel"><div class="label">QUANDO CHEGARES AO CLIENTE</div><div class="timer-display">00:00:00</div><div class="timer-meta">O cronómetro guarda a hora de início.</div><button class="primary-btn" id="startJobBtn">▷ Iniciar serviço</button></div>`;document.getElementById('startJobBtn').onclick=()=>startJob(j.id)}}
function beginFinish(j){clearInterval(state.timerInterval);state.finishDuration=(Date.now()-j.startedAt)/1000;const a=document.getElementById('timerArea');a.innerHTML='';a.appendChild(document.getElementById('finishTemplate').content.cloneNode(true));document.getElementById('finalDuration').textContent=fmtDuration(state.finishDuration);setupSignature();document.getElementById('confirmFinish').onclick=()=>confirmFinish(j)}
function setupSignature(){const c=document.getElementById('signatureCanvas'),x=c.getContext('2d');x.lineWidth=5;x.lineCap='round';x.strokeStyle='#1c1713';let draw=false;const p=e=>{const r=c.getBoundingClientRect(),t=e.touches?.[0]||e;return{x:(t.clientX-r.left)*(c.width/r.width),y:(t.clientY-r.top)*(c.height/r.height)}};const s=e=>{e.preventDefault();draw=true;const q=p(e);x.beginPath();x.moveTo(q.x,q.y)};const m=e=>{if(!draw)return;e.preventDefault();const q=p(e);x.lineTo(q.x,q.y);x.stroke()};const end=()=>draw=false;['pointerdown','touchstart'].forEach(ev=>c.addEventListener(ev,s,{passive:false}));['pointermove','touchmove'].forEach(ev=>c.addEventListener(ev,m,{passive:false}));['pointerup','pointerleave','touchend'].forEach(ev=>c.addEventListener(ev,end));document.getElementById('clearSignature').onclick=()=>x.clearRect(0,0,c.width,c.height)}
function canvasHasInk(c){const b=document.createElement('canvas');b.width=c.width;b.height=c.height;return c.toDataURL()!==b.toDataURL()}
function ensureClient(name,location=''){let c=state.clients.find(c=>c.name.toLowerCase()===name.toLowerCase());if(!c){c=withUpdated({id:uid(),name,phone:'',location,notes:''});state.clients.push(c)}return c}
function confirmFinish(j){
  const c=document.getElementById('signatureCanvas');if(!canvasHasInk(c)){alert('Pede ao cliente para fazer a rubrica antes de concluir.');return}const payment=document.getElementById('paymentMethod').value;
  state.history.push(withUpdated({id:uid(),jobId:j.id,client:j.client,title:j.title,location:j.location,price:j.price,payment,duration:fmtDuration(state.finishDuration),date:todayString(),serviceDate:j.date,completedAt:nowIso(),tags:uniqueTags(j.tags),signature:c.toDataURL('image/png')}));ensureClient(j.client,j.location);state.jobs=state.jobs.filter(x=>x.id!==j.id);tombstone('job',j.id);state.activeJobId=null;save();document.getElementById('jobDialog').close();renderAll();alert('Serviço concluído ✓ O comprovativo ficou em Mais → Concluídos.')
}
function openClient(id){const c=state.clients.find(x=>x.id===id);if(!c)return;const d=document.getElementById('clientDialog'),h=document.getElementById('clientDialogContent');h.innerHTML=`<div class="dialog-head"><div><p class="eyebrow">CLIENTE</p><h2>${esc(c.name)}</h2></div><button class="icon-btn" id="closeClient">×</button></div><div class="client-detail-top"><div class="client-avatar">${esc(initials(c.name))}</div><div><h3>${esc(c.name)}</h3><p>${esc(c.phone||'Sem telemóvel')}${c.location?` · ${esc(c.location)}`:''}</p></div></div><div class="client-metrics"><div><span>SERVIÇOS</span><strong>${clientServiceCount(c.name)}</strong></div><div><span>FATURADO</span><strong>${formatEuro(clientSpent(c.name))}</strong></div></div><div class="client-notes">${esc(c.notes||'Sem notas guardadas.')}</div>`;document.getElementById('closeClient').onclick=()=>d.close();d.showModal()}
function setView(id){document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===id));document.querySelectorAll('.nav-item[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===id));window.scrollTo({top:0,behavior:'smooth'});if(id==='moreView')setTimeout(()=>renderZoneMap(false),80)}

// ---- Sincronização Supabase (opcional) ----
function cloudConfig(){
  const saved=JSON.parse(localStorage.getItem('mj_cloud_config')||'{}'),global=window.MONTAJA_CLOUD||{};
  return {url:String(saved.url||global.url||'').trim(),anonKey:String(saved.anonKey||global.anonKey||global.publishableKey||'').trim()};
}
function renderSyncSummary(){const c=cloudConfig(),el=document.getElementById('syncSummary');if(el)el.textContent=c.url&&c.anonKey?'Nuvem configurada · iPhone ↔ PC':'Por configurar · iPhone ↔ PC'}
async function getSupabase(){
  const cfg=cloudConfig();if(!cfg.url||!cfg.anonKey)throw new Error('Preenche o Supabase URL e a chave anon/publishable.');const key=`${cfg.url}|${cfg.anonKey}`;if(supabaseClient&&supabaseConfigKey===key)return supabaseClient;
  const mod=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');supabaseClient=mod.createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,storageKey:'montaja-auth'}});supabaseConfigKey=key;return supabaseClient;
}
function setSyncStatus(text,sub=''){const a=document.getElementById('syncStatus'),b=document.getElementById('syncLastRun');if(a)a.textContent=text;if(b)b.textContent=sub}
async function refreshSyncStatus(){
  const cfg=cloudConfig();document.getElementById('syncUrl').value=cfg.url;document.getElementById('syncKey').value=cfg.anonKey;
  if(!cfg.url||!cfg.anonKey){setSyncStatus('Por configurar','Adiciona o URL e a chave do Supabase.');return}
  try{const sb=await getSupabase(),{data:{user}}=await sb.auth.getUser();if(user){document.getElementById('syncEmail').value=user.email||'';setSyncStatus('Ligado',`Conta: ${user.email||'ativa'}`)}else setSyncStatus('Ligação pronta','Entra com a mesma conta no iPhone e no PC.')}catch(e){setSyncStatus('Erro de ligação',e.message)}
}
function localItemsByKind(kind){return kind==='job'?state.jobs:kind==='client'?state.clients:state.history}
function findLocal(kind,id){return localItemsByKind(kind).find(x=>x.id===id)}
function setLocal(kind,item){const arr=localItemsByKind(kind),i=arr.findIndex(x=>x.id===item.id);if(i>=0)arr[i]=item;else arr.push(item)}
function removeLocal(kind,id){if(kind==='job')state.jobs=state.jobs.filter(x=>x.id!==id);if(kind==='client')state.clients=state.clients.filter(x=>x.id!==id);if(kind==='history')state.history=state.history.filter(x=>x.id!==id)}
async function syncNow({silent=false}={}){
  try{
    if(!navigator.onLine)throw new Error('Sem internet. Os dados continuam guardados neste dispositivo.');const sb=await getSupabase(),{data:{user}}=await sb.auth.getUser();if(!user)throw new Error('Entra na conta para sincronizar.');if(!silent)setSyncStatus('A sincronizar…','A comparar dados do iPhone/PC.');
    const {data:remote,error}=await sb.from('montaja_data').select('*').eq('user_id',user.id);if(error)throw error;const remoteMap=new Map((remote||[]).map(r=>[`${r.kind}:${r.item_id}`,r]));const uploads=[];
    for(const kind of ['job','client','history'])for(const item of localItemsByKind(kind)){const r=remoteMap.get(`${kind}:${item.id}`),lt=Date.parse(item.updatedAt||0),rt=r?Date.parse(r.updated_at||0):0;if(!r||lt>rt)uploads.push({user_id:user.id,kind,item_id:item.id,data:item,deleted:false,updated_at:item.updatedAt||nowIso()})}
    for(const del of state.deleted){const r=remoteMap.get(`${del.kind}:${del.itemId}`),lt=Date.parse(del.updatedAt||0),rt=r?Date.parse(r.updated_at||0):0;if(!r||lt>rt)uploads.push({user_id:user.id,kind:del.kind,item_id:del.itemId,data:{},deleted:true,updated_at:del.updatedAt})}
    if(uploads.length){const {error:upErr}=await sb.from('montaja_data').upsert(uploads,{onConflict:'user_id,kind,item_id'});if(upErr)throw upErr}
    const {data:finalRows,error:finalErr}=await sb.from('montaja_data').select('*').eq('user_id',user.id);if(finalErr)throw finalErr;
    for(const r of finalRows||[]){const local=findLocal(r.kind,r.item_id),del=state.deleted.find(x=>x.kind===r.kind&&x.itemId===r.item_id),localT=Math.max(local?Date.parse(local.updatedAt||0):0,del?Date.parse(del.updatedAt||0):0),remoteT=Date.parse(r.updated_at||0);if(remoteT<localT)continue;if(r.deleted){removeLocal(r.kind,r.item_id);if(del)del.updatedAt=r.updated_at;else state.deleted.push({kind:r.kind,itemId:r.item_id,updatedAt:r.updated_at})}else{setLocal(r.kind,withUpdated({...r.data,id:r.item_id,updatedAt:r.updated_at}));state.deleted=state.deleted.filter(x=>!(x.kind===r.kind&&x.itemId===r.item_id))}}
    state.activeJobId=state.jobs.find(j=>j.status==='active')?.id||null;save({cloud:false});renderAll();const stamp=new Date().toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'});localStorage.setItem('mj_last_sync',stamp);setSyncStatus('Sincronizado',`Última sincronização às ${stamp}`);return true;
  }catch(e){if(!silent)setSyncStatus('Não sincronizado',e.message);return false}
}
function scheduleCloudSync(){clearTimeout(state.syncTimer);const cfg=cloudConfig();if(!cfg.url||!cfg.anonKey||!navigator.onLine)return;state.syncTimer=setTimeout(()=>syncNow({silent:true}),1200)}

// Navegação
for(const b of document.querySelectorAll('.nav-item[data-view]'))b.onclick=()=>setView(b.dataset.view);for(const b of document.querySelectorAll('[data-go]'))b.onclick=()=>setView(b.dataset.go);
document.getElementById('quickAdd').onclick=()=>openJobForm();document.getElementById('agendaAddBtn').onclick=()=>openJobForm();document.getElementById('newClientBtn').onclick=()=>document.getElementById('newClientDialog').showModal();document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close).close());
document.getElementById('viewAllJobs').onclick=()=>setView('agendaView');document.getElementById('earningsCard').onclick=()=>setView('moreView');document.getElementById('historyButton').onclick=()=>document.getElementById('historyList').scrollIntoView({behavior:'smooth'});document.getElementById('billingButton').onclick=()=>setView('moreView');document.getElementById('profileBtn').onclick=()=>document.getElementById('profileDialog').showModal();document.getElementById('notificationsBtn').onclick=()=>{renderNotifications();document.getElementById('notificationsDialog').showModal()};

// Agenda + filtros
document.getElementById('agendaPrevMonth').onclick=()=>{agendaCalendarMonth=moveMonth(agendaCalendarMonth,-1);renderAgendaCalendar()};document.getElementById('agendaNextMonth').onclick=()=>{agendaCalendarMonth=moveMonth(agendaCalendarMonth,1);renderAgendaCalendar()};
document.getElementById('agendaTodayBtn').onclick=()=>{state.selectedDate=getTodayIso();state.agendaMode='day';const d=fromIsoDate(state.selectedDate);agendaCalendarMonth=new Date(d.getFullYear(),d.getMonth(),1);renderAll()};document.getElementById('agendaTomorrowBtn').onclick=()=>{state.selectedDate=shiftDate(getTodayIso(),1);state.agendaMode='day';const d=fromIsoDate(state.selectedDate);agendaCalendarMonth=new Date(d.getFullYear(),d.getMonth(),1);renderAll()};document.getElementById('agendaWeekBtn').onclick=()=>{state.agendaMode=state.agendaMode==='week'?'day':'week';renderAll()};
document.getElementById('jobSearch').addEventListener('input',e=>{state.agendaSearch=e.target.value;renderAgenda()});document.getElementById('jobTypeFilter').addEventListener('change',e=>{state.agendaType=e.target.value;renderAgenda()});document.getElementById('jobStatusFilter').addEventListener('change',e=>{state.agendaStatus=e.target.value;renderAgenda()});document.getElementById('jobClientFilter').addEventListener('change',e=>{state.agendaClient=e.target.value;renderAgenda()});document.getElementById('jobTagFilter').addEventListener('change',e=>{state.agendaTag=e.target.value;renderAgenda()});document.getElementById('clearJobFilters').onclick=()=>{state.agendaSearch='';state.agendaType='all';state.agendaStatus='all';state.agendaClient='all';state.agendaTag='all';document.getElementById('jobSearch').value='';document.getElementById('jobTypeFilter').value='all';document.getElementById('jobStatusFilter').value='all';document.getElementById('jobClientFilter').value='all';document.getElementById('jobTagFilter').value='all';renderAgenda()};

// Calendário do formulário
document.getElementById('jobPrevMonth').onclick=()=>{jobCalendarMonth=moveMonth(jobCalendarMonth,-1);renderJobCalendar()};document.getElementById('jobNextMonth').onclick=()=>{jobCalendarMonth=moveMonth(jobCalendarMonth,1);renderJobCalendar()};document.querySelectorAll('[data-job-quick]').forEach(btn=>btn.onclick=()=>{const key=btn.dataset.jobQuick;state.jobDate=key==='today'?getTodayIso():key==='tomorrow'?shiftDate(getTodayIso(),1):shiftDate(getTodayIso(),7);document.getElementById('jobDateField').value=state.jobDate;const d=fromIsoDate(state.jobDate);jobCalendarMonth=new Date(d.getFullYear(),d.getMonth(),1);updateJobDateDisplay();renderJobCalendar();renderBusyTimes();updateTimeWarning()});

// Hora inteligente
const hourInput=document.getElementById('jobHour'),minuteInput=document.getElementById('jobMinute'),priceInput=document.getElementById('jobPriceInput');
hourInput.addEventListener('input',()=>{hourInput.value=hourInput.value.replace(/\D/g,'').slice(0,2);const v=hourInput.value;if(v.length===1&&Number(v)>2){hourInput.value=`0${v}`;minuteInput.focus();minuteInput.select()}else if(v.length===2){const n=Math.min(23,Number(v));hourInput.value=pad(n);minuteInput.focus();minuteInput.select()}syncTimeHidden()});
hourInput.addEventListener('blur',()=>{if(hourInput.value)hourInput.value=pad(Math.min(23,Number(hourInput.value)||0));syncTimeHidden()});
minuteInput.addEventListener('input',()=>{minuteInput.value=minuteInput.value.replace(/\D/g,'').slice(0,2);if(minuteInput.value.length===2){minuteInput.value=pad(Math.min(59,Number(minuteInput.value)));syncTimeHidden();priceInput.focus()}else syncTimeHidden()});minuteInput.addEventListener('blur',()=>{if(minuteInput.value)minuteInput.value=pad(Math.min(59,Number(minuteInput.value)||0));syncTimeHidden()});
for(const el of [hourInput,minuteInput])el.addEventListener('focus',()=>el.select());
document.getElementById('jobClientInput').addEventListener('input',handleRecurringClient);document.getElementById('jobClientInput').addEventListener('change',handleRecurringClient);

document.getElementById('newJobForm').addEventListener('submit',e=>{
  e.preventDefault();const time=syncTimeHidden();if(!time){alert('Indica uma hora válida.');hourInput.focus();return}const conflicts=timeConflicts(state.jobDate,time,state.editingJobId);if(conflicts.exact.length){alert(`A hora ${time} já está ocupada por “${conflicts.exact[0].title}”.`);hourInput.focus();return}
  const f=new FormData(e.currentTarget),client=String(f.get('client')).trim(),date=String(f.get('date')||state.jobDate||getTodayIso());ensureClient(client,String(f.get('location')||''));const data={client,title:String(f.get('title')).trim(),location:String(f.get('location')).trim(),date,time,price:Number(f.get('price')),notes:String(f.get('notes')||''),tags:uniqueTags(state.formTags)};
  if(state.editingJobId){const j=state.jobs.find(x=>x.id===state.editingJobId);if(j){Object.assign(j,data);touch(j)}}else state.jobs.push(withUpdated({id:uid(),...data,status:'scheduled',startedAt:null}));state.selectedDate=date;state.agendaMode='day';const d=fromIsoDate(date);agendaCalendarMonth=new Date(d.getFullYear(),d.getMonth(),1);state.editingJobId=null;save();renderAll();e.currentTarget.reset();document.getElementById('newJobDialog').close();setView('agendaView');
});
document.getElementById('newClientForm').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget);state.clients.push(withUpdated({id:uid(),name:String(f.get('name')).trim(),phone:String(f.get('phone')||'').trim(),location:String(f.get('location')||'').trim(),notes:String(f.get('notes')||'').trim()}));save();renderAll();e.currentTarget.reset();document.getElementById('newClientDialog').close()});document.getElementById('clientSearch').addEventListener('input',e=>renderClients(e.target.value));document.getElementById('cancelDeleteJob').onclick=()=>{state.pendingDeleteId=null;document.getElementById('confirmDeleteDialog').close()};document.getElementById('confirmDeleteJob').onclick=deletePendingJob;

// Tags, tema e mapa
document.querySelectorAll('#tagPresets [data-tag]').forEach(btn=>btn.onclick=()=>{const t=btn.dataset.tag;state.formTags=state.formTags.includes(t)?state.formTags.filter(x=>x!==t):uniqueTags([...state.formTags,t]);renderSelectedTags();renderTagPresets()});
document.getElementById('addCustomTag').onclick=()=>{const input=document.getElementById('customTagInput');addFormTag(input.value);input.value='';input.focus()};document.getElementById('customTagInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();document.getElementById('addCustomTag').click()}});
document.querySelectorAll('[data-theme-choice]').forEach(btn=>btn.onclick=()=>applyTheme(btn.dataset.themeChoice));
const mq=matchMedia('(prefers-color-scheme: light)');if(mq.addEventListener)mq.addEventListener('change',()=>{if(currentThemeChoice()==='system')applyTheme('system')});
document.getElementById('refreshMapBtn').onclick=()=>renderZoneMap(true);

// Sincronização
document.getElementById('syncButton').onclick=()=>{refreshSyncStatus();document.getElementById('syncDialog').showModal()};
document.getElementById('saveCloudConfig').onclick=()=>{const url=document.getElementById('syncUrl').value.trim(),anonKey=document.getElementById('syncKey').value.trim();localStorage.setItem('mj_cloud_config',JSON.stringify({url,anonKey}));supabaseClient=null;supabaseConfigKey='';renderSyncSummary();refreshSyncStatus()};
document.getElementById('syncSignUp').onclick=async()=>{try{const sb=await getSupabase(),email=document.getElementById('syncEmail').value.trim(),password=document.getElementById('syncPassword').value;const {error}=await sb.auth.signUp({email,password});if(error)throw error;setSyncStatus('Conta criada','Confirma o email se o Supabase pedir confirmação.')}catch(e){setSyncStatus('Erro',e.message)}};
document.getElementById('syncSignIn').onclick=async()=>{try{const sb=await getSupabase(),email=document.getElementById('syncEmail').value.trim(),password=document.getElementById('syncPassword').value;const {error}=await sb.auth.signInWithPassword({email,password});if(error)throw error;setSyncStatus('Ligado',`Conta: ${email}`);await syncNow()}catch(e){setSyncStatus('Erro',e.message)}};
document.getElementById('syncNowBtn').onclick=()=>syncNow();document.getElementById('syncSignOut').onclick=async()=>{try{const sb=await getSupabase();await sb.auth.signOut();setSyncStatus('Sessão terminada','Entra novamente para sincronizar.')}catch(e){setSyncStatus('Erro',e.message)}};

if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('sw.js').catch(()=>{});window.addEventListener('beforeunload',()=>clearInterval(state.timerInterval));window.addEventListener('online',()=>scheduleCloudSync());
let lastKnownToday=getTodayIso();setInterval(()=>{const now=getTodayIso();if(now!==lastKnownToday){if(state.selectedDate===lastKnownToday){state.selectedDate=now;const d=fromIsoDate(now);agendaCalendarMonth=new Date(d.getFullYear(),d.getMonth(),1)}lastKnownToday=now;renderAll()}},60000);
applyTheme(currentThemeChoice());renderAll();scheduleCloudSync();setInterval(()=>renderNotifications(),60000);
