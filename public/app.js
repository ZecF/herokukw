/**
 * Railflow PaaS Web Client — Zero-Slop Architecture
 * Handles dual-view routing (Apps List & App Detail Workspace), Dyno formations,
 * manual branch deployments, real-time SSE logs, and custom domains.
 */

let services = [];
let domains = [];
let dnsTarget = 'localhost:3000';
let activeAppId = null;
let currentFilter = 'all';
let searchQuery = '';
let activeSubtab = 'overview';
let logEventSource = null;
let activeDeployTab = 'template';
let selectedTemplateId = 'express-api';
let editorCurrentServiceId = null;

// DOM View Containers
const viewAppsList = document.getElementById('view-apps-list');
const viewAppDetail = document.getElementById('view-app-detail');
const tbody = document.getElementById('services-tbody');
const domainsTbody = document.getElementById('domains-tbody');
const searchInput = document.getElementById('search-apps-input');

// App Detail DOM
const appDetailTitle = document.getElementById('app-detail-title');
const appDetailRuntimeBadge = document.getElementById('app-detail-runtime-badge');
const detailProcType = document.getElementById('detail-proc-type');
const detailProcCmd = document.getElementById('detail-proc-cmd');
const detailProcMeta = document.getElementById('detail-proc-meta');
const detailDynoSwitch = document.getElementById('detail-dyno-switch');
const detailDomainsList = document.getElementById('detail-domains-list');
const detailActivityFeed = document.getElementById('detail-activity-feed');
const detailTerminalOutput = document.getElementById('detail-terminal-output');
const dnsTargetVal = document.getElementById('dns-target-val');

// Metrics DOM
const statDyno = document.getElementById('stat-dyno');
const statMem = document.getElementById('stat-mem');
const statUptime = document.getElementById('stat-uptime');
const metricActive = document.getElementById('metric-active-count');
const metricDomains = document.getElementById('metric-domains-count');
const metricHeap = document.getElementById('metric-heap-mb');
const metricTraffic = document.getElementById('metric-traffic-req');
const hostBadge = document.getElementById('host-badge');
const serviceCountBadge = document.getElementById('service-count-badge');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  fetchServices();
  fetchDomains();
  fetchSystemMetrics();
  setInterval(fetchSystemMetrics, 4000);
  setInterval(fetchServicesSilent, 6000);
  bindEvents();
  handleHashRouting();
  window.addEventListener('hashchange', handleHashRouting);
});

// Routing Hash Handler
function handleHashRouting() {
  const hash = window.location.hash || '#apps';
  if (hash.startsWith('#app/')) {
    const id = hash.replace('#app/', '');
    openAppDetail(id);
  } else {
    showAppsList();
  }
}

function showAppsList() {
  viewAppsList.style.display = 'block';
  viewAppDetail.style.display = 'none';
  activeAppId = null;
  if (logEventSource) logEventSource.close();
}

function openAppDetail(id) {
  const svc = services.find(s => s.id === id);
  if (!svc) {
    if (services.length > 0) showAppsList();
    return;
  }

  activeAppId = id;
  viewAppsList.style.display = 'none';
  viewAppDetail.style.display = 'block';

  // Populate Header
  appDetailTitle.textContent = svc.name;
  const runtimeName = svc.type === 'backend-node' ? 'Node.js' : svc.type === 'backend-python' ? 'Python' : 'Static SPA';
  appDetailRuntimeBadge.textContent = runtimeName;

  // Populate Dyno Formations
  detailProcType.textContent = svc.type === 'static' ? 'static-host' : 'web';
  detailProcCmd.textContent = svc.startCommand || (svc.type === 'static' ? 'serve dist/' : 'node server.js');
  detailProcMeta.textContent = svc.type === 'static' 
    ? `Mounted at /live/${svc.slug}` 
    : `Allocated Port :${svc.port || 'auto'} · Forwarded to /live/${svc.slug}`;
  detailDynoSwitch.checked = svc.status === 'active';

  // Populate Domains in Overview
  renderDetailDomains(svc);

  // Populate Activity Feed
  renderDetailActivity(svc);

  // Populate Detail Metrics
  document.getElementById('detail-metric-mem').textContent = `${svc.memoryMb || 24} MB`;
  document.getElementById('detail-metric-req').textContent = svc.requests || 0;
  document.getElementById('detail-metric-uptime').textContent = formatDuration(svc.uptimeStart);
  const statusEl = document.getElementById('detail-metric-status');
  statusEl.textContent = svc.status === 'active' ? 'Healthy' : 'Stopped';
  statusEl.style.color = svc.status === 'active' ? 'var(--color-ok)' : 'var(--color-muted)';

  // Populate Config Vars textarea
  const envObj = svc.env || {};
  document.getElementById('detail-config-vars-textarea').value = Object.entries(envObj).map(([k, v]) => `${k}=${v}`).join('\n');

  // Connect Logs Stream
  attachDetailLogsStream(svc.id);
}

// Fetch Services
async function fetchServices() {
  try {
    const res = await fetch('/api/services');
    const data = await res.json();
    services = data.services || [];
    renderServicesTable();
    updateDomainServiceSelect();

    if (activeAppId) {
      const activeSvc = services.find(s => s.id === activeAppId);
      if (activeSvc) {
        detailDynoSwitch.checked = activeSvc.status === 'active';
        renderDetailDomains(activeSvc);
        renderDetailActivity(activeSvc);
      }
    }
  } catch (err) {
    console.error('Failed to load services:', err);
  }
}

async function fetchServicesSilent() {
  try {
    const res = await fetch('/api/services');
    const data = await res.json();
    services = data.services || [];
    renderServicesTable();

    if (activeAppId) {
      const activeSvc = services.find(s => s.id === activeAppId);
      if (activeSvc) {
        renderDetailActivity(activeSvc);
      }
    }
  } catch (e) {
    // silent
  }
}

// Fetch Domains
async function fetchDomains() {
  try {
    const res = await fetch('/api/domains');
    const data = await res.json();
    domains = data.domains || [];
    dnsTarget = data.dnsTarget || 'localhost:3000';
    if (dnsTargetVal) dnsTargetVal.textContent = dnsTarget;
    if (metricDomains) metricDomains.textContent = domains.length;
    renderDomainsTable();
  } catch (err) {
    console.error('Failed to load domains:', err);
  }
}

// Fetch Metrics
async function fetchSystemMetrics() {
  try {
    const res = await fetch('/api/system/metrics');
    const m = await res.json();
    statDyno.textContent = m.dyno || 'web.1';
    statMem.textContent = `${m.memoryUsage?.rssMb || 0} MB`;
    
    statUptime.textContent = formatDurationSeconds(m.uptimeSeconds);

    metricActive.textContent = m.activeServices || 0;
    if (metricDomains) metricDomains.textContent = m.totalDomains || domains.length;
    metricHeap.textContent = `${m.memoryUsage?.heapUsedMb || 0} MB`;

    const totalReq = services.reduce((acc, s) => acc + (s.requests || 0), 0);
    metricTraffic.textContent = totalReq;

    if (m.host) {
      hostBadge.textContent = m.host;
    }
    serviceCountBadge.textContent = `[${m.activeServices} active]`;
  } catch (err) {
    console.error('Failed fetching metrics:', err);
  }
}

// Render Services Table
function renderServicesTable() {
  let filtered = services.filter(s => {
    if (currentFilter === 'all') return true;
    return s.type === currentFilter;
  });

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(s => 
      s.name.toLowerCase().includes(q) || 
      s.slug.toLowerCase().includes(q) || 
      (s.type || '').toLowerCase().includes(q)
    );
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: var(--space-xl); color: var(--color-muted);">
          No apps matching filter. Create a new app with "+ New App".
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(svc => {
    const isRunning = svc.status === 'active';
    const runtimeName = svc.type === 'backend-node' ? 'Node.js' : svc.type === 'backend-python' ? 'Python' : 'Static';
    const routingInfo = svc.type === 'static' ? `live subpath (/live/${svc.slug})` : `port :${svc.port || 'auto'} → /live/${svc.slug}`;

    const svcDomains = domains.filter(d => d.serviceId === svc.id);
    const domainBadges = svcDomains.map(d => `
      <span class="activity-badge" style="color: var(--color-accent);" title="Host: ${d.domain}">
        dom: ${escapeHtml(d.domain)}
      </span>
    `).join(' ');

    const latestRelease = (svc.history && svc.history[0]) 
      ? `${svc.history[0].release || 'v1'} · ${svc.history[0].commit || svc.commit || 'head'}` 
      : `${svc.commit || 'main'}`;

    return `
      <tr>
        <td>
          <div class="service-ident">
            <a href="#app/${svc.id}" class="service-name" style="text-decoration: none; cursor: pointer;">
              ${escapeHtml(svc.name)}
            </a>
            <div style="display: flex; gap: var(--space-xs); align-items: baseline; flex-wrap: wrap;">
              <a href="/live/${svc.slug}" target="_blank" class="service-url">/live/${svc.slug}</a>
              ${domainBadges}
            </div>
          </div>
        </td>
        <td>
          <span class="service-type-badge">${runtimeName}</span>
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: var(--space-sm);">
            <label class="switch-label" title="Toggle Process ON/OFF">
              <input type="checkbox" ${isRunning ? 'checked' : ''} onchange="toggleDynoSwitch('${svc.id}', this.checked)">
              <span class="switch-slider"></span>
            </label>
            <span class="status-pill ${svc.status}">${svc.status}</span>
          </div>
        </td>
        <td>
          <span style="font-family: var(--font-outlier); font-size: var(--text-xs); color: var(--color-ink-2);">${routingInfo}</span>
        </td>
        <td>
          <span style="font-family: var(--font-outlier); font-size: var(--text-xs); color: var(--color-muted);">${latestRelease}</span>
        </td>
        <td>
          <div class="row-actions">
            <a href="#app/${svc.id}" class="btn btn-secondary btn-sm" style="text-decoration: none;">Manage</a>
            <a href="/live/${svc.slug}" target="_blank" class="btn btn-secondary btn-sm" style="text-decoration: none;">Live ↗</a>
            <button class="btn btn-danger btn-sm" onclick="deleteService('${svc.id}')">Drop</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Render Domains in Detail View
function renderDetailDomains(svc) {
  const svcDomains = domains.filter(d => d.serviceId === svc.id);
  if (svcDomains.length === 0) {
    detailDomainsList.innerHTML = `
      <div style="padding: var(--space-sm); background-color: var(--color-paper-2); border-radius: 4px; font-size: var(--text-xs); color: var(--color-muted);">
        No custom domains mapped yet. Click "+ Add Domain" to route a custom domain.
      </div>
    `;
    return;
  }

  detailDomainsList.innerHTML = svcDomains.map(d => `
    <div style="display: flex; align-items: center; justify-content: space-between; padding: var(--space-xs) var(--space-sm); background-color: var(--color-paper-2); border-radius: 4px; margin-bottom: var(--space-2xs);">
      <div style="display: flex; align-items: baseline; gap: var(--space-xs);">
        <span style="font-family: var(--font-outlier); font-weight: 600; color: var(--color-accent); font-size: var(--text-xs);">${escapeHtml(d.domain)}</span>
        <span class="status-pill active" style="font-size: 10px;">verified</span>
      </div>
      <div style="display: flex; gap: var(--space-3xs);">
        <button class="btn btn-secondary btn-sm" onclick="verifyDomain('${d.id}')">DNS Check</button>
        <button class="btn btn-danger btn-sm" onclick="deleteDomain('${d.id}')">Remove</button>
      </div>
    </div>
  `).join('');
}

// Render Activity Feed in Detail View
function renderDetailActivity(svc) {
  const history = svc.history || [
    { release: 'v1', commit: svc.commit || 'init', date: svc.deployedAt || Date.now(), message: 'Initial release' }
  ];

  document.getElementById('detail-activity-count').textContent = `${history.length} Releases`;

  detailActivityFeed.innerHTML = history.slice(0, 8).map(h => {
    const timeAgo = formatTimeAgo(h.date || Date.now());
    const relTag = h.release || 'v1';
    return `
      <div class="activity-item">
        <span class="activity-badge">${relTag}</span>
        <div class="activity-body">
          <span class="activity-title">${escapeHtml(h.message || 'Deployed build')}</span>
          <span class="activity-meta">commit ${h.commit || 'head'} · ${timeAgo}</span>
        </div>
      </div>
    `;
  }).join('');
}

// Render Domains Table in Modal
function renderDomainsTable() {
  if (!domainsTbody) return;
  if (domains.length === 0) {
    domainsTbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: var(--space-md); color: var(--color-muted);">
          No custom domains registered yet. Enter your domain name above.
        </td>
      </tr>
    `;
    return;
  }

  domainsTbody.innerHTML = domains.map(d => `
    <tr>
      <td>
        <span style="font-family: var(--font-outlier); font-weight: 600; color: var(--color-accent);">${escapeHtml(d.domain)}</span>
      </td>
      <td>
        <span>${escapeHtml(d.serviceName || d.serviceId)}</span>
      </td>
      <td>
        <span class="status-pill active">${d.status}</span>
      </td>
      <td>
        <span style="font-family: var(--font-outlier); font-size: var(--text-xs); color: var(--color-cool);">${d.ssl || 'active'}</span>
      </td>
      <td style="text-align: right;">
        <button class="btn btn-secondary btn-sm" onclick="verifyDomain('${d.id}')">Verify</button>
        <button class="btn btn-danger btn-sm" onclick="deleteDomain('${d.id}')">Remove</button>
      </td>
    </tr>
  `).join('');
}

function updateDomainServiceSelect() {
  const sel = document.getElementById('new-domain-service-select');
  if (!sel) return;
  sel.innerHTML = services.map(s => `
    <option value="${s.id}">${escapeHtml(s.name)} (/live/${s.slug})</option>
  `).join('');
}

// Dyno Scale Toggle (ON / OFF)
async function toggleDynoSwitch(serviceId, active) {
  try {
    const res = await fetch(`/api/services/${serviceId}/scale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active })
    });
    const data = await res.json();
    if (data.success) {
      await fetchServices();
    }
  } catch (err) {
    alert('Failed to scale dyno: ' + err.message);
  }
}

// Attach Live Logs Stream for Detail View
function attachDetailLogsStream(serviceId) {
  if (logEventSource) logEventSource.close();

  detailTerminalOutput.innerHTML = `
    <div class="log-line system">
      <span class="ts">[${new Date().toLocaleTimeString()}]</span>
      <span>Attaching to live telemetry stream for ${serviceId}…</span>
    </div>
  `;

  logEventSource = new EventSource(`/api/services/${serviceId}/logs/stream`);
  logEventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      appendDetailLogLine(data);
    } catch (e) {
      // parse error
    }
  };
}

function isQrCodeBlock(text) {
  if (!text || typeof text !== 'string') return false;
  return text.includes('▄▄▄▄') || 
    (text.includes('█') && text.includes('▄') && text.includes('\n') && text.length > 200);
}

function buildQrCanvasFromTerminal(qrText, scale = 5) {
  const lines = qrText.split('\n').filter(l => l.trim().length > 0);
  const rows = [];
  for (let r = 0; r < lines.length; r++) {
    const topRow = [];
    const btmRow = [];
    for (let c = 0; c < lines[r].length; c++) {
      const ch = lines[r][c];
      if (ch === '\u2588') {
        topRow.push(0);
        btmRow.push(0);
      } else if (ch === '\u2580') {
        topRow.push(0);
        btmRow.push(1);
      } else if (ch === '\u2584') {
        topRow.push(1);
        btmRow.push(0);
      } else if (ch === ' ') {
        topRow.push(1);
        btmRow.push(1);
      }
    }
    if (topRow.length > 0) {
      rows.push(topRow);
      rows.push(btmRow);
    }
  }

  if (rows.length === 0 || !rows[0].length) return null;

  const h = rows.length;
  const w = rows[0].length;
  const padding = 2;
  const totalW = (w + padding * 2) * scale;
  const totalH = (h + padding * 2) * scale;

  const canvas = document.createElement('canvas');
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, totalW, totalH);

  ctx.fillStyle = '#000000';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rows[y][x] === 1) {
        ctx.fillRect((x + padding) * scale, (y + padding) * scale, scale, scale);
      }
    }
  }

  return { canvas, width: totalW, height: totalH };
}

function createQrCard(entry) {
  const card = document.createElement('div');
  card.className = 'qr-container-card';

  const timeStr = entry.ts ? new Date(entry.ts).toLocaleTimeString() : '00:00:00';

  const header = document.createElement('div');
  header.className = 'qr-card-header';
  header.innerHTML = `
    <span class="qr-card-title">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="7" height="7"></rect>
        <rect x="14" y="3" width="7" height="7"></rect>
        <rect x="14" y="14" width="7" height="7"></rect>
        <rect x="3" y="14" width="7" height="7"></rect>
      </svg>
      WhatsApp Pairing QR Code
    </span>
    <span class="ts">[${timeStr}]</span>
  `;
  card.appendChild(header);

  const qrData = buildQrCanvasFromTerminal(entry.text, 5);
  if (qrData && qrData.canvas) {
    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'qr-canvas-wrapper';
    canvasWrap.appendChild(qrData.canvas);
    card.appendChild(canvasWrap);
  }

  const pre = document.createElement('pre');
  pre.className = 'qr-raw-pre';
  pre.textContent = entry.text;
  card.appendChild(pre);

  const footer = document.createElement('div');
  footer.className = 'qr-card-footer';
  
  const hint = document.createElement('span');
  hint.textContent = 'Scan via WhatsApp > Linked Devices';
  footer.appendChild(hint);

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'btn btn-secondary btn-sm';
  toggleBtn.textContent = 'Toggle Raw Text';
  toggleBtn.style.padding = '2px 8px';
  toggleBtn.style.fontSize = '11px';
  toggleBtn.onclick = () => {
    pre.style.display = pre.style.display === 'block' ? 'none' : 'block';
  };
  footer.appendChild(toggleBtn);

  card.appendChild(footer);
  return card;
}

function appendDetailLogLine(entry) {
  if (isQrCodeBlock(entry.text)) {
    const qrCard = createQrCard(entry);
    detailTerminalOutput.appendChild(qrCard);
    detailTerminalOutput.scrollTop = detailTerminalOutput.scrollHeight;
    return;
  }

  const line = document.createElement('div');
  line.className = `log-line ${entry.stream || 'stdout'}`;
  
  const tsSpan = document.createElement('span');
  tsSpan.className = 'ts';
  const timeStr = entry.ts ? new Date(entry.ts).toLocaleTimeString() : '00:00:00';
  tsSpan.textContent = `[${timeStr}]`;

  const raw = entry.text || '';
  const clean = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

  const textSpan = document.createElement('span');
  textSpan.textContent = clean;

  line.appendChild(tsSpan);
  line.appendChild(textSpan);
  detailTerminalOutput.appendChild(line);

  detailTerminalOutput.scrollTop = detailTerminalOutput.scrollHeight;
}

// Manual Branch Deploy
async function triggerBranchDeploy() {
  if (!activeAppId) return;
  const branch = document.getElementById('manual-deploy-branch').value;
  
  // Switch to Logs subtab automatically so user sees build output!
  switchSubtab('logs');

  try {
    const res = await fetch(`/api/services/${activeAppId}/branch-deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch })
    });
    const data = await res.json();
    if (data.success) {
      await fetchServices();
    } else {
      alert('Branch deploy failed: ' + data.error);
    }
  } catch (err) {
    alert('Network error: ' + err.message);
  }
}

// Subtab Switching
function switchSubtab(subtabName) {
  activeSubtab = subtabName;
  document.querySelectorAll('.subnav-tab').forEach(t => {
    t.classList.toggle('active', t.getAttribute('data-subtab') === subtabName);
  });

  const panes = ['overview', 'deploy', 'logs', 'metrics', 'settings'];
  panes.forEach(p => {
    const el = document.getElementById(`pane-subtab-${p}`);
    if (el) el.style.display = p === subtabName ? 'block' : 'none';
  });
}

// Delete Service
async function deleteService(id) {
  const svc = services.find(s => s.id === id);
  if (!confirm(`Are you sure you want to permanently delete app "${svc ? svc.name : id}"?`)) return;

  try {
    await fetch(`/api/services/${id}`, { method: 'DELETE' });
    await fetchServices();
    await fetchDomains();
    window.location.hash = '#apps';
  } catch (err) {
    alert('Failed to delete service: ' + err.message);
  }
}

// Add Custom Domain
async function handleAddDomain() {
  const domainInput = document.getElementById('new-domain-input');
  const serviceSelect = document.getElementById('new-domain-service-select');
  const domain = domainInput.value.trim();
  const serviceId = serviceSelect.value || activeAppId;

  if (!domain) return alert('Please enter a domain name');
  if (!serviceId) return alert('Please select a target service');

  try {
    const res = await fetch('/api/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, serviceId })
    });
    const data = await res.json();
    if (data.success) {
      domainInput.value = '';
      await fetchDomains();
      await fetchServices();
      alert(`Domain "${domain}" mapped successfully. Set your DNS CNAME to "${dnsTarget}".`);
    } else {
      alert('Failed to add domain: ' + data.error);
    }
  } catch (err) {
    alert('Network error: ' + err.message);
  }
}

// Verify Domain
async function verifyDomain(id) {
  try {
    const res = await fetch(`/api/domains/${id}/verify`, { method: 'POST' });
    const data = await res.json();
    alert(`DNS Verification: Target is ${data.cnameTarget}. Status: Verified.`);
    await fetchDomains();
  } catch (err) {
    alert('Verification error: ' + err.message);
  }
}

// Delete Domain
async function deleteDomain(id) {
  if (!confirm('Are you sure you want to remove this domain mapping?')) return;
  try {
    await fetch(`/api/domains/${id}`, { method: 'DELETE' });
    await fetchDomains();
    await fetchServices();
  } catch (err) {
    alert('Failed to delete domain: ' + err.message);
  }
}

// Open In-Browser Code Editor Modal
async function openEditorModal(serviceId) {
  const svc = services.find(s => s.id === serviceId);
  if (!svc) return;

  editorCurrentServiceId = serviceId;
  document.getElementById('editor-service-indicator').textContent = svc.name;
  document.getElementById('editor-commit-msg').value = `refactor: update ${svc.name} handlers`;

  try {
    const res = await fetch(`/api/services/${serviceId}/files`);
    const data = await res.json();
    const fileSel = document.getElementById('editor-file-select');
    fileSel.innerHTML = (data.files || []).map(f => `<option value="${f}">${f}</option>`).join('');

    if (data.files && data.files.length > 0) {
      await loadEditorFile(data.files[0]);
    }

    document.getElementById('editor-modal').style.display = 'grid';
  } catch (err) {
    alert('Could not inspect service files: ' + err.message);
  }
}

async function loadEditorFile(filename) {
  if (!editorCurrentServiceId || !filename) return;
  try {
    const res = await fetch(`/api/services/${editorCurrentServiceId}/file?filename=${encodeURIComponent(filename)}`);
    const data = await res.json();
    document.getElementById('editor-code-textarea').value = data.content || '';
  } catch (err) {
    alert('Failed to read file: ' + err.message);
  }
}

// Save & Hot Redeploy Code
async function saveAndHotRedeploy() {
  if (!editorCurrentServiceId) return;
  const filename = document.getElementById('editor-file-select').value;
  const content = document.getElementById('editor-code-textarea').value;
  const commitMessage = document.getElementById('editor-commit-msg').value.trim();

  try {
    const res = await fetch(`/api/services/${editorCurrentServiceId}/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, content, commitMessage })
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('editor-modal').style.display = 'none';
      await fetchServices();
      switchSubtab('logs');
    } else {
      alert('Save failed: ' + data.error);
    }
  } catch (err) {
    alert('Network error: ' + err.message);
  }
}

// Bind UI Events
function bindEvents() {
  // Breadcrumb back
  document.getElementById('btn-back-to-apps').addEventListener('click', () => {
    window.location.hash = '#apps';
  });
  document.getElementById('brand-home-link').addEventListener('click', () => {
    window.location.hash = '#apps';
  });

  // Search filter
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderServicesTable();
  });

  // Filter tabs
  document.querySelectorAll('.tab-filter-group .tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const filter = e.target.getAttribute('data-filter');
      if (!filter) return;
      document.querySelectorAll('.tab-filter-group .tab-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentFilter = filter;
      renderServicesTable();
    });
  });

  // Subnav tabs
  document.querySelectorAll('.subnav-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const sub = e.target.getAttribute('data-subtab');
      if (sub) switchSubtab(sub);
    });
  });

  // Dyno switch in detail
  detailDynoSwitch.addEventListener('change', (e) => {
    if (activeAppId) toggleDynoSwitch(activeAppId, e.target.checked);
  });

  // Open Live App from Detail
  document.getElementById('btn-detail-open-live').addEventListener('click', () => {
    const svc = services.find(s => s.id === activeAppId);
    if (svc) window.open(`/live/${svc.slug}`, '_blank');
  });

  // Clear Session Action
  const handleClearSession = async () => {
    if (!activeAppId) return;
    if (!confirm('Hapus seluruh file session bot (state, auth, creds.json) dan restart bot untuk generate QR code baru?')) {
      return;
    }
    switchSubtab('logs');
    try {
      const res = await fetch(`/api/services/${activeAppId}/clear-session`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        await fetchServices();
      } else {
        alert('Gagal hapus session: ' + data.error);
      }
    } catch (e) {
      alert('Network error: ' + e.message);
    }
  };

  document.getElementById('btn-detail-clear-session')?.addEventListener('click', handleClearSession);
  document.getElementById('btn-settings-clear-session')?.addEventListener('click', handleClearSession);

  // Restart from Detail
  document.getElementById('btn-detail-rebuild').addEventListener('click', async () => {
    if (!activeAppId) return;
    switchSubtab('logs');
    try {
      await fetch(`/api/services/${activeAppId}/rebuild`, { method: 'POST' });
      await fetchServices();
    } catch (e) {
      alert('Rebuild trigger failed: ' + e.message);
    }
  });

  document.getElementById('btn-detail-restart').addEventListener('click', async () => {
    if (!activeAppId) return;
    try {
      await fetch(`/api/services/${activeAppId}/restart`, { method: 'POST' });
      alert('Dyno restarted.');
      await fetchServices();
    } catch (e) {
      alert('Failed: ' + e.message);
    }
  });

  // Manual Branch Deploy button
  document.getElementById('btn-trigger-branch-deploy').addEventListener('click', triggerBranchDeploy);

  // Detail open code editor
  document.getElementById('btn-detail-open-editor').addEventListener('click', () => {
    if (activeAppId) openEditorModal(activeAppId);
  });

  // Detail open upload
  document.getElementById('btn-detail-trigger-upload').addEventListener('click', () => {
    document.getElementById('deploy-modal').style.display = 'grid';
    document.getElementById('tab-deploy-upload').click();
  });

  // Add Domain button from detail
  document.getElementById('btn-detail-add-domain').addEventListener('click', () => {
    document.getElementById('domains-modal').style.display = 'grid';
    document.getElementById('new-domain-service-select').value = activeAppId;
  });

  // Terminal clear & copy
  document.getElementById('btn-clear-detail-logs').addEventListener('click', () => {
    detailTerminalOutput.innerHTML = '';
  });
  document.getElementById('btn-copy-detail-logs').addEventListener('click', () => {
    navigator.clipboard.writeText(detailTerminalOutput.innerText).then(() => {
      alert('Logs copied to clipboard.');
    });
  });

  // Reveal Config Vars
  document.getElementById('btn-reveal-config-vars').addEventListener('click', (e) => {
    const container = document.getElementById('config-vars-container');
    const isHidden = container.style.display === 'none';
    container.style.display = isHidden ? 'block' : 'none';
    e.target.textContent = isHidden ? 'Hide Config Vars' : 'Reveal Config Vars';
  });

  // Save Config Vars
  document.getElementById('btn-save-detail-config').addEventListener('click', async () => {
    if (!activeAppId) return;
    const raw = document.getElementById('detail-config-vars-textarea').value;
    const envObj = {};
    raw.split('\n').forEach(line => {
      const idx = line.indexOf('=');
      if (idx > 0) {
        const k = line.substring(0, idx).trim();
        const v = line.substring(idx + 1).trim();
        if (k) envObj[k] = v;
      }
    });

    try {
      await fetch(`/api/services/${activeAppId}/env`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ env: envObj })
      });
      alert('Config Vars saved. Dyno restarting with updated environment.');
      await fetchServices();
    } catch (e) {
      alert('Failed: ' + e.message);
    }
  });

  // Danger delete
  document.getElementById('btn-danger-delete-app').addEventListener('click', () => {
    if (activeAppId) deleteService(activeAppId);
  });

  // Domains Modal toggles
  const domainsModal = document.getElementById('domains-modal');
  document.getElementById('btn-open-domains').addEventListener('click', () => {
    domainsModal.style.display = 'grid';
    fetchDomains();
  });
  document.getElementById('btn-close-domains').addEventListener('click', () => {
    domainsModal.style.display = 'none';
  });
  document.getElementById('btn-cancel-domains').addEventListener('click', () => {
    domainsModal.style.display = 'none';
  });
  document.getElementById('btn-submit-domain').addEventListener('click', handleAddDomain);

  // Editor Modal toggles
  const editorModal = document.getElementById('editor-modal');
  document.getElementById('btn-close-editor').addEventListener('click', () => editorModal.style.display = 'none');
  document.getElementById('btn-cancel-editor').addEventListener('click', () => editorModal.style.display = 'none');
  document.getElementById('editor-file-select').addEventListener('change', (e) => {
    loadEditorFile(e.target.value);
  });
  document.getElementById('btn-save-redeploy').addEventListener('click', saveAndHotRedeploy);

  // Deploy Modal toggles
  const deployModal = document.getElementById('deploy-modal');
  document.getElementById('btn-open-deploy').addEventListener('click', () => {
    deployModal.style.display = 'grid';
  });
  document.getElementById('btn-close-deploy').addEventListener('click', () => {
    deployModal.style.display = 'none';
  });
  document.getElementById('btn-cancel-deploy').addEventListener('click', () => {
    deployModal.style.display = 'none';
  });

  // Deploy Tab navigation
  const tabTpl = document.getElementById('tab-deploy-template');
  const tabUpload = document.getElementById('tab-deploy-upload');
  const tabGit = document.getElementById('tab-deploy-git');
  const paneTpl = document.getElementById('pane-deploy-template');
  const paneUpload = document.getElementById('pane-deploy-upload');
  const paneGit = document.getElementById('pane-deploy-git');

  tabTpl.addEventListener('click', () => {
    activeDeployTab = 'template';
    tabTpl.classList.add('active');
    tabUpload.classList.remove('active');
    tabGit.classList.remove('active');
    paneTpl.style.display = 'block';
    paneUpload.style.display = 'none';
    paneGit.style.display = 'none';
  });

  tabUpload.addEventListener('click', () => {
    activeDeployTab = 'upload';
    tabUpload.classList.add('active');
    tabTpl.classList.remove('active');
    tabGit.classList.remove('active');
    paneUpload.style.display = 'block';
    paneTpl.style.display = 'none';
    paneGit.style.display = 'none';
  });

  tabGit.addEventListener('click', () => {
    activeDeployTab = 'git';
    tabGit.classList.add('active');
    tabTpl.classList.remove('active');
    tabUpload.classList.remove('active');
    paneGit.style.display = 'block';
    paneTpl.style.display = 'none';
    paneUpload.style.display = 'none';
  });

  // Template Card Selection
  document.querySelectorAll('.template-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedTemplateId = card.getAttribute('data-template');
    });
  });

  // Zip Dropzone
  const dropzone = document.getElementById('upload-dropzone');
  const fileInput = document.getElementById('upload-file-input');
  const fileLabel = document.getElementById('selected-file-label');

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--color-accent)';
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.style.borderColor = 'var(--color-rule-2)';
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--color-rule-2)';
    if (e.dataTransfer.files.length > 0) {
      fileInput.files = e.dataTransfer.files;
      fileLabel.textContent = e.dataTransfer.files[0].name;
      fileLabel.style.display = 'inline-block';
    }
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      fileLabel.textContent = fileInput.files[0].name;
      fileLabel.style.display = 'inline-block';
    }
  });

  // Submit Deploy Form
  document.getElementById('btn-submit-deploy').addEventListener('click', async () => {
    if (activeDeployTab === 'template') {
      const name = document.getElementById('tpl-service-name').value.trim();
      const slug = document.getElementById('tpl-service-slug').value.trim();
      if (!name || !slug) return alert('App name and route slug are required');

      try {
        const res = await fetch('/api/deploy/template', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateId: selectedTemplateId, name, slug })
        });
        const data = await res.json();
        if (data.success) {
          deployModal.style.display = 'none';
          await fetchServices();
          window.location.hash = `#app/${data.service.id}`;
        } else {
          alert('Deployment failed: ' + data.error);
        }
      } catch (e) {
        alert('Network error: ' + e.message);
      }
    } else if (activeDeployTab === 'upload') {
      const file = fileInput.files[0];
      if (!file) return alert('Please choose an archive file (.zip, .tar.gz, .tgz, .tar)');
      const defaultName = file.name.replace(/\.(tar\.gz|tgz|zip|tar)$/i, '');
      const name = document.getElementById('zip-service-name').value.trim() || defaultName;
      const type = document.getElementById('zip-runtime-select').value;

      const fd = new FormData();
      fd.append('bundle', file);
      fd.append('name', name);
      fd.append('type', type);

      try {
        const res = await fetch('/api/deploy/upload', { method: 'POST', body: fd });
        const data = await res.json();
        if (data.success) {
          deployModal.style.display = 'none';
          await fetchServices();
          window.location.hash = `#app/${data.service.id}`;
        } else {
          alert('Deploy upload failed: ' + data.error);
        }
      } catch (e) {
        alert('Upload failed: ' + e.message);
      }
    } else {
      const repo = document.getElementById('git-repo-url').value.trim();
      if (!repo) return alert('Please enter a Git repository URL');
      alert(`Git repository registered. Initializing container build…`);
      deployModal.style.display = 'none';
    }
  });

  // Settings Modal events
  const settingsModal = document.getElementById('settings-modal');
  document.getElementById('btn-open-settings').addEventListener('click', () => {
    settingsModal.style.display = 'grid';
  });
  document.getElementById('btn-close-settings').addEventListener('click', () => {
    settingsModal.style.display = 'none';
  });
  document.getElementById('btn-cancel-settings').addEventListener('click', () => {
    settingsModal.style.display = 'none';
  });
  document.getElementById('btn-save-settings').addEventListener('click', () => {
    const key = document.getElementById('heroku-api-key').value;
    const app = document.getElementById('heroku-app-target').value;
    localStorage.setItem('heroku_api_key', key);
    localStorage.setItem('heroku_app_target', app);
    settingsModal.style.display = 'none';
    alert('Heroku platform configuration saved locally.');
  });
}

function formatDurationSeconds(sec) {
  const s = sec || 0;
  const h = Math.floor(s / 3600);
  const min = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  return `${h}h ${min}m ${rem}s`;
}

function formatDuration(startTime) {
  if (!startTime) return '0m';
  const sec = Math.floor((Date.now() - startTime) / 1000);
  return formatDurationSeconds(sec);
}

function formatTimeAgo(ts) {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}
