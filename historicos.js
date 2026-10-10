const historyEls = {
    status: document.getElementById('history-status'),
    list: document.getElementById('archived-history-list'),
    search: document.getElementById('archive-search'),
    month: document.getElementById('archive-month-filter'),
    refresh: document.getElementById('refresh-history-btn'),
    selectionLabel: document.getElementById('archive-selection-label'),
    selectVisible: document.getElementById('select-visible-history-btn'),
    deleteSelected: document.getElementById('delete-selected-history-btn'),
    deleteAll: document.getElementById('delete-all-history-btn'),
    days: document.getElementById('archive-days-total'),
    orders: document.getElementById('archive-orders-total'),
    items: document.getElementById('archive-items-total'),
    value: document.getElementById('archive-value-total')
};

let historyRows = [];
let historyClient = null;
const selectedHistoryScopes = new Set();

function escapeHistoryHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[character]);
}

function currency(value) {
    return Number(value || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
}

function getArchiveOrders(row) { return Object.values(row && row.payload && row.payload.orders || {}); }
function getOrderItems(order) { return (order.items || []).reduce((sum,item) => sum + (Number(item.qty) || 0), 0); }

function updateOverview(rows) {
    const orders = rows.flatMap(getArchiveOrders);
    historyEls.days.textContent = rows.length;
    historyEls.orders.textContent = orders.length;
    historyEls.items.textContent = orders.reduce((sum,order) => sum + getOrderItems(order), 0);
    historyEls.value.textContent = currency(orders.reduce((sum,order) => sum + (Number(order.total) || 0), 0));
}

function populateMonths(rows) {
    const current = historyEls.month.value;
    const months = [...new Set(rows.map(row => String(row.payload && row.payload.date || '').slice(0,7)).filter(Boolean))].sort().reverse();
    historyEls.month.innerHTML = '<option value="">Todos os meses</option>' + months.map(month => {
        const [year,number] = month.split('-');
        const label = new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'America/Manaus'}).format(new Date(`${year}-${number}-15T12:00:00-04:00`));
        return `<option value="${month}">${escapeHistoryHtml(label.charAt(0).toUpperCase()+label.slice(1))}</option>`;
    }).join('');
    if (months.includes(current)) historyEls.month.value = current;
}

function getFilteredHistoryRows() {
    const query = historyEls.search.value.trim().toLowerCase();
    const month = historyEls.month.value;
    return historyRows.filter(row => {
        const archive = row.payload || {};
        if (month && !String(archive.date || '').startsWith(month)) return false;
        if (!query) return true;
        return getArchiveOrders(row).some(order => {
            const searchable = [order.senha,order.clientName,order.feature,order.waiterName]
                .concat((order.items || []).map(item => item.product && item.product.name)).join(' ').toLowerCase();
            return searchable.includes(query);
        });
    });
}

function updateDeleteControls() {
    const selectedCount = selectedHistoryScopes.size;
    historyEls.selectionLabel.textContent = selectedCount
        ? `${selectedCount} dia${selectedCount === 1 ? '' : 's'} selecionado${selectedCount === 1 ? '' : 's'}`
        : 'Nenhum dia selecionado';
    historyEls.deleteSelected.disabled = selectedCount === 0;
    historyEls.deleteAll.disabled = historyRows.length === 0;
    historyEls.selectVisible.disabled = getFilteredHistoryRows().length === 0;
}

function renderHistories() {
    const rows = getFilteredHistoryRows();
    updateOverview(rows);
    updateDeleteControls();
    if (!rows.length) {
        historyEls.list.innerHTML = `<div class="archive-message">${historyRows.length ? 'Nenhum histórico corresponde aos filtros.' : 'Nenhum histórico diário foi salvo ainda.'}</div>`;
        return;
    }
    historyEls.list.innerHTML = rows.map(row => {
        const archive = row.payload || {};
        const orders = getArchiveOrders(row).sort((a,b) => Number(a.deliveredAt || a.timestamp || 0)-Number(b.deliveredAt || b.timestamp || 0));
        const itemCount = orders.reduce((sum,order) => sum + getOrderItems(order),0);
        const total = orders.reduce((sum,order) => sum + (Number(order.total)||0),0);
        const date = archive.date ? archive.date.split('-').reverse().join('/') : row.scope;
        const orderRows = orders.map(order => `<div class="archive-order-row"><strong>#${escapeHistoryHtml(order.senha || '---')} · ${escapeHistoryHtml(order.clientName || 'Cliente')}</strong><span>${(order.items || []).map(item => `${Number(item.qty)||0}x ${escapeHistoryHtml(item.product && item.product.name || 'Item')}`).join(' • ')}</span><b>${currency(order.total)}</b></div>`).join('');
        return `<details class="archive-day-card"><summary><input class="archive-select" type="checkbox" data-scope="${escapeHistoryHtml(row.scope)}" aria-label="Selecionar histórico de ${date}" ${selectedHistoryScopes.has(row.scope) ? 'checked' : ''}><span class="archive-date"><strong>${escapeHistoryHtml(archive.day || 'Dia')} · ${date}</strong><small>${escapeHistoryHtml(archive.month || '')} de ${escapeHistoryHtml(archive.year || '')}</small></span><span class="archive-summary">${orders.length} pedidos · ${itemCount} itens · ${currency(total)}</span></summary><div class="archive-orders-list">${orderRows}</div></details>`;
    }).join('');
    historyEls.list.querySelectorAll('.archive-select').forEach(input => {
        input.addEventListener('click', event => event.stopPropagation());
        input.addEventListener('change', event => {
            if (event.target.checked) selectedHistoryScopes.add(event.target.dataset.scope);
            else selectedHistoryScopes.delete(event.target.dataset.scope);
            updateDeleteControls();
        });
    });
}

async function deleteHistories(scopes) {
    const targets = [...new Set(scopes)].filter(scope => historyRows.some(row => row.scope === scope));
    if (!targets.length) return;
    const label = targets.length === historyRows.length
        ? `todo o histórico salvo (${targets.length} dias)`
        : `${targets.length} dia${targets.length === 1 ? '' : 's'} selecionado${targets.length === 1 ? '' : 's'}`;
    if (!confirm(`Excluir definitivamente ${label}? Esta ação não poderá ser desfeita.`)) return;
    [historyEls.deleteSelected, historyEls.deleteAll, historyEls.selectVisible].forEach(button => button.disabled = true);
    historyEls.status.className = 'history-status offline';
    historyEls.status.textContent = 'Excluindo...';
    try {
        await CanelaSupabase.history.remove(targets);
        targets.forEach(scope => selectedHistoryScopes.delete(scope));
        if (historyClient && historyClient.connected) {
            historyClient.publish('caneladefogo/pedidos/sync', JSON.stringify({ type:'HISTORY_DELETE', scopes:targets, deletedAt:Date.now() }));
        }
        await loadHistories();
        alert(`${targets.length} histórico${targets.length === 1 ? '' : 's'} excluído${targets.length === 1 ? '' : 's'} com sucesso.`);
    } catch (error) {
        console.error('Erro ao excluir históricos:',error);
        historyEls.status.textContent = '● Falha na exclusão';
        alert(error.message || 'Não foi possível excluir os históricos. Tente novamente.');
        updateDeleteControls();
    }
}

async function loadHistories() {
    historyEls.refresh.disabled = true;
    historyEls.status.className = 'history-status offline';
    historyEls.status.textContent = 'Sincronizando...';
    try {
        if (!window.CanelaSupabase || !CanelaSupabase.history) throw new Error('Supabase indisponível');
        historyRows = await CanelaSupabase.history.list();
        const validScopes = new Set(historyRows.map(row => row.scope));
        [...selectedHistoryScopes].forEach(scope => { if (!validScopes.has(scope)) selectedHistoryScopes.delete(scope); });
        populateMonths(historyRows);
        renderHistories();
        historyEls.status.className = 'history-status online';
        historyEls.status.textContent = '● Conectado';
    } catch (error) {
        console.error('Erro ao carregar históricos:',error);
        historyEls.list.innerHTML = '<div class="archive-message error">Não foi possível carregar os históricos. Verifique a conexão e tente novamente.</div>';
        historyEls.status.textContent = '● Sem conexão';
    } finally { historyEls.refresh.disabled = false; }
}

historyEls.search.addEventListener('input',renderHistories);
historyEls.month.addEventListener('change',renderHistories);
historyEls.refresh.addEventListener('click',loadHistories);
historyEls.selectVisible.addEventListener('click',() => {
    getFilteredHistoryRows().forEach(row => selectedHistoryScopes.add(row.scope));
    renderHistories();
});
historyEls.deleteSelected.addEventListener('click',() => deleteHistories([...selectedHistoryScopes]));
historyEls.deleteAll.addEventListener('click',() => deleteHistories(historyRows.map(row => row.scope)));

if (window.CanelaSupabase) {
    historyClient = CanelaSupabase.createClient();
    historyClient.on('connect',loadHistories);
    historyClient.on('message',(_topic,message) => {
        try { const data=JSON.parse(message.toString()); if(data.type==='CLEAR_HISTORY' || data.type==='HISTORY_DELETE') loadHistories(); } catch (_) {}
    });
    historyClient.on('offline',() => { historyEls.status.className='history-status offline'; historyEls.status.textContent='● Sem conexão'; });
} else { loadHistories(); }
