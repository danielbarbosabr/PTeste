// ===================== ESTADO GLOBAL =====================
let allData = [];           // todos os registros carregados
let loadedFiles = [];
let charts = {};

// ===================== DOM Elements =====================
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const selectFileBtn = document.getElementById('selectFileBtn');
const filesListDiv = document.getElementById('filesList');
const filesContainer = document.getElementById('filesContainer');
const exportXLSXBtn = document.getElementById('exportXLSXBtn');
const exportJSONBtn = document.getElementById('exportJSONBtn');
const clearDataBtn = document.getElementById('btnClearData');
const emptyState = document.getElementById('emptyState');
const overviewContent = document.getElementById('overviewContent');
const kpiGrid = document.getElementById('kpiGrid');
const filterRegiao = document.getElementById('filterRegiao');
const filterUF = document.getElementById('filterUF');
const filterPrazo = document.getElementById('filterPrazo');
const searchCodigo = document.getElementById('searchCodigo');

// ===================== FUNÇÕES DE NOTIFICAÇÃO =====================
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ===================== LEITURA DE PLANILHAS (HEADER DINÂMICO) =====================
async function processFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'zip') return await processZip(file);
    if (['xlsx', 'xls'].includes(ext)) return await processExcelFile(file);
    if (ext === 'json') return await processJsonFile(file);
    return [];
}

async function processZip(file) {
    const zip = new JSZip();
    const zipContent = await zip.loadAsync(file);
    let allRecords = [];
    for (const [name, zipEntry] of Object.entries(zipContent.files)) {
        if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
            const data = await zipEntry.async('arraybuffer');
            const records = await parseExcelArrayBuffer(data, name);
            allRecords.push(...records);
        }
    }
    return allRecords;
}

async function processExcelFile(file) {
    const buffer = await file.arrayBuffer();
    return await parseExcelArrayBuffer(buffer, file.name);
}

async function parseExcelArrayBuffer(buffer, fileName) {
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!rows || rows.length < 2) return [];

    // Encontra a linha de cabeçalho (procura por palavras-chave nas primeiras 5 linhas)
    let headerRowIndex = 0;
    const keywords = ['codigo', 'destino', 'uf', 'região', 'prazo', 'status', 'dt entrega', 'previsao'];
    for (let i = 0; i < Math.min(5, rows.length); i++) {
        const row = rows[i];
        if (row && row.some(cell => cell && keywords.some(k => cell.toString().toLowerCase().includes(k)))) {
            headerRowIndex = i;
            break;
        }
    }

    const headers = rows[headerRowIndex].map(cell => cell ? String(cell).trim() : '');
    const dataRows = rows.slice(headerRowIndex + 1).filter(row => row.some(cell => cell && cell.toString().trim() !== ''));

    const records = [];
    for (const row of dataRows) {
        const obj = {};
        headers.forEach((h, idx) => {
            const key = h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            let val = row[idx] !== undefined ? String(row[idx]).trim() : '';
            if (key.includes('codigo')) obj.codigo = val;
            else if (key.includes('destino')) obj.destino = val;
            else if (key === 'uf') obj.uf = val;
            else if (key.includes('regiao')) obj.regiao = val;
            else if (key === 'prazo') obj.prazoRaw = val;
            else if (key.includes('status')) obj.status = val;
            else if (key.includes('dt entrega')) obj.dtEntrega = val;
            else if (key.includes('previsao')) obj.previsao = val;
        });

        const record = {
            codigo: obj.codigo || '',
            destino: obj.destino || '',
            uf: obj.uf || '',
            regiao: obj.regiao || '',
            status: obj.status || '',
            prazo: '',
            arquivo: fileName
        };

        // Determina prazo
        if (obj.prazoRaw) {
            const p = obj.prazoRaw.toLowerCase();
            if (p.includes('fora')) record.prazo = 'Fora do Prazo';
            else if (p.includes('dentro')) record.prazo = 'Dentro do Prazo';
        }
        if (!record.prazo && obj.dtEntrega && obj.previsao) {
            try {
                const entrega = new Date(obj.dtEntrega);
                const previsao = new Date(obj.previsao);
                if (!isNaN(entrega) && !isNaN(previsao))
                    record.prazo = entrega <= previsao ? 'Dentro do Prazo' : 'Fora do Prazo';
            } catch(e) {}
        }
        if (!record.prazo && record.status) {
            const s = record.status.toLowerCase();
            if (s.includes('atraso') || s.includes('fora')) record.prazo = 'Fora do Prazo';
            else if (s.includes('dentro') || s.includes('no prazo')) record.prazo = 'Dentro do Prazo';
        }

        if (record.codigo && record.prazo) records.push(record);
    }
    return records;
}

async function processJsonFile(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (Array.isArray(data)) resolve(data);
                else resolve([]);
            } catch { resolve([]); }
        };
        reader.readAsText(file);
    });
}

// ===================== UPLOAD =====================
async function loadFile(file) {
    try {
        const records = await processFile(file);
        if (records.length) {
            allData.push(...records);
            loadedFiles.push(file.name);
            showToast(`✅ ${file.name}: ${records.length} registros carregados`);
            updateUI();
        } else {
            showToast(`⚠️ Nenhum dado válido em ${file.name}`, 'error');
        }
    } catch (err) {
        console.error(err);
        showToast(`❌ Erro ao processar ${file.name}`, 'error');
    }
}

uploadArea.addEventListener('click', () => fileInput.click());
uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('dragover'); });
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
uploadArea.addEventListener('drop', async (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    const files = e.dataTransfer.files;
    for (const f of files) await loadFile(f);
});
fileInput.addEventListener('change', async (e) => {
    for (const f of e.target.files) await loadFile(f);
    fileInput.value = '';
});
selectFileBtn.addEventListener('click', () => fileInput.click());

// ===================== ATUALIZAÇÃO DA UI =====================
function updateUI() {
    const empty = allData.length === 0;
    emptyState.style.display = empty ? 'block' : 'none';
    overviewContent.style.display = empty ? 'none' : 'block';
    filesListDiv.style.display = loadedFiles.length ? 'block' : 'none';
    if (empty) {
        kpiGrid.innerHTML = '';
        return;
    }

    updateKPIs();
    updateCharts();
    updateTables();
    updateFilters();
    updateFilesList();
    applyFilters();
}

function updateKPIs() {
    const total = allData.length;
    const dentro = allData.filter(r => r.prazo === 'Dentro do Prazo').length;
    const fora = total - dentro;
    kpiGrid.innerHTML = `
        <div class="kpi-card">
            <div class="kpi-label">Total de Remessas</div>
            <div class="kpi-value">${total.toLocaleString('pt-BR')}</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">No Prazo</div>
            <div class="kpi-value" style="color:#10b981;">${dentro.toLocaleString('pt-BR')}</div>
            <div class="kpi-percent">${((dentro/total)*100).toFixed(1)}%</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">Fora do Prazo</div>
            <div class="kpi-value" style="color:#ef4444;">${fora.toLocaleString('pt-BR')}</div>
            <div class="kpi-percent">${((fora/total)*100).toFixed(1)}%</div>
        </div>
    `;
}

function updateCharts() {
    // Região
    const regioes = {};
    allData.forEach(r => {
        if (!r.regiao) return;
        if (!regioes[r.regiao]) regioes[r.regiao] = { dentro: 0, fora: 0 };
        if (r.prazo === 'Dentro do Prazo') regioes[r.regiao].dentro++;
        else if (r.prazo === 'Fora do Prazo') regioes[r.regiao].fora++;
    });
    const labels = Object.keys(regioes);
    const dentroData = labels.map(l => regioes[l].dentro);
    const foraData = labels.map(l => regioes[l].fora);

    if (charts.chartRegiao) charts.chartRegiao.destroy();
    const ctxRegiao = document.getElementById('chartRegiao').getContext('2d');
    charts.chartRegiao = new Chart(ctxRegiao, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'No Prazo', data: dentroData, backgroundColor: '#10b981' },
                { label: 'Fora do Prazo', data: foraData, backgroundColor: '#ef4444' }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'top' } }
        }
    });

    // Geral
    const totalDentro = allData.filter(r => r.prazo === 'Dentro do Prazo').length;
    const totalFora = allData.length - totalDentro;
    if (charts.chartGeral) charts.chartGeral.destroy();
    const ctxGeral = document.getElementById('chartGeral').getContext('2d');
    charts.chartGeral = new Chart(ctxGeral, {
        type: 'doughnut',
        data: {
            labels: ['No Prazo', 'Fora do Prazo'],
            datasets: [{ data: [totalDentro, totalFora], backgroundColor: ['#10b981', '#ef4444'] }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } } }
    });
}

function updateTables() {
    // Unidades
    const unidadeMap = new Map();
    allData.forEach(r => {
        if (!r.destino) return;
        if (!unidadeMap.has(r.destino)) unidadeMap.set(r.destino, { total:0, dentro:0, fora:0, regiao: r.regiao, uf: r.uf });
        const u = unidadeMap.get(r.destino);
        u.total++;
        if (r.prazo === 'Dentro do Prazo') u.dentro++;
        else if (r.prazo === 'Fora do Prazo') u.fora++;
    });
    let unidadesHtml = '';
    Array.from(unidadeMap.entries()).sort((a,b) => b[1].fora - a[1].fora).forEach(([nome, s]) => {
        const pct = ((s.fora/s.total)*100).toFixed(1);
        unidadesHtml += `<tr><td>${nome}</td><td>${s.total}</td><td class="status-dentro">${s.dentro}</td><td class="status-fora">${s.fora}</td><td>${pct}%</td><td>${s.regiao || '-'}</td><td>${s.uf || '-'}</td></tr>`;
    });
    document.getElementById('unidadesBody').innerHTML = unidadesHtml;

    // Regiões
    const regMap = {};
    allData.forEach(r => {
        if (!r.regiao) return;
        if (!regMap[r.regiao]) regMap[r.regiao] = { total:0, dentro:0, fora:0 };
        regMap[r.regiao].total++;
        if (r.prazo === 'Dentro do Prazo') regMap[r.regiao].dentro++;
        else if (r.prazo === 'Fora do Prazo') regMap[r.regiao].fora++;
    });
    let regHtml = '';
    Object.entries(regMap).forEach(([reg, s]) => {
        const pct = ((s.fora/s.total)*100).toFixed(1);
        regHtml += `<tr><td>${reg}</td><td>${s.total}</td><td class="status-dentro">${s.dentro}</td><td class="status-fora">${s.fora}</td><td>${pct}%</td><td><div class="progress-bar"><div class="progress-fill" style="width: ${pct}%"></div></div></td></tr>`;
    });
    document.getElementById('regioesBody').innerHTML = regHtml;

    // Estados
    const ufMap = {};
    allData.forEach(r => {
        if (!r.uf) return;
        if (!ufMap[r.uf]) ufMap[r.uf] = { total:0, dentro:0, fora:0 };
        ufMap[r.uf].total++;
        if (r.prazo === 'Dentro do Prazo') ufMap[r.uf].dentro++;
        else if (r.prazo === 'Fora do Prazo') ufMap[r.uf].fora++;
    });
    let ufHtml = '';
    Object.entries(ufMap).sort().forEach(([uf, s]) => {
        const pct = ((s.fora/s.total)*100).toFixed(1);
        ufHtml += `<tr><td>${uf}</td><td>${s.total}</td><td class="status-dentro">${s.dentro}</td><td class="status-fora">${s.fora}</td><td>${pct}%</td><td><div class="progress-bar"><div class="progress-fill" style="width: ${pct}%"></div></div></td></tr>`;
    });
    document.getElementById('estadosBody').innerHTML = ufHtml;
}

function updateFilters() {
    const regioes = [...new Set(allData.map(r => r.regiao).filter(r => r))];
    const ufs = [...new Set(allData.map(r => r.uf).filter(r => r))];
    let html = '<option value="all">Todas</option>';
    regioes.forEach(r => html += `<option value="${r}">${r}</option>`);
    filterRegiao.innerHTML = html;
    html = '<option value="all">Todos</option>';
    ufs.forEach(u => html += `<option value="${u}">${u}</option>`);
    filterUF.innerHTML = html;
}

function updateFilesList() {
    let html = '';
    loadedFiles.forEach((f, i) => {
        html += `<div class="file-item">${f} <span class="remove" onclick="removeFile(${i})">✕</span></div>`;
    });
    filesContainer.innerHTML = html;
}
window.removeFile = (idx) => { loadedFiles.splice(idx,1); updateFilesList(); };

function applyFilters() {
    const regiao = filterRegiao.value;
    const uf = filterUF.value;
    const prazo = filterPrazo.value;
    const search = searchCodigo.value.toLowerCase();

    const filtered = allData.filter(r => {
        if (regiao !== 'all' && r.regiao !== regiao) return false;
        if (uf !== 'all' && r.uf !== uf) return false;
        if (prazo !== 'all' && r.prazo !== prazo) return false;
        if (search && !r.codigo.toLowerCase().includes(search)) return false;
        return true;
    });

    let dadosHtml = '';
    filtered.slice(0, 200).forEach(r => {
        const statusClass = r.prazo === 'Dentro do Prazo' ? 'status-dentro' : 'status-fora';
        dadosHtml += `<tr><td>${r.codigo}</td><td>${r.destino}</td><td>${r.uf}</td><td>${r.regiao}</td><td class="${statusClass}">${r.prazo}</td><td>${r.status}</td><td><small>${r.arquivo}</small></td></tr>`;
    });
    document.getElementById('dadosBody').innerHTML = dadosHtml;
}

// ===================== EXPORT / CLEAR =====================
function exportXLSX() {
    if (!allData.length) return showToast('Nenhum dado para exportar', 'error');
    const ws = XLSX.utils.json_to_sheet(allData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Performance');
    XLSX.writeFile(wb, `performance_${new Date().toISOString().slice(0,10)}.xlsx`);
    showToast('✅ Exportado XLSX');
}

function exportJSON() {
    if (!allData.length) return showToast('Nenhum dado para exportar', 'error');
    const json = JSON.stringify(allData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `performance_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('✅ Exportado JSON');
}

function clearAllData() {
    if (confirm('Limpar todos os dados carregados?')) {
        allData = [];
        loadedFiles = [];
        updateUI();
        showToast('Dados removidos');
    }
}

// ===================== EVENT LISTENERS =====================
exportXLSXBtn.addEventListener('click', exportXLSX);
exportJSONBtn.addEventListener('click', exportJSON);
clearDataBtn.addEventListener('click', clearAllData);
filterRegiao.addEventListener('change', applyFilters);
filterUF.addEventListener('change', applyFilters);
filterPrazo.addEventListener('change', applyFilters);
searchCodigo.addEventListener('input', applyFilters);

// ===================== INICIALIZAÇÃO =====================
function init() {
    updateUI();
    // Ativa navegação por abas manualmente (bootstrap não incluso, então faremos com JS puro)
    const tabs = document.querySelectorAll('[data-bs-target]');
    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            const targetId = tab.getAttribute('data-bs-target');
            document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('show', 'active'));
            document.getElementById(targetId.substring(1)).classList.add('show', 'active');
            document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
            tab.classList.add('active');
        });
    });
}
init();
