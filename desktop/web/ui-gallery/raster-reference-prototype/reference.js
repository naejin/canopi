/* HTML review reference. All state is synthetic, in memory, and reset on reload.
 * This implements the specified proposal, not alternate product architectures.
 * Do not import this file into production or treat it as scientific evidence. */
(() => {
  'use strict';
  const pages = {
    data: { title: 'Data', slice: 'U', description: 'Reusable datasets, job status and library management.', states: ['ready', 'empty', 'loading', 'error', 'busy', 'history', 'delete', 'rename', 'missing', 'long'] },
    import: { title: 'Import data', slice: 'U', description: 'One import action. Explicit interpretation and overlap precedence.', states: ['ready', 'existing', 'progress', 'complete', 'no-change', 'cancelled', 'error', 'busy', 'incompatible', 'disk-full', 'interrupted', 'session-changed'] },
    analysis: { title: 'Analysis', slice: 'U', description: 'Ground-elevation eligibility, slope units and independent results.', states: ['ready', 'empty', 'running', 'complete', 'refreshing', 'failed', 'cancelled', 'engine-missing'] },
    layers: { title: 'Layers', slice: 'U / D', description: 'Flat geographic stack, independent visibility, style and ordering.', states: ['ready', 'empty', 'missing', 'tile-error', 'refreshing', 'unknown-style', 'removed', 'long'] },
    inspection: { title: 'Inspect raster', slice: 'I', description: 'Explicit read-only sampling mode, with a keyboard path.', states: ['ready', 'value', 'no-data', 'loading', 'unavailable', 'inactive'] },
    location: { title: 'Location', slice: 'W', description: 'Web coordinates and map placement; Desktop retains address search.', states: ['provisional', 'selected', 'confirmed', 'map-error', 'invalid', 'cancelled', 'undone', 'session-changed'] },
    basemaps: { title: 'Basemap', slice: 'B', description: 'Street, MapTiler, and both Google Satellite access paths.', states: ['keyless', 'official', 'loading', 'invalid-key', 'quota', 'offline', 'maptiler-missing', 'attribution-error', 'save-error'] },
  };
  const icons = { data: '▧', import: '+', analysis: '∠', layers: '≋', inspection: '⌖', location: '◎', basemaps: '◫' };
  const root = document.getElementById('reference-root');
  const escape = (value) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let page = document.body.dataset.page;
  let params = new URLSearchParams(location.search);
  let state = params.get('state') || pages[page]?.states[0] || 'ready';
  let theme = params.get('theme') === 'dark' ? 'dark' : 'light';
  let edition = params.get('edition') === 'web' ? 'web' : 'desktop';
  let narrow = params.get('width') === 'narrow';
  let selected = 'ground';
  let interpretation = '';
  let destination = 'new';
  let replace = false;
  let units = 'degrees';
  let style = 'default';
  let opacity = 85;
  let provider = 'google';
  let hasKey = false;
  let imported = false;
  let attached = false;
  let job = null;
  let analysisJob = null;
  let drafts = {};
  let inspect = page === 'inspection' && state !== 'inactive';
  let removed = false;
  let notice = '';
  let design = 'La Magnerie · orchard design';
  let candidate = null;
  let committed = null;
  let oldLocation = null;
  let datasetName = 'Ground elevation';
  let resultName = 'Terrain slope';
  let layers = [{ id: 'slope', name: 'Terrain slope', meta: 'Result · degrees', visible: true }, { id: 'ground', name: 'Ground elevation', meta: 'Source · metres', visible: false }, { id: 'height', name: 'Vegetation height', meta: 'Source · metres', visible: false }];
  const btn = (label, action, cls = '', disabled = false) => `<button type="button" data-action="${action}" class="${cls}" aria-label="${escape(label === '×' ? 'Close panel' : label === '↑' ? `Move ${action.split(':')[1]} up` : label === '↓' ? `Move ${action.split(':')[1]} down` : label)}" ${disabled ? 'disabled' : ''}>${label}</button>`;
  const link = (target, label, scenario = '') => `<a href="${target}.html${scenario ? `?state=${scenario}` : ''}" data-nav="${target}" data-state="${scenario}">${label}</a>`;
  const note = (title, text, error = false) => `<div class="notice${error ? ' error' : ''}" role="${error ? 'alert' : 'status'}"><strong>${title}</strong>${text}</div>`;
  const facts = (items) => `<dl class="facts">${items.map(([a,b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>`;
  const field = (label, id, value, extra = '') => `<div class="field"><label for="${id}">${label}</label><input id="${id}" value="${escape(drafts[id] ?? value)}" ${extra}></div>`;
  const choice = (label, detail, action, active, disabled = false) => `<button type="button" class="choice" data-action="${action}" aria-pressed="${active}" ${disabled ? 'disabled' : ''}>${label}<small>${detail}</small></button>`;

  function hydrateScenario() {
    drafts = {};
    if (page === 'import') destination = state === 'existing' ? 'existing' : 'new';
    if (page === 'inspection') inspect = state !== 'inactive';
    if (page === 'basemaps') { hasKey = ['official', 'loading', 'invalid-key', 'quota', 'attribution-error', 'save-error'].includes(state); provider = state === 'maptiler-missing' ? 'maptiler' : 'google'; }
    if (page === 'location') { committed = state === 'confirmed' ? { lat: 47.2184, lon: -.5546 } : null; candidate = state === 'selected' ? { lat: 47.2191, lon: -.5528 } : null; }
    removed = page === 'layers' && state === 'removed';
    if (state === 'long') datasetName = 'Ground elevation · eastern orchard and north-facing boundary survey, autumn 2025';
    else datasetName = 'Ground elevation';
  }
  function url() {
    const query = new URLSearchParams({ state, theme, edition });
    if (narrow) query.set('width', 'narrow');
    history.replaceState(null, '', `${page}.html?${query}`);
  }
  function go(target, scenario, reset = false) {
    if (page === 'location' && target !== 'location') candidate = null;
    if (target === 'location') inspect = false;
    page = pages[target] ? target : 'index';
    state = scenario || pages[page]?.states[0] || 'ready';
    if (reset) hydrateScenario();
    if (page === 'import' && !scenario && job) state = job.status;
    if (page === 'analysis' && !scenario && analysisJob) state = analysisJob.status;
    if (page === 'inspection') inspect = state !== 'inactive';
    notice = '';
    url(); render();
    document.querySelector('.dock-body')?.scrollTo(0, 0);
  }
  function reviewBar() {
    return `<div class="review"><a href="index.html" data-nav="index" class="reference-tag">CANOPI / UI REFERENCE · NOT YET APPROVED</a><div class="grow"></div>${page !== 'index' ? `<label>State<select id="scenario" aria-label="Reference state">${pages[page].states.map(s => `<option ${s === state ? 'selected' : ''}>${s}</option>`).join('')}</select></label>` : ''}<label>Edition<select id="edition"><option value="desktop" ${edition === 'desktop' ? 'selected' : ''}>Desktop</option><option value="web" ${edition === 'web' ? 'selected' : ''}>Web</option></select></label>${btn(theme === 'dark' ? 'Light theme' : 'Dark theme', 'theme')}${btn(narrow ? 'Full width' : 'Narrow width', 'width')}${btn('Reset', 'reset')}</div>`;
  }
  function terrain() {
    const plants = Array.from({length: 25}, (_,i) => { const x = 270+(i%5)*58+(Math.floor(i/5)%2)*18; const y = 205+Math.floor(i/5)*65; return `<g><circle cx="${x}" cy="${y}" r="${16+i%4*3}" fill="var(--color-edible)" fill-opacity=".23" stroke="var(--color-edible)" stroke-width="1.5"/><path d="M${x-5} ${y}h10 M${x} ${y-5}v10" stroke="var(--color-edible)"/></g>`; }).join('');
    const contours = Array.from({length: 15}, (_,i) => `<path d="M-100 ${i*55} C160 ${i*55-160} 300 ${i*55+150} 440 ${i*55+10} S650 ${i*55-90} 900 ${i*55-20}"/>`).join('');
    const rasterVisible = edition === 'desktop' && layers.some(l => l.visible) && state !== 'empty' && !removed;
    return `<svg class="terrain" viewBox="0 0 800 700" preserveAspectRatio="xMidYMid slice" aria-label="Illustrated orchard canvas; synthetic raster and plant data"><defs><pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0V30" fill="none" stroke="var(--canvas-grid-major)" stroke-width=".6"/></pattern><linearGradient id="raster" x2="1" y2="1"><stop stop-color="#deebf7"/><stop offset=".45" stop-color="#d6be78"/><stop offset="1" stop-color="#966034"/></linearGradient></defs><rect width="800" height="700" fill="var(--canvas-bg)"/>${rasterVisible ? `<path d="M195 125L660 190 603 593 151 515Z" fill="url(#raster)" opacity="${opacity/240}"/>` : ''}<g fill="none" stroke="var(--color-border-strong)" stroke-width="1">${contours}</g><path d="M165 170L605 145 680 490 210 580Z" fill="none" stroke="var(--color-text-muted)" stroke-width="1.5" stroke-dasharray="5 4"/><rect width="800" height="700" fill="url(#grid)"/>${plants}<path d="M200 565 Q390 530 620 555" stroke="var(--color-text-muted)" stroke-width="2" fill="none"/><g fill="var(--color-text-muted)" font-family="sans-serif" font-size="11"><text x="260" y="173">NORTH ORCHARD</text><text x="360" y="579">Access path</text></g>${inspect ? '<g stroke="var(--color-primary)" stroke-width="2"><circle cx="415" cy="355" r="12" fill="none"/><path d="M395 355h40 M415 335v40"/></g>' : ''}</svg>`;
  }
  function jobView(status, kind = 'import') {
    const progress = ['progress','running','refreshing'].includes(status);
    const failed = ['error','failed','disk-full','incompatible','interrupted'].includes(status);
    const title = {progress:'Importing 12 files',running:'Calculating slope',refreshing:'Refreshing terrain slope',complete:kind === 'import' ? 'Import complete' : 'Slope ready','no-change':'No changes to the dataset',cancelled:'Job cancelled',error:'Could not read source file',failed:'Slope refresh failed','disk-full':'Not enough temporary disk space',incompatible:'This batch cannot be imported',interrupted:'Import interrupted',busy:'Another raster job is running','session-changed':'Import completed in the library'}[status] || 'Job status';
    const detail = {error:'Tile 0447_6807.tif could not be decoded. No files in this batch were applied.',incompatible:'Tile 0447_6807.tif uses an unaligned grid. Choose compatible files.', 'disk-full':'Free more disk space, then retry. The previous dataset is unchanged.', interrupted:'The app closed before publication. Your previous dataset and original files remain intact.',failed:'The last complete result is still visible. Retry to use the latest ground data.', 'no-change':'All incoming valid pixels are already represented. No generation was created.',cancelled:'No new data was published. The previous dataset remains available.',busy:'Wait for the current job to finish. This import has not started.','session-changed':'The originating Design was closed. No layer was added to this Design.'}[status];
    return `<div class="stack">${note(title, detail || (progress ? 'You can close this panel. Work continues in the library.' : 'Available for reuse in any Design.'), failed)}${progress ? `<div><div class="row spread"><span>${status === 'refreshing' ? 'Reading newest generation' : 'Processing source blocks'}</span><span class="mono">42%</span></div><progress value="42" max="100" aria-label="Job progress"></progress><small>${kind === 'import' ? '5 of 12 files · 80 MB read' : 'Previous complete result remains visible'}</small></div>${btn('Cancel job','cancel-job')}` : ''}${status === 'complete' ? facts([['Dataset',escape(kind === 'import' ? 'Vegetation height' : resultName)],['Valid coverage','12.0 km²'],['Resolution','0.5 m'],['Generation','g-004']]) : ''}${failed ? btn('Review request and retry','retry','primary') : ''}${['complete','no-change','cancelled','session-changed'].includes(status) ? btn('Back to Data','data') : ''}</div>`;
  }
  function dataView() {
    if (state === 'empty') return `<div class="empty"><div class="empty-mark">▧</div><h2>Your geographic data, together</h2><p class="muted">Import a numeric GeoTIFF to build a reusable dataset. Add it to any Design when you need it.</p>${btn('Import files','import','primary')}<small>Ground elevation, surface elevation and height data.</small></div>`;
    if (state === 'loading') return note('Loading your library','Reading dataset information…');
    if (state === 'error') return `${note('Library unavailable','Could not open the local library. Your Design references are preserved.',true)}<div class="rule"></div>${btn('Try again','reload','primary')}`;
    if (state === 'history') return `<div class="stack">${btn('‹ Back to Data','data','quiet')}<h3>${escape(datasetName)}</h3><p class="muted">Library history · separate from Design undo</p>${[4,3,2].map(n=>`<div class="dataset"><div class="row spread"><strong>Import ${n}</strong><span class="badge">${n===4?'Current':'Retained'}</span></div><small>18 September · ${n===4?'12':'4'} files · ${n===4?'replace overlap':'keep existing'}</small><div class="dataset-actions">${btn('Undo this import',`undo-import:${n}`)}</div></div>`).join('')}<p class="muted">Undo rebuilds accepted coverage without this import. Original files remain in the library.</p></div>`;
    if (state === 'delete') return `<div class="stack">${btn('‹ Back to Data','data','quiet')}<h2>Delete from library?</h2><p>${escape(datasetName)}</p>${note('This affects more than this Design','Deletes 1 dependent analysis and removes 2 references from the open Design.',true)}<p class="muted">Other saved Designs may still refer to this dataset and will show it as unavailable.</p><p>Original shared source files are retained. Use Remove from Design if you only want to detach this layer.</p><div class="row">${btn('Cancel','data')}${btn('Delete from library','delete-library','danger')}</div></div>`;
    if (state === 'rename') return `<div class="stack">${btn('‹ Back to Data','data','quiet')}${field('Dataset name','dataset-name',datasetName)}<p class="muted">Renaming changes the library name. It does not recompute data or dirty other Designs.</p><div class="row">${btn('Cancel','data')}${btn('Save name','save-name','primary')}</div></div>`;
    return `<div class="row spread"><span class="muted">Reusable library</span>${btn('Import files','import','primary')}</div>${state === 'busy' ? `<div class="rule"></div>${jobView('progress')}` : ''}${job ? `<div class="notice"><strong>${job.status === 'complete' ? 'Import complete' : job.status === 'cancelled' ? 'Import cancelled' : 'Import in progress · 42%'}</strong>${link('import','View job',job.status)}</div>` : ''}<div class="section-label">Datasets · ${imported?3:2}</div>${[['ground',datasetName,'Ground elevation · m','4.0 million valid cells · 0.5 m'],['height','Vegetation height','Above-ground height · m','48 million cells · 0.5 m']].map(([id,name,meaning,coverage])=>`<article class="dataset"><div class="row"><span class="dataset-icon">▧</span><div class="grow"><h3>${escape(name)}</h3><small>${meaning}</small></div><span class="badge">${state==='missing'&&id==='ground'?'Unavailable':'Ready'}</span></div><p class="muted" style="margin-top:8px">${coverage}</p><div class="dataset-actions">${btn(attached?'Added to Design':'Add to Design','attach','',attached)}${btn('Add files','existing')}</div>${id==='ground'?`<details><summary>Manage dataset</summary><div class="dataset-actions">${btn('Rename','rename')}${btn('Import history','history')}${btn('Delete from library','delete','danger')}</div></details>`:''}</article>`).join('')}${state==='missing'?note('Original asset unavailable','The saved reference is preserved. Restore the library asset to display it.',true):''}<p class="muted" style="margin-top:16px">Library changes stay separate from Design presentation.</p>`;
  }
  function importView() {
    if (!['ready','existing'].includes(state)) return jobView(state);
    return `${btn('‹ Data','data','quiet')}<div class="rule"></div><div class="row spread"><h3>Selected files</h3><span class="badge">12 files · 192 MB</span></div><small>Displayed order determines overlap precedence.</small><ul class="files">${Array.from({length:12},(_,i)=>`<li><span>${String(i+1).padStart(2,'0')} · IGN_${445+Math.floor(i/3)}_${6806+i%3}_MNH.tif</span><span>16 MB</span></li>`).join('')}</ul><div class="field" style="margin-top:16px"><label>Destination</label>${choice('New dataset','Create reusable data in the library','dest:new',destination==='new')}${choice('Vegetation height','Add files to compatible existing data','dest:existing',destination==='existing')}</div>${destination==='new'?`${field('Dataset name','new-name','Vegetation height')}<div class="field"><label>What do these values measure?</label>${[['ground','Ground elevation','Bare-earth terrain · metres'],['surface','Surface elevation','Top surface · metres'],['height','Above-ground height','Relative to ground · metres'],['other','Other continuous','Display only · declare units']].map(([id,title,desc])=>choice(title,desc,`kind:${id}`,interpretation===id)).join('')}</div>${interpretation==='other'?field('Units (or “unknown”)','other-units','unknown'):''}`:facts([['Interpretation','Above-ground height'],['Units','Metres'],['Grid','0.5 m · aligned']])}<label class="checkbox"><input type="checkbox" id="replace" ${replace?'checked':''}><span><strong>Replace existing data where these files overlap</strong><small style="display:block">${replace?'Incoming valid pixels win. Last valid file wins within this batch.':'Existing valid pixels win. First valid file wins within this batch.'} NoData never erases valid data.</small></span></label><div class="rule"></div><p class="muted">Uncovered valid pixels are always added. One incompatible file fails the whole batch.</p>`;
  }
  function analysisView() {
    if (state === 'empty') return `<div class="empty"><div class="empty-mark">∠</div><h2>Start with ground data</h2><p class="muted">Slope needs ground elevation in metres. Import a dataset first.</p>${btn('Go to Data','data','primary')}</div>`;
    if (['running','refreshing','failed','cancelled','complete'].includes(state)) return `${jobView(state,'analysis')}<div class="rule"></div>${btn('View result in Layers','layers')}`;
    return `${state==='engine-missing'?note('Processing engine unavailable','Install the qualified processing assets before running an analysis. Existing results remain readable.',true):''}<div class="field"><label>Operation</label>${choice('Slope','Terrain steepness from ground elevation','operation',true)}</div><div class="field"><label>Input dataset</label>${choice(escape(datasetName),'Ground elevation · metres · 0.5 m','select-ground',true)}${choice('Vegetation height','Ineligible: above-ground height is not ground elevation','ineligible',false,true)}${choice('Surface elevation','Ineligible: includes buildings and vegetation','ineligible',false,true)}</div>${field('Result name','result-name',resultName)}<div class="field"><label>Output units</label><div class="row">${choice('Degrees','0–90°','units:degrees',units==='degrees')}${choice('Percent','Rise / run × 100','units:percent',units==='percent')}</div></div><div class="notice">Uses full-resolution ground data. Visibility and map zoom do not affect the result.</div><div class="rule"></div><h3>Saved analyses</h3><div class="dataset"><div class="row spread"><span>Terrain slope</span><span class="badge">Ready</span></div><small>Ground elevation · generation g-003 · degrees</small><div class="dataset-actions">${btn('Show in Layers','layers')}</div></div>`;
  }
  function layersView() {
    const selectedLayer=layers.find(l=>l.id===selected)||layers[0];
    return `<div class="section-label" style="margin-top:0">Design layers · top to bottom</div><div class="layer-row"><span>◉</span><span class="grow">Plants <small>25 Design objects</small></span><span class="badge">Active</span></div><div class="layer-row"><span>◉</span><span class="grow">Zones <small>1 boundary</small></span><span>♧</span></div><div class="section-label">Geographic layers · above basemap</div>${removed ? `${note('Removed from this Design','The library dataset and result still exist.')} ${btn('Undo removal','undo-remove')}` : ''}${state==='empty'?`<div class="empty"><p class="muted">No geographic data in this Design.</p>${btn('Add from Data','data')}</div>`:layers.filter(l=>!removed||l.id!==selected).map((l,i)=>`<div class="layer-row ${l.id===selected?'selected':''}"><button data-action="eye:${l.id}" aria-label="${l.visible?'Hide':'Show'} ${escape(l.name)}" aria-pressed="${l.visible}">${l.visible?'◉':'○'}</button><button class="layer-name" data-action="layer:${l.id}"><strong>${escape(state==='long'&&l.id==='ground'?datasetName:l.name)}</strong><small>${l.meta}</small></button><div class="layer-order">${btn('↑',`up:${l.id}`,'',i===0)}${btn('↓',`down:${l.id}`,'',i===layers.length-1)}</div></div>`).join('')}<div class="section-label">Site references</div><div class="layer-row"><span>◉</span><span class="grow">Street basemap</span>${btn('Settings','basemaps','quiet')}</div>${state==='empty'||removed?'':`<div class="rule"></div><h3>${escape(selectedLayer.name)}</h3>${['missing','tile-error','refreshing','unknown-style'].includes(state)?`<div style="margin:12px 0">${note({missing:'Library reference unavailable','tile-error':'Display tiles unavailable',refreshing:'Refreshing · previous result visible','unknown-style':'Unsupported saved style'}[state],{missing:'This reference is preserved. Restore its local library assets.','tile-error':'Numeric data is safe. Other layers and editing remain available.',refreshing:'A replacement publishes only when complete.','unknown-style':'Using the default ramp. The saved style value is preserved.'}[state],['missing','tile-error'].includes(state))}</div>`:''}<label class="field" style="margin-top:12px">Opacity <span class="row"><input type="range" id="opacity" min="0" max="100" value="${opacity}" aria-label="Layer opacity"><output id="opacity-value">${opacity}%</output></span></label><div class="field"><label>Color ramp</label><div class="row">${btn('Default','style:default',style==='default'?'primary':'')}${btn('Grayscale','style:gray',style==='gray'?'primary':'')}</div></div><div class="ramp ${style==='gray'?'gray':selected==='slope'?'slope':''}"></div><div class="legend-values"><span>${selected==='slope'?'0°':'12 m'}</span><span>${selected==='slope'?'90°':'168 m'}</span></div><div class="dataset-actions" style="margin:16px 0">${btn('Zoom to extent','zoom')}${btn('Inspect values','inspection','',state==='missing')}${btn('Remove from Design','remove','danger')}</div><small>These controls change presentation only.</small>`}`;
  }
  function inspectionView() {
    const value = {value:'126.42',ready:'—','no-data':'NoData',loading:'Reading…',unavailable:'Unavailable',inactive:'—'}[state]||'—';
    return `<div class="stack"><h3>Ground elevation</h3><span class="muted">Native numeric value · metres</span>${inspect?note('Inspection mode is on','Click the canvas or sample its center. Pan and zoom still work. Drawing and selection are paused.'):note('Inspection mode is off','Canvas editing is available. Activate inspection to sample this layer.')}<div class="readout"><small>Sample value</small><br><strong>${value}</strong>${state==='value'?' <span>m</span>':''}</div>${state==='value'?facts([['Position','47.2184, −0.5546'],['Pixel','1284, 967'],['Generation','g-003'],['Resolution','0.5 m']]):`<p class="muted">${state==='no-data'?'There is no valid measurement at this pixel. It is not zero.':state==='unavailable'?'The library asset is unavailable. The reference remains saved.':'No interpolation from display colors.'}</p>`}${btn('Sample canvas center','sample','primary',!inspect)}${btn(inspect?'Exit inspection':'Start inspection',inspect?'exit-inspect':'start-inspect')}<small>Escape exits inspection and restores normal canvas gestures.</small></div>`;
  }
  function locationView() {
    return `<div class="stack"><h3>${edition==='web'?'Web Location':'Desktop Location'}</h3><p class="muted">Place the Design without changing local plant, zone or annotation coordinates.</p>${note(candidate?'Selected location':committed?'Confirmed location':'Provisional location',candidate?'Confirm to save this candidate.':committed?'This geographic anchor is saved in the Design.':'Local editing remains available. Camera movement does not confirm placement.')}<div>${field('Latitude','lat',candidate?.lat??committed?.lat??'47.2184','inputmode="decimal"')}${field('Longitude','lon',candidate?.lon??committed?.lon??'-0.5546','inputmode="decimal"')}${state==='invalid'?note('Enter valid coordinates','Latitude must be within ±85.05112878°; longitude within ±180°. Empty and non-finite values are invalid.',true):''}</div><div class="row wrap">${btn('Preview coordinates','preview')}${btn('Use map center','map-center','',state==='map-error')}</div><div class="row wrap">${btn(committed?'Move design here':'Confirm location','confirm','primary',!candidate)}${btn('Cancel','cancel-location','',!candidate)}</div>${btn('Undo placement','undo-location','',!oldLocation&&!committed)}${state==='map-error'?note('Map unavailable','Coordinate entry remains available. No placement was committed.',true):''}<small>Altitude metadata and north bearing are preserved. No automatic elevation lookup.</small><div class="rule"></div>${link('basemaps','Basemap settings')}${state==='session-changed'?note('Design changed','The old candidate was discarded. Late map events cannot place this Design.'):''}</div>`;
  }
  function basemapView() {
    const error = ['invalid-key','quota','offline','attribution-error','save-error'].includes(state);
    const errors={'invalid-key':['Google key rejected','Edit or remove the key. Official access will not silently fall back to keyless tiles.'],quota:['Google quota unavailable','Try again later or edit the key. Canvas editing is unaffected.'],offline:['Imagery unavailable','The provider could not be reached. Local rasters and coordinate entry still work.'],'attribution-error':['Attribution unavailable','Official imagery is omitted until its required viewport attribution can be loaded.'],'save-error':['Key could not be saved','The key remains unsaved in this session. Retry saving or cancel.']};
    return `<div class="field"><label>Provider</label>${choice('Street','OpenStreetMap','provider:street',provider==='street')}${choice('Google Satellite',hasKey?'Official Map Tiles API':'Keyless access','provider:google',provider==='google')}${choice('MapTiler Satellite',state==='maptiler-missing'?'Unavailable · build key missing':'Existing provider option','provider:maptiler',provider==='maptiler')}</div><label class="checkbox"><input id="basemap-visible" type="checkbox" checked> Show basemap</label><label class="field" style="margin-top:12px">Opacity <span class="row"><input type="range" min="0" max="100" value="100" id="base-opacity" aria-label="Basemap opacity"><output id="base-opacity-value">100%</output></span></label>${provider==='google'?`<div class="rule"></div>${!hasKey?note('Enter a Google Maps API key to load the official Google tiles.','Keyless imagery is selectable. Third-party authorization and service guarantees have not been established.'):note(state==='loading'?'Connecting to Google…':'Official Google access configured','Session and attribution are managed automatically. Billing may apply.')}<div style="margin-top:16px">${field('Google Maps API key','api-key',hasKey?'demo-key-not-a-real-credential':'','type="password" autocomplete="off" placeholder="Enter key"')}</div><div class="row wrap">${btn('Save key','save-key','primary')}${btn('Clear key','clear-key','',!hasKey)}</div><p class="muted" style="margin-top:8px">Stored on this device only. Never included in a Design or diagnostic export.</p><p style="margin-top:8px"><a href="https://developers.google.com/maps/documentation/tile/get-api-key" target="_blank" rel="noreferrer">Google key setup ↗</a></p>${error?`<div style="margin-top:12px">${note(...errors[state],true)}</div>`:''}<div class="rule"></div><h3>Map attribution</h3><p class="muted">Google Maps${hasKey?' · viewport data providers (simulated)':''}</p><small>Reference only: no imagery or provider requests are made.</small>`:provider==='maptiler'?note('MapTiler Satellite',state==='maptiler-missing'?'No build key is configured. Your saved provider choice is retained.':'Uses the existing device build configuration.',state==='maptiler-missing'):note('Street basemap','© OpenStreetMap contributors')}<div class="rule"></div><p class="muted">Switching providers preserves the camera, Design objects, raster layers and opacity.</p>`;
  }
  function indexView() {
    return `<main class="index"><div class="index-intro"><span class="mono accent">RASTER FOUNDATION / INTERACTION REFERENCE</span><h1>Data in the library.<br>Analysis on the ground.<br>Presentation in the Design.</h1><p class="muted">Seven linked HTML mockups for the raster rework. Review the whole flow or jump directly to a state. All maps, values, jobs and file selections are simulated; nothing is saved or sent.</p>${note('Awaiting your review','These references do not count as prototype approval. Their exact files and states are mapped in the implementation plan.')}</div><div class="reference-grid">${Object.entries(pages).map(([key,meta],i)=>`<article class="reference-card"><span class="number">0${i+1} / SLICE ${meta.slice}</span><h2>${link(key,meta.title)}</h2><p class="muted">${meta.description}</p><div class="state-links">${meta.states.map(s=>link(key,s,s)).join('')}</div></article>`).join('')}</div><div class="rule"></div><p class="muted">Review theme, narrow width and edition with the dark reference toolbar. Reload resets all interactions. Production work must rebuild the accepted design using Preact, shared components, CSS Modules and real workbenches.</p></main>`;
  }
  function render() {
    const scrollTop = document.querySelector('.dock-body')?.scrollTop || 0;
    const focused = document.activeElement;
    const focusId = focused?.id;
    const focusAction = focused?.dataset.action;
    document.documentElement.dataset.theme=theme;
    document.body.classList.toggle('narrow',narrow);
    document.title=`Canopi · ${pages[page]?.title||'Raster UI references'}`;
    let content=reviewBar();
    if(page==='index') { root.innerHTML=content+indexView(); return; }
    const webUnsupported=edition==='web'&&['data','import','analysis','inspection'].includes(page);
    const body=webUnsupported?note('Desktop-only workflow','Web preserves local dataset references but cannot import, process or inspect their local assets. Switch the reference edition to Desktop.'):page==='layers'&&edition==='web'?`${note('Local raster assets unavailable','Saved dataset references are preserved. Open this Design on Desktop to display or inspect their local numeric data.')}<div class="section-label">Preserved references</div>${layers.map(l=>`<div class="dataset"><h3>${escape(l.name)}</h3><small>${l.meta} · unavailable in Web</small></div>`).join('')}<div class="rule"></div>${btn('Basemap settings','basemaps')}`:({data:dataView,import:importView,analysis:analysisView,layers:layersView,inspection:inspectionView,location:locationView,basemaps:basemapView}[page])();
    const footer=page==='import'&&['ready','existing'].includes(state)&&!webUnsupported?`<div class="dock-foot"><div class="row spread">${btn('Cancel','data')}${btn('Import 12 files','start-import','primary',destination==='new'&&!interpretation)}</div><small>Atomic batch · no preview or second Apply</small></div>`:page==='analysis'&&state==='ready'&&!webUnsupported?`<div class="dock-foot">${btn('Run slope','run-slope','primary')}</div>`:'';
    content+=`<header class="titlebar"><span class="brand">canopi</span><span class="design-name">${escape(design)}</span><span class="muted">EN · ${edition==='web'?'Web Edition':'Desktop'}</span></header><main class="workspace"><aside class="toolbar" aria-label="Canvas tools (illustrative)"><span>↖</span><span>✥</span><span>○</span><span>▱</span><span>T</span><span>⌗</span></aside><section class="canvas ${page==='location'?'location':''}" aria-label="Synthetic canvas" tabindex="0" id="canvas">${terrain()}<span class="canvas-caption">${page==='location'?'GEOGRAPHIC PLACEMENT':'LA MAGNERIE / NORTH ORCHARD'}</span>${inspect?`<div class="canvas-hud"><strong>Inspect · Ground elevation</strong><p class="muted">Click to sample · Esc to return to editing</p></div>`:''}${page==='location'?`<div class="location-box"><h2>${edition==='web'?'Place your Design':'Find your location'}</h2>${edition==='desktop'?`${field('Search for an address','search-address','','placeholder="Address or place"')}${btn('Preview sample search result','search-place')}`:'<p class="muted">Click the illustrated map to preview a point, or enter coordinates in the Location panel.</p>'}</div><div class="location-status"><strong>${candidate?'Selected location':committed?'Confirmed location':'Provisional location'}</strong><p class="muted">${candidate?`${candidate.lat}, ${candidate.lon}`:committed?`${committed.lat}, ${committed.lon}`:'Local Design editing remains available.'}</p></div>`:''}<div class="canvas-footer"><span class="scale">20 m</span><span class="canvas-note">Illustrated reference · no live map</span></div></section><aside class="dock" aria-label="${pages[page].title} panel"><header class="dock-head"><span class="accent">${icons[page]}</span><h2>${pages[page].title}</h2>${btn('×','close','quiet')}</header><div class="dock-body">${notice?`<div style="margin-bottom:12px">${note('Reference action',escape(notice))}</div>`:''}${body}</div>${footer}</aside><nav class="rail" aria-label="Workspace navigation">${link('index','⌂')}${Object.keys(pages).filter(p=>p!=='import').map(p=>`<a href="${p}.html" data-nav="${p}" title="${pages[p].title}" aria-label="${pages[p].title}" ${page===p?'aria-current="page"':''}>${icons[p]}</a>`).join('')}<span class="rail-divider"></span><a href="../?surface=workspace" title="Existing production gallery" aria-label="Existing production gallery">↗</a></nav></main><footer class="review-foot"><output aria-live="polite">${escape(page)} / ${escape(state)} · ${inspect?'inspection active':'editing available'}${job?` · import ${job.status}`:''}</output><div class="row">${['progress','running','refreshing','loading'].includes(state)?btn('Advance simulated job','advance'):''}${btn('Switch Design','switch-design')}<span class="muted">Memory only · pending approval</span></div></footer>`;
    root.innerHTML=content;
    document.querySelector('.dock-body').scrollTop = scrollTop;
    if (focusId) document.getElementById(focusId)?.focus({preventScroll:true});
    else if (focusAction) Array.from(root.querySelectorAll('[data-action]')).find(e=>e.dataset.action===focusAction)?.focus({preventScroll:true});
  }
  root.addEventListener('click', event=>{
    const nav=event.target.closest('[data-nav]');
    if(nav) { event.preventDefault(); go(nav.dataset.nav,nav.dataset.state,page==='index'); return; }
    const target=event.target.closest('[data-action]');
    if(!target) { if(event.target.closest('#canvas')&&!event.target.closest('.location-box')) { if(inspect) { state='value';url();render(); } else if(page==='location'&&state!=='map-error') { candidate={lat:47.2191,lon:-.5528};state='selected';url();render(); } } return; }
    const [action,arg]=target.dataset.action.split(':');
    if(pages[action]) { go(action); return; }
    if(action==='theme') theme=theme==='light'?'dark':'light';
    else if(action==='width') narrow=!narrow;
    else if(action==='reset') { location.reload();return; }
    else if(action==='close') { document.querySelector('.dock').hidden=true;document.querySelector('.workspace').style.setProperty('--dock-width','0px');document.querySelector(`[data-nav="${page==='import'?'data':page}"]`)?.focus();return; }
    else if(['history','delete','rename'].includes(action)) state=action;
    else if(action==='reload') state='ready';
    else if(action==='attach') { attached=true;notice='Visible reference added to this Design.'; }
    else if(action==='existing') { destination='existing';go('import','existing');return; }
    else if(action==='dest') destination=arg;
    else if(action==='kind') interpretation=arg;
    else if(action==='start-import') { job={status:'progress',origin:design};state='progress'; }
    else if(action==='cancel-job') { if(page==='import'&&job)job.status='cancelled';if(page==='analysis'&&analysisJob)analysisJob.status='cancelled';state='cancelled'; }
    else if(action==='advance') { if(page==='import'){state=job&&job.origin!==design?'session-changed':'complete';if(job)job.status=state;imported=true;}else if(page==='analysis'){state='complete';if(analysisJob)analysisJob.status=state;}else if(page==='basemaps')state='official';else state='ready'; }
    else if(action==='retry') {state=page==='analysis'?'ready':'ready';notice='Review the preserved request, then submit a new job.';}
    else if(action==='units') units=arg;
    else if(action==='run-slope') { resultName=document.getElementById('result-name').value||'Terrain slope';analysisJob={status:'running',origin:design};state='running'; }
    else if(action==='save-name') { datasetName=document.getElementById('dataset-name').value.trim()||datasetName;state='ready';notice='Library name updated. Design content is unchanged.'; }
    else if(action==='delete-library') { state='empty';notice='Dataset and dependent analysis deleted in this mockup only.'; }
    else if(action==='undo-import') {state='ready';notice=`Import ${arg} undone. A new library generation is simulated.`;}
    else if(action==='eye') {const layer=layers.find(l=>l.id===arg);layer.visible=!layer.visible;if(!layer.visible&&selected===arg)inspect=false;}
    else if(action==='layer') selected=arg;
    else if(action==='up'||action==='down') {const i=layers.findIndex(l=>l.id===arg);const j=i+(action==='up'?-1:1);if(j>=0&&j<layers.length)[layers[i],layers[j]]=[layers[j],layers[i]];}
    else if(action==='style') style=arg;
    else if(action==='remove') {removed=true;state='removed';inspect=false;}
    else if(action==='undo-remove') {removed=false;state='ready';}
    else if(action==='zoom') notice='Camera fitted to dataset extent. Design geometry is unchanged.';
    else if(action==='sample') state='value';
    else if(action==='exit-inspect') {inspect=false;state='inactive';}
    else if(action==='start-inspect') {inspect=true;state='ready';}
    else if(action==='provider') {provider=arg;state=arg==='maptiler'?'maptiler-missing':hasKey?'official':'keyless';}
    else if(action==='save-key') {const value=document.getElementById('api-key').value.trim();if(!value){notice='Enter a demo key before saving.';}else{hasKey=true;state='official';notice='Demo credential accepted in memory only. No request was sent.';}}
    else if(action==='clear-key') {hasKey=false;state='keyless';}
    else if(action==='preview') {const rawLat=document.getElementById('lat').value.trim(),rawLon=document.getElementById('lon').value.trim();const lat=Number(rawLat),lon=Number(rawLon);if(!rawLat||!rawLon||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>85.05112878||Math.abs(lon)>180){state='invalid';candidate=null;}else{candidate={lat,lon};state='selected';}}
    else if(action==='map-center'||action==='search-place') {candidate={lat:47.2191,lon:-.5528};state='selected';}
    else if(action==='confirm') {oldLocation=committed;committed=candidate;candidate=null;state='confirmed';notice='One undoable placement edit. Local geometry, altitude and bearing preserved.';}
    else if(action==='cancel-location') {candidate=null;state=committed?'confirmed':'cancelled';}
    else if(action==='undo-location') {committed=oldLocation;candidate=null;oldLocation=null;state='undone';}
    else if(action==='switch-design') {design=design.startsWith('La')?'Riverside · new Design':'La Magnerie · orchard design';candidate=null;inspect=false;attached=false;if(page==='location'){committed=null;state='session-changed';}notice='Design changed. Background library jobs continue; late completions cannot attach here.';}
    url();render();
  });
  root.addEventListener('change',event=>{
    if(event.target.id==='scenario'){state=event.target.value;notice='';hydrateScenario();url();render();}
    else if(event.target.id==='edition'){edition=event.target.value;url();render();}
    else if(event.target.id==='replace'){replace=event.target.checked;render();}
    else if(event.target.id==='basemap-visible'){notice=event.target.checked?'Basemap shown.':'Basemap hidden. No new provider requests.';document.querySelector('.review-foot output').textContent=notice;}
  });
  root.addEventListener('input',event=>{
    if (['new-name','other-units','result-name','dataset-name','lat','lon'].includes(event.target.id)) drafts[event.target.id] = event.target.value;
    if(event.target.id==='opacity'){opacity=Number(event.target.value);document.getElementById('opacity-value').textContent=`${opacity}%`;document.querySelector('#raster')?.closest('svg').querySelector('path[fill="url(#raster)"]')?.setAttribute('opacity',String(opacity/240));}
    if(event.target.id==='base-opacity')document.getElementById('base-opacity-value').textContent=`${event.target.value}%`;
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){if(inspect){inspect=false;state=page==='inspection'?'inactive':state;}else if(page==='location'){candidate=null;state=committed?'confirmed':'cancelled';}else if(page==='import'&&['ready','existing'].includes(state)){go('data');return;}else return;url();render();}
  });
  hydrateScenario(); render();
})();
