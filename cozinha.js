const topic = 'caneladefogo/pedidos/sync';
let syncClient = null;
let kitchenSyncOnline = false;

const els = {
    pratosFilaContainer: document.getElementById('pratos-fila-container'),
    prontosContainer: document.getElementById('prontos-container'),
    entreguesContainer: document.getElementById('entregues-container'),
    chapeiroContainer: document.getElementById('chapeiro-container'),
    fritadeiraContainer: document.getElementById('fritadeira-container'),
    status: document.getElementById('status'),
    emptyState: document.getElementById('empty-state'),
    kitchenSearch: document.getElementById('kitchen-search'),
    countPratosFila: document.getElementById('count-pratos-fila'),
    countProntos: document.getElementById('kitchen-count-prontos'),
    countPratosTotal: document.getElementById('count-pratos-total'),
    countEntregues: document.getElementById('kitchen-count-entregues'),
    countChapeiro: document.getElementById('kitchen-count-chapeiro'),
    countFritadeira: document.getElementById('kitchen-count-fritadeira'),
    queueMetrics: document.getElementById('queue-metrics'),
    kitchenHistoryBar: document.getElementById('kitchen-history-bar'),
    kitchenTotalEntreguesVal: document.getElementById('kitchen-total-entregues-val'),
    kitchenClearHistoryBtn: document.getElementById('kitchen-clear-history-btn'),
    resetPasswordsBtn: document.getElementById('reset-passwords-btn'),
    prepSettingsBtn: document.getElementById('prep-settings-btn'),
    prepSettingsOverlay: document.getElementById('prep-settings-overlay'),
    closePrepSettingsBtn: document.getElementById('close-prep-settings-btn'),
    savePrepSettingsBtn: document.getElementById('save-prep-settings-btn'),
    productPricesBtn: document.getElementById('product-prices-btn'),
    productPricesOverlay: document.getElementById('product-prices-overlay'),
    productPricesList: document.getElementById('product-prices-list'),
    closeProductPricesBtn: document.getElementById('close-product-prices-btn'),
    saveProductPricesBtn: document.getElementById('save-product-prices-btn'),
    editOrderOverlay: document.getElementById('edit-order-overlay'),
    editOrderPassword: document.getElementById('edit-order-password'),
    editOrderClient: document.getElementById('edit-order-client'),
    editOrderFeature: document.getElementById('edit-order-feature'),
    editOrderPriority: document.getElementById('edit-order-priority'),
    editOrderStatus: document.getElementById('edit-order-status'),
    editOrderObs: document.getElementById('edit-order-obs'),
    editOrderItems: document.getElementById('edit-order-items'),
    closeEditOrderBtn: document.getElementById('close-edit-order-btn'),
    openFullOrderEditorBtn: document.getElementById('open-full-order-editor-btn'),
    saveEditOrderBtn: document.getElementById('save-edit-order-btn')
};

let currentTab = 'pratos';
let kitchenSearchQuery = "";
let historyClearedAt = Number(localStorage.getItem('canela_history_cleared_at')) || 0;
let deletedOrderIds = loadDeletedOrderIds();
let editingOrderId = null;
let prepTimeSettings = loadPrepTimeSettings();
const PRODUCT_PRICE_GROUPS = {
    'Pratos': {
        'Carne de Sol na Chapa': 25, 'Misto na Chapa': 25, 'Picanha na Chapa': 35,
        'Filé de Frango Frito': 25, 'Filé de Tambaqui Frito': 35,
        'Adicional do prato': 3
    },
    'Caldos': {
        'Caldo comum 350ml sem acompanhamento': 15,
        'Caldo comum 350ml com acompanhamento': 18,
        'Caldo comum 500ml sem acompanhamento': 25,
        'Caldo comum 500ml com acompanhamento': 27,
        'Caldo de Camarão 350ml sem acompanhamento': 18,
        'Caldo de Camarão 350ml com acompanhamento': 20,
        'Caldo de Camarão 500ml sem acompanhamento': 25,
        'Caldo de Camarão 500ml com acompanhamento': 30
    },
    'Refrigerantes': {
        'Coca-Cola Lata': 6, 'Coca-Cola Zero Lata': 6, 'Fanta Uva Lata': 6,
        'Fanta Laranja Lata': 6, 'Coca-Cola 1L': 12, 'Fanta Laranja 1L': 12, 'Baré 1L': 12
    },
    'Sucos e outras bebidas': {
        'Suco de Acerola': 8, 'Suco de Maracujá': 8, 'Água Mineral': 6
    }
};
const PRODUCT_PRICE_DEFAULTS = Object.assign({}, ...Object.values(PRODUCT_PRICE_GROUPS));
let productPriceSettings = loadProductPriceSettings();

function loadProductPriceSettings() {
    try { return JSON.parse(localStorage.getItem('canela_product_prices')) || { items: { ...PRODUCT_PRICE_DEFAULTS }, updatedAt: 0 }; }
    catch (error) { return { items: { ...PRODUCT_PRICE_DEFAULTS }, updatedAt: 0 }; }
}

function saveProductPriceSettings(settings, publish = true) {
    if (!settings || Number(settings.updatedAt || 0) < Number(productPriceSettings.updatedAt || 0)) return;
    productPriceSettings = { items: { ...PRODUCT_PRICE_DEFAULTS, ...(settings.items || {}) }, updatedAt: Number(settings.updatedAt) || Date.now() };
    localStorage.setItem('canela_product_prices', JSON.stringify(productPriceSettings));
    if (window.CanelaSupabase) CanelaSupabase.state.save('product_prices', productPriceSettings).catch(error => console.warn('Preços aguardando sincronização:', error));
    if (publish) publishUpdate({ type: 'PRODUCT_PRICE_SETTINGS', settings: productPriceSettings }, false);
}

function loadPrepTimeSettings() {
    const defaults = { baseCarne: 10, basePicanha: 12, baseCaldo: 8, incrementCarne: 4, incrementPicanha: 6, incrementCaldo: 3, updatedAt: 0 };
    try { return { ...defaults, ...(JSON.parse(localStorage.getItem('canela_prep_time_settings')) || {}) }; }
    catch (error) { return defaults; }
}

function savePrepTimeSettings(settings, publish = true) {
    prepTimeSettings = { ...prepTimeSettings, ...settings, updatedAt: Number(settings.updatedAt) || Date.now() };
    localStorage.setItem('canela_prep_time_settings', JSON.stringify(prepTimeSettings));
    if (window.CanelaSupabase) CanelaSupabase.state.save('prep_times', prepTimeSettings).catch(error => console.warn('Tempos aguardando sincronização:', error));
    if (publish) publishUpdate({ type: 'PREP_TIME_SETTINGS', settings: prepTimeSettings }, false);
    renderAll();
}

// --- PERSISTÊNCIA LOCAL DOS PEDIDOS NA COZINHA ---
function loadStoredOrders() {
    try {
        const raw = localStorage.getItem('cozinha_orders_sync');
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        const normalized = {};
        for (let key in parsed) {
            const ord = normalizeDeprecatedReadyStatus(parsed[key]);
            if (deletedOrderIds[ord.id || key]) continue;
            if (shouldSuppressDeliveredOrder(ord)) continue;
            const safeId = ord.id || ord.senha || key;
            if (!ord.id) ord.id = safeId;
            normalized[safeId] = ord;
        }
        return normalized;
    } catch (e) {
        console.error("Erro ao carregar dados da cozinha:", e);
        return {};
    }
}

function loadDeletedOrderIds() {
    try {
        return JSON.parse(localStorage.getItem('canela_deleted_order_ids')) || {};
    } catch (error) {
        return {};
    }
}

function applyDeletedOrderMarkers(markers) {
    if (!markers || typeof markers !== 'object') return;
    Object.entries(markers).forEach(([id, deletedAt]) => {
        deletedOrderIds[id] = Math.max(Number(deletedOrderIds[id]) || 0, Number(deletedAt) || Date.now());
        delete globalOrders[id];
        if (editingOrderId === id) closeEditOrder();
    });
    localStorage.setItem('canela_deleted_order_ids', JSON.stringify(deletedOrderIds));
    saveStoredOrders();
}

function deleteOrderPermanently(pedido) {
    if (!pedido || !pedido.id) return;
    if (!confirm(`Excluir definitivamente o pedido #${pedido.senha || '—'} de ${pedido.clientName || 'Cliente'}? Esta ação não pode ser desfeita.`)) return;
    const deletedAt = Date.now();
    applyDeletedOrderMarkers({ [pedido.id]: deletedAt });
    publishUpdate({ type: 'DELETE_ORDER', orderId: pedido.id, deletedAt }, false);
    renderAll();
}

function isFullyDelivered(order) {
    return Boolean(order && (((order.items || []).length > 0 && order.items.every(item => item.status === 'entregue')) || order.deliveredAt));
}

function normalizeDeprecatedReadyStatus(order) {
    if (!order || !Array.isArray(order.items)) return order;
    order.items.forEach(item => {
        if (item.status === 'em_preparo') {
            item.status = 'pronto';
            item.readyAt ||= Date.now();
        }
    });
    return order;
}

function shouldSuppressDeliveredOrder(order) {
    if (!historyClearedAt || !isFullyDelivered(order)) return false;
    const completedAt = Number(order.deliveredAt || order.updatedAt || order.timestamp || 0);
    return completedAt <= historyClearedAt;
}

function applyHistoryClear(clearedAt = Date.now()) {
    historyClearedAt = Math.max(historyClearedAt, Number(clearedAt) || Date.now());
    localStorage.setItem('canela_history_cleared_at', String(historyClearedAt));
    for (const key in globalOrders) {
        if (shouldSuppressDeliveredOrder(globalOrders[key])) delete globalOrders[key];
    }
    saveStoredOrders();
}

function saveStoredOrders() {
    try {
        localStorage.setItem('cozinha_orders_sync', JSON.stringify(globalOrders));
        if (window.CanelaPersistence) {
            CanelaPersistence.saveSnapshot('cozinha_orders', globalOrders);
        }
        if (window.CanelaSupabase) {
            CanelaSupabase.state.save('orders_cozinha', {
                orders: globalOrders,
                deletedOrderIds,
                historyClearedAt
            }).catch(error => console.warn('Pedidos aguardando sincronização:', error));
        }
    } catch (e) {
        console.error("Erro ao salvar dados da cozinha:", e);
    }
}

let globalOrders = loadStoredOrders();

async function hydrateKitchenOrders() {
    const mergeOrders = orders => Object.values(orders || {}).forEach(order => {
        normalizeDeprecatedReadyStatus(order);
        if (deletedOrderIds[order.id || order.senha]) return;
        if (shouldSuppressDeliveredOrder(order)) return;
        const id = order.id || order.senha;
        const current = globalOrders[id];
        if (!current || (order.updatedAt || order.timestamp || 0) >= (current.updatedAt || current.timestamp || 0)) {
            globalOrders[id] = order;
        }
    });
    if (window.CanelaPersistence) {
        const persisted = await CanelaPersistence.loadSnapshot('cozinha_orders');
        if (persisted && typeof persisted === 'object') mergeOrders(persisted);
    }
    if (window.CanelaSupabase) {
        try {
            const snapshots = await Promise.all([
                CanelaSupabase.state.load('orders_cozinha'),
                CanelaSupabase.state.load('orders_atendimento'),
                CanelaSupabase.state.load('product_prices'),
                CanelaSupabase.state.load('prep_times'),
                CanelaSupabase.state.load('beverage_stock')
            ]);
            snapshots.slice(0, 2).forEach(snapshot => {
                if (!snapshot || !snapshot.payload) return;
                applyDeletedOrderMarkers(snapshot.payload.deletedOrderIds);
                if (snapshot.payload.historyClearedAt) applyHistoryClear(snapshot.payload.historyClearedAt);
                mergeOrders(snapshot.payload.orders);
            });
            if (snapshots[2] && snapshots[2].payload) saveProductPriceSettings(snapshots[2].payload, false);
            if (snapshots[3] && snapshots[3].payload) savePrepTimeSettings(snapshots[3].payload, false);
            if (snapshots[4] && snapshots[4].payload) receiveStockSnapshot(snapshots[4].payload);
        } catch (error) {
            console.warn('Estado remoto ainda indisponível:', error);
        }
    }
    saveStoredOrders();
    renderAll();
}

// A conexão operacional começa automaticamente ao abrir o painel.
setTimeout(() => {
    connectSync();
    keepScreenAlive();
}, 0);

// Alternância de Abas
window.switchTab = function (tabName) {
    currentTab = tabName;
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.style.background = '#444';
        btn.style.color = 'white';
    });

    const activeBtn = document.getElementById(`tab-${tabName}`);
    if (activeBtn) {
        activeBtn.style.background = 'var(--primary-color)';
        activeBtn.style.color = '#000';
    }

    document.querySelectorAll('.kitchen-board > .column, .kitchen-board > .kanban-board').forEach(container => container.style.display = 'none');
    const containerId = `${tabName}-container`;
    const activeContainer = document.getElementById(containerId);
    if (activeContainer) {
        activeContainer.style.display = activeContainer.classList.contains('kanban-board') ? 'grid' : 'flex';
    }

    if (els.kitchenHistoryBar) {
        if (tabName === 'entregues') {
            els.kitchenHistoryBar.open = false;
            const toggleLabel = els.kitchenHistoryBar.querySelector('.history-toggle-label');
            if (toggleLabel) toggleLabel.textContent = 'Ver análise de itens e tempos';
            els.kitchenHistoryBar.classList.remove('hidden');
        } else {
            els.kitchenHistoryBar.classList.add('hidden');
        }
    }

    renderAll();
};

if (els.kitchenHistoryBar) {
    els.kitchenHistoryBar.addEventListener('toggle', () => {
        const toggleLabel = els.kitchenHistoryBar.querySelector('.history-toggle-label');
        if (toggleLabel) toggleLabel.textContent = els.kitchenHistoryBar.open
            ? 'Recolher análise'
            : 'Ver análise de itens e tempos';
    });
}

// --- CONEXÃO E SINCRONIZAÇÃO SUPABASE ---
function connectSync() {
    if (!window.CanelaSupabase) {
        els.status.textContent = '● SERVIÇO DE CONEXÃO INDISPONÍVEL';
        els.status.className = 'status-offline';
        return;
    }
    if (syncClient) {
        // O cliente de sincronização mantém o ciclo de reconexão.
        // outra conexão durante pageshow/focus evita duas tentativas concorrentes.
        return;
    }
    els.status.textContent = 'Conectando Servidor...';
    els.status.className = 'status-offline';

    syncClient = CanelaSupabase.createClient();

    syncClient.on('connect', () => {
        kitchenSyncOnline = true;
        els.status.textContent = '● CONECTADO • SINCRONIZANDO';
        els.status.className = 'status-online';
        syncClient.subscribe(topic, (err) => {
            if (!err) {
                els.status.textContent = '● CONECTADO (Aguardando Pedidos)';
                els.status.className = 'status-online';
                refreshKitchenSyncStatus();
                publishUpdate({ type: 'REQUEST_SYNC' }, false);
                flushKitchenOutbox();
            } else {
                kitchenSyncOnline = false;
                els.status.textContent = '● FALHA AO SINCRONIZAR • RECONECTANDO';
                els.status.className = 'status-offline';
            }
        });
    });

    syncClient.on('reconnect', () => {
        kitchenSyncOnline = false;
        els.status.textContent = 'Reconectando...';
        els.status.className = 'status-offline';
    });

    syncClient.on('offline', () => {
        kitchenSyncOnline = false;
        els.status.textContent = '● OFFLINE';
        els.status.className = 'status-offline';
    });

    syncClient.on('close', () => {
        kitchenSyncOnline = false;
        els.status.textContent = navigator.onLine ? 'Reconectando...' : '● SEM INTERNET';
        els.status.className = 'status-offline';
    });

    syncClient.on('error', error => {
        kitchenSyncOnline = false;
        els.status.textContent = error && /PGRST205|sync_events|sync_state/.test(error.message || '')
            ? '● BANCO AGUARDANDO CONFIGURAÇÃO'
            : '● ERRO DE CONEXÃO';
        els.status.className = 'status-offline';
    });

    syncClient.on('message', (t, message) => {
        if (t !== topic) return;
        try {
            const data = JSON.parse(message.toString());

            // 1. Pedido de sincronização de outro dispositivo
            if (data.type === 'REQUEST_SYNC') {
                const list = Object.values(globalOrders);
                publishUpdate({ type: 'SYNC_ALL_ORDERS', orders: list, historyClearedAt, deletedOrderIds, prepTimeSettings, productPriceSettings }, false);
                publishStockSnapshot(false);
                return;
            }

            if (data.type === 'STOCK_UPDATE' && data.stock) {
                receiveStockSnapshot(data.stock);
                return;
            }

            // 2. Resposta com lista de todos os pedidos
            if (data.type === 'SYNC_ALL_ORDERS' && Array.isArray(data.orders)) {
                applyDeletedOrderMarkers(data.deletedOrderIds);
                if (data.historyClearedAt) applyHistoryClear(data.historyClearedAt);
                if (data.prepTimeSettings && Number(data.prepTimeSettings.updatedAt || 0) > Number(prepTimeSettings.updatedAt || 0)) savePrepTimeSettings(data.prepTimeSettings, false);
                if (data.productPriceSettings) saveProductPriceSettings(data.productPriceSettings, false);
                let ordersChanged = false;
                data.orders.forEach(ord => {
                    normalizeDeprecatedReadyStatus(ord);
                    if (deletedOrderIds[ord.id]) return;
                    if (shouldSuppressDeliveredOrder(ord)) return;
                    const safeId = ord.id || `ord_${ord.senha}_${ord.timestamp || Date.now()}`;
                    ord.id = safeId;
                    const current = globalOrders[safeId];
                    const merged = window.mergeCanelaOrders ? mergeCanelaOrders(current, ord) : ord;
                    if (!current || JSON.stringify(current) !== JSON.stringify(merged)) {
                        globalOrders[safeId] = merged;
                        ordersChanged = true;
                    }
                });
                if (ordersChanged) {
                    saveStoredOrders();
                    reconcileDeliveredBeverages();
                }
                renderAll();
                return;
            }

            // 3. Limpeza de Histórico
            if (data.type === 'CLEAR_HISTORY') {
                applyDeletedOrderMarkers(data.deletedOrderIds);
                applyHistoryClear(data.clearedAt);
                renderAll();
                return;
            }

            if (data.type === 'DELETE_ORDER' && data.orderId) {
                applyDeletedOrderMarkers({ [data.orderId]: data.deletedAt || Date.now() });
                renderAll();
                return;
            }

            if (data.type === 'PREP_TIME_SETTINGS' && data.settings) {
                if (Number(data.settings.updatedAt || 0) > Number(prepTimeSettings.updatedAt || 0)) savePrepTimeSettings(data.settings, false);
                return;
            }

            if (data.type === 'PRODUCT_PRICE_SETTINGS' && data.settings) {
                saveProductPriceSettings(data.settings, false);
                return;
            }

            if (data.type === 'RESET_PASSWORDS') return;

            // 4. Pedido individual
            const pedido = data.order || data;
            if (!pedido || (!pedido.id && !pedido.senha)) return;
            normalizeDeprecatedReadyStatus(pedido);

            const safeId = pedido.id || `ord_${pedido.senha}_${pedido.timestamp || Date.now()}`;
            pedido.id = safeId;
            if (deletedOrderIds[safeId]) return;
            if (shouldSuppressDeliveredOrder(pedido)) {
                delete globalOrders[safeId];
                saveStoredOrders();
                renderAll();
                return;
            }

            // Checar se há novos itens na fila para tocar alerta sonoro
            let isNewAction = false;
            const existing = globalOrders[safeId];
            const mergedPedido = window.mergeCanelaOrders ? mergeCanelaOrders(existing, pedido) : pedido;
            const orderChanged = !existing || JSON.stringify(existing) !== JSON.stringify(mergedPedido);
            if (!existing) {
                const hasFila = mergedPedido.items.some(i => (i.status || 'fila') === 'fila');
                if (hasFila) isNewAction = true;
            } else {
                const oldFila = existing.items.filter(i => (i.status || 'fila') === 'fila').length;
                const newFila = mergedPedido.items.filter(i => (i.status || 'fila') === 'fila').length;
                if (newFila > oldFila) isNewAction = true;
            }

            if (orderChanged) {
                globalOrders[safeId] = mergedPedido;
                saveStoredOrders();
                reconcileDeliveredBeverages();
                renderAll();
            }

            if (data.type === 'ORDER_UPDATE') {
                publishUpdate({ type: 'ORDER_RECEIVED_ACK', orderId: safeId, updatedAt: mergedPedido.updatedAt || mergedPedido.timestamp || Date.now() }, false);
            }

        } catch (e) {
            console.error("Erro ao processar mensagem na cozinha:", e);
        }
    });
}

async function publishUpdate(payload, saveLocally = true) {
    const reliable = payload && (payload.type === 'ORDER_UPDATE' || payload.type === 'CLEAR_HISTORY' || payload.type === 'STOCK_UPDATE' || payload.type === 'RESET_PASSWORDS' || payload.type === 'DELETE_ORDER' || payload.type === 'PREP_TIME_SETTINGS' || payload.type === 'PRODUCT_PRICE_SETTINGS');
    if (reliable && window.CanelaPersistence) {
        const queued = await CanelaPersistence.enqueue('cozinha', payload);
        if (queued) {
            refreshKitchenSyncStatus();
            flushKitchenOutbox();
        } else if (syncClient && syncClient.connected) {
            syncClient.publish(topic, JSON.stringify(payload), { qos: 1 });
        }
    } else if (syncClient && syncClient.connected) {
        syncClient.publish(topic, JSON.stringify(payload), { qos: 1 });
    }
    if (saveLocally && payload.id) {
        globalOrders[payload.id] = payload;
        saveStoredOrders();
        renderAll();
    }
}

async function refreshKitchenSyncStatus() {
    if (!els.status) return;
    const pending = window.CanelaPersistence
        ? (await CanelaPersistence.listPending('cozinha')).length
        : 0;
    if (pending > 0) {
        els.status.textContent = `● ${pending} atualização(ões) pendente(s)`;
        els.status.className = 'status-pending';
    } else if (kitchenSyncOnline) {
        els.status.textContent = '● CONECTADO • SINCRONIZADO';
        els.status.className = 'status-online';
    }
}

let kitchenOutboxFlushing = false;
async function flushKitchenOutbox() {
    if (kitchenOutboxFlushing || !window.CanelaPersistence || !syncClient || !syncClient.connected) return;
    kitchenOutboxFlushing = true;
    try {
        const pending = await CanelaPersistence.listPending('cozinha');
        for (const entry of pending) {
            if (!syncClient.connected) break;
            await new Promise((resolve, reject) => {
                syncClient.publish(topic, JSON.stringify(entry.payload), { qos: 1 }, error => error ? reject(error) : resolve());
            });
            await CanelaPersistence.removePending(entry.id);
            refreshKitchenSyncStatus();
        }
    } catch (error) {
        console.warn('Envios da cozinha continuarão pendentes:', error);
    } finally {
        kitchenOutboxFlushing = false;
        if (syncClient && syncClient.connected) {
            const remaining = await CanelaPersistence.listPending('cozinha');
            if (remaining.length > 0) setTimeout(flushKitchenOutbox, 0);
        }
    }
}

// Filtro de Busca
if (els.kitchenSearch) {
    els.kitchenSearch.oninput = (e) => {
        kitchenSearchQuery = e.target.value.trim().toLowerCase();
        renderAll();
    };
}

function getOperationPeriod(timestamp = Date.now()) {
    const date = new Date(timestamp);
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Manaus', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
    const weekdayRaw = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Manaus', weekday: 'long' }).format(date).replace('-feira', '');
    const monthRaw = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Manaus', month: 'long' }).format(date);
    return {
        date: dateKey,
        day: weekdayRaw.charAt(0).toUpperCase() + weekdayRaw.slice(1),
        month: monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1),
        year: Number(parts.year)
    };
}

async function archiveDeliveredOrders(entreguesList) {
    if (!window.CanelaSupabase || !CanelaSupabase.history) throw new Error('Banco de históricos indisponível');
    const period = getOperationPeriod();
    const orders = Object.fromEntries(entreguesList.map(order => [order.id || order.senha, JSON.parse(JSON.stringify(order))]));
    return CanelaSupabase.history.archive({
        ...period,
        orders,
        savedBy: 'painel-cozinha'
    });
}

// Arquivar e limpar histórico na cozinha
if (els.kitchenClearHistoryBtn) {
    els.kitchenClearHistoryBtn.onclick = async () => {
        const entreguesList = Object.values(globalOrders).filter(o => o.items.every(i => i.status === 'entregue') || o.deliveredAt);
        if (entreguesList.length === 0) {
            alert("Não há pedidos entregues para salvar.");
            return;
        }
        const period = getOperationPeriod();
        if (confirm(`Salvar ${entreguesList.length} pedidos no histórico de ${period.day}, ${period.date.split('-').reverse().join('/')}, limpar a aba Entregues e reiniciar as senhas?`)) {
            const originalText = els.kitchenClearHistoryBtn.textContent;
            els.kitchenClearHistoryBtn.disabled = true;
            els.kitchenClearHistoryBtn.textContent = 'Salvando histórico...';
            try {
                await archiveDeliveredOrders(entreguesList);
                const clearedAt = Date.now();
                await CanelaSupabase.state.save('password_sequence', { value: 0, date: period.date, resetAt: clearedAt });
                const clearedMarkers = Object.fromEntries(entreguesList.map(order => [order.id, clearedAt]));
                applyDeletedOrderMarkers(clearedMarkers);
                applyHistoryClear(clearedAt);
                publishUpdate({ type: 'CLEAR_HISTORY', clearedAt, deletedOrderIds: clearedMarkers }, false);
                publishUpdate({ type: 'RESET_PASSWORDS', date: period.date, resetAt: clearedAt }, false);
                renderAll();
                alert(`Histórico salvo em ${period.day}, ${period.date.split('-').reverse().join('/')}. A aba Entregues foi limpa e a sequência voltou para 000.`);
            } catch (error) {
                console.error('Falha ao salvar histórico:', error);
                alert('O histórico não foi limpo porque não foi possível confirmá-lo no banco. Verifique a conexão e tente novamente.');
            } finally {
                els.kitchenClearHistoryBtn.disabled = false;
                els.kitchenClearHistoryBtn.textContent = originalText;
            }
        }
    };
}

if (els.resetPasswordsBtn) {
    els.resetPasswordsBtn.onclick = async () => {
        if (!confirm('Reiniciar a sequência? O próximo pedido enviado receberá a senha #001.')) return;
        const date = new Date().toLocaleDateString('en-CA');
        const resetAt = Date.now();
        try {
            await CanelaSupabase.state.save('password_sequence', { value: 0, date, resetAt });
            publishUpdate({ type: 'RESET_PASSWORDS', date, resetAt }, false);
            alert('Sequência reiniciada. O próximo pedido receberá a senha #001.');
        } catch (error) {
            alert('Não foi possível confirmar o reinício no banco. Tente novamente.');
        }
    };
}

function updateKitchenCounters() {
    const counts = { pratosFila: 0 };
    let countPedidosAtivos = 0;
    let countProntos = 0;
    let countEntregues = 0;
    let countChapeiro = 0;
    let countFritadeira = 0;

    Object.values(globalOrders).forEach(pedido => {
        const items = pedido.items || [];
        const hasOperationalItem = items.some(item => (item.status || 'fila') === 'fila');
        if (hasOperationalItem) countPedidosAtivos++;
        if (items.some(i => (i.status || 'fila') === 'fila')) counts.pratosFila++;
        if (items.some(i => i.status === 'pronto')) countProntos++;
        const isEntregue = pedido.items.every(i => i.status === 'entregue') || pedido.deliveredAt;
        if (isEntregue) countEntregues++;
        if (items.some(i => (i.status || 'fila') === 'fila' && isChapaItem(i))) countChapeiro++;
        if (items.some(i => (i.status || 'fila') === 'fila' && isFryerItem(i))) countFritadeira++;
    });

    Object.entries(counts).forEach(([key, value]) => { if (els[`count${key[0].toUpperCase()}${key.slice(1)}`]) els[`count${key[0].toUpperCase()}${key.slice(1)}`].textContent = value; });
    if (els.countPratosTotal) els.countPratosTotal.textContent = countPedidosAtivos;
    if (els.countProntos) els.countProntos.textContent = countProntos;
    if (els.countEntregues) els.countEntregues.textContent = countEntregues;
    if (els.countChapeiro) els.countChapeiro.textContent = countChapeiro;
    if (els.countFritadeira) els.countFritadeira.textContent = countFritadeira;
    if (els.kitchenTotalEntreguesVal) els.kitchenTotalEntreguesVal.textContent = countEntregues;
    const deliveredOrders = Object.values(globalOrders).filter(order => isFullyDelivered(order));
    const today = new Date().toLocaleDateString('en-CA');
    const deliveredToday = deliveredOrders.filter(order => order.deliveredAt && new Date(order.deliveredAt).toLocaleDateString('en-CA') === today);
    const deliveredUnits = deliveredOrders.reduce((sum, order) => sum + (order.items || []).reduce((itemSum, item) => itemSum + (Number(item.qty) || 1), 0), 0);
    const waitSamples = deliveredToday.map(order => Math.max(0, Number(order.deliveredAt) - getOrderQueueTime(order))).filter(Number.isFinite);
    const averageMinutes = waitSamples.length ? Math.round(waitSamples.reduce((sum, value) => sum + value, 0) / waitSamples.length / 60000) : 0;
    const todayEl = document.getElementById('delivered-today-val');
    const itemsEl = document.getElementById('delivered-items-val');
    const averageEl = document.getElementById('delivered-average-val');
    if (todayEl) todayEl.textContent = deliveredToday.length;
    if (itemsEl) itemsEl.textContent = deliveredUnits;
    if (averageEl) averageEl.textContent = `${averageMinutes} min`;
    const plateTotals = { carne: 0, picanha: 0, misto: 0, frango: 0, tambaqui: 0 };
    const riceTotals = { carne: new Map(), picanha: new Map(), misto: new Map(), frango: new Map(), tambaqui: new Map() };
    const brothTotals = new Map(['Carne', 'Quenga', 'Camarão', 'Frango'].map(name => [name, { withAcc: 0, withoutAcc: 0 }]));
    deliveredOrders.forEach(order => (order.items || []).forEach(item => {
        const rawName = item.product && item.product.name || '';
        const qty = Number(item.qty) || 1;
        const normalized = rawName.toLowerCase();
        const plateType = normalized.includes('carne de sol na chapa') ? 'carne'
            : normalized.includes('picanha na chapa') ? 'picanha'
                : normalized.includes('misto na chapa') ? 'misto'
                    : normalized.includes('filé de frango frito') ? 'frango'
                        : normalized.includes('filé de tambaqui frito') ? 'tambaqui' : null;
        if (plateType) {
            plateTotals[plateType] += qty;
            const riceMatch = rawName.match(/\+\s*(.+?)\s*\[(?:TIRAR:|COMPLETO)/i);
            const riceName = riceMatch ? riceMatch[1].trim().replace(/^Baião$/i, 'Baião de Dois') : 'Não informado';
            riceTotals[plateType].set(riceName, (riceTotals[plateType].get(riceName) || 0) + qty);
            return;
        }
        const brothMatch = rawName.match(/^Caldo\s+(.+?)\s+(?:350ml|500ml)\s*\(([^)]*)\)/i);
        if (brothMatch) {
            const brothName = brothMatch[1].trim();
            const totals = brothTotals.get(brothName) || { withAcc: 0, withoutAcc: 0 };
            const withoutAcc = /^\s*Sem\s+Acomp/i.test(brothMatch[2]);
            if (withoutAcc) totals.withoutAcc += qty;
            else totals.withAcc += qty;
            brothTotals.set(brothName, totals);
        }
    }));
    const metricsEl = document.getElementById('delivered-item-metrics');
    const riceRows = (type) => [...riceTotals[type].entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([rice, qty]) => `<span><em>${escapeKitchenHtml(rice)}</em><b>${qty}</b></span>`).join('') || '<span><em>Sem registros</em><b>0</b></span>';
    const brothOrder = ['Carne', 'Quenga', 'Camarão', 'Frango'];
    const brothRows = brothOrder.map(name => [name, brothTotals.get(name) || { withAcc: 0, withoutAcc: 0 }]);
    if (metricsEl) metricsEl.innerHTML = `
        <div class="delivered-item-card delivered-item-group"><div><span>Carne de Sol na Chapa</span><strong>${plateTotals.carne}</strong></div><small>Arroz por tipo</small>${riceRows('carne')}</div>
        <div class="delivered-item-card delivered-item-group"><div><span>Picanha na Chapa</span><strong>${plateTotals.picanha}</strong></div><small>Arroz por tipo</small>${riceRows('picanha')}</div>
        <div class="delivered-item-card delivered-item-group"><div><span>Misto na Chapa</span><strong>${plateTotals.misto}</strong></div><small>Arroz por tipo</small>${riceRows('misto')}</div>
        <div class="delivered-item-card delivered-item-group"><div><span>Filé de Frango Frito</span><strong>${plateTotals.frango}</strong></div><small>Arroz por tipo</small>${riceRows('frango')}</div>
        <div class="delivered-item-card delivered-item-group"><div><span>Filé de Tambaqui Frito</span><strong>${plateTotals.tambaqui}</strong></div><small>Arroz por tipo</small>${riceRows('tambaqui')}</div>
        ${brothRows.map(([name, totals]) => `<div class="delivered-item-card delivered-item-group"><div><span>Caldo de ${escapeKitchenHtml(name)}</span><strong>${totals.withAcc + totals.withoutAcc}</strong></div><small>Acompanhamento</small><span><em>Com acompanhamento</em><b>${totals.withAcc}</b></span><span><em>Sem acompanhamento</em><b>${totals.withoutAcc}</b></span></div>`).join('')}
    `;
    renderTimeIntelligence(deliveredOrders);
}

function renderTimeIntelligence(deliveredOrders) {
    const target = document.getElementById('time-intelligence-metrics');
    if (!target) return;
    const groups = [
        { label: 'Carne na Chapa', matches: item => isChapaItem(item) && !(item.product && item.product.name || '').includes('Picanha'), configured: prepTimeSettings.baseCarne },
        { label: 'Picanha na Chapa', matches: item => (item.product && item.product.name || '').includes('Picanha'), configured: prepTimeSettings.basePicanha },
        { label: 'Caldos', matches: isCaldoItem, configured: prepTimeSettings.baseCaldo }
    ];
    const cards = groups.map(group => {
        const samples = deliveredOrders
            .filter(order => (order.items || []).some(group.matches) && Number(order.deliveredAt) > 0)
            .map(order => Math.max(0, (Number(order.deliveredAt) - getOrderQueueTime(order)) / 60000))
            .filter(value => Number.isFinite(value) && value < 24 * 60)
            .sort((a, b) => a - b);
        const average = samples.length ? Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length) : 0;
        const median = samples.length ? Math.round(samples[Math.floor((samples.length - 1) / 2)]) : 0;
        const p90 = samples.length ? Math.round(samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.9) - 1)]) : 0;
        return `<div class="time-intelligence-card"><strong>${group.label}</strong><span>Amostras <b>${samples.length}</b></span><span>Espera média real <b>${average} min</b></span><span>Mediana <b>${median} min</b></span><span>90% entregues em até <b>${p90} min</b></span><span>Base configurada <b>${group.configured} min</b></span><small>Referência para ajuste manual: mediana real de ${median} min.</small></div>`;
    });
    const deliveredTime = order => {
        const itemTimes = (order.items || []).map(item => Number(item.deliveredAt || 0)).filter(value => value > 0);
        return Number(order.deliveredAt || 0) || (itemTimes.length ? Math.max(...itemTimes) : 0);
    };
    const plateItemType = item => {
        const name = item && item.product && item.product.name || '';
        if (name.includes('Picanha')) return 'picanha';
        if (isChapaItem(item)) return 'carne';
        return null;
    };
    const incrementGroups = [
        { key: 'carne', label: 'Carne à frente', configured: prepTimeSettings.incrementCarne },
        { key: 'picanha', label: 'Picanha à frente', configured: prepTimeSettings.incrementPicanha },
        { key: 'caldo', label: 'Caldo à frente', configured: prepTimeSettings.incrementCaldo }
    ];
    const orderedDelivered = [...deliveredOrders].filter(order => deliveredTime(order) > 0).sort((a, b) => getOrderQueueTime(a) - getOrderQueueTime(b));
    const incrementCards = incrementGroups.map(group => {
        const samples = [];
        orderedDelivered.forEach(targetOrder => {
            const targetItems = targetOrder.items || [];
            const targetIsPlate = targetItems.some(isChapaItem);
            const targetIsBroth = targetItems.some(isCaldoItem);
            if (group.key === 'caldo' ? !targetIsBroth : !targetIsPlate) return;
            const targetStart = getOrderQueueTime(targetOrder);
            const targetEnd = deliveredTime(targetOrder);
            if (!(targetEnd > targetStart)) return;
            let aheadCarne = 0;
            let aheadPicanha = 0;
            let aheadCaldo = 0;
            orderedDelivered.forEach(aheadOrder => {
                if (aheadOrder === targetOrder) return;
                const aheadStart = getOrderQueueTime(aheadOrder);
                const aheadEnd = deliveredTime(aheadOrder);
                if (aheadStart > targetStart || aheadEnd <= targetStart) return;
                (aheadOrder.items || []).forEach(item => {
                    const qty = Math.max(1, Number(item.qty) || 1);
                    const plateType = plateItemType(item);
                    if (plateType === 'carne') aheadCarne += qty;
                    else if (plateType === 'picanha') aheadPicanha += qty;
                    else if (isCaldoItem(item)) aheadCaldo += qty;
                });
            });
            let unitsAhead = group.key === 'carne' ? aheadCarne : group.key === 'picanha' ? aheadPicanha : aheadCaldo;
            if (!unitsAhead) return;
            if (group.key === 'carne' && aheadPicanha > 0) return;
            if (group.key === 'picanha' && aheadCarne > 0) return;
            const targetBase = targetItems.reduce((max, item) => {
                const type = plateItemType(item);
                if (type === 'picanha') return Math.max(max, prepTimeSettings.basePicanha);
                if (type === 'carne') return Math.max(max, prepTimeSettings.baseCarne);
                if (isCaldoItem(item)) return Math.max(max, prepTimeSettings.baseCaldo);
                return max;
            }, 0);
            const waitMinutes = (targetEnd - targetStart) / 60000;
            const observed = Math.max(0, (waitMinutes - targetBase) / unitsAhead);
            if (Number.isFinite(observed) && observed <= 120) samples.push(observed);
        });
        samples.sort((a, b) => a - b);
        const observed = samples.length ? Math.round(samples[Math.floor((samples.length - 1) / 2)] * 10) / 10 : null;
        const tolerance = Math.max(1, group.configured * 0.25);
        const status = observed === null
            ? { css: 'insufficient', label: 'Amostras insuficientes', detail: 'Aguarde entregas com itens sobrepostos na fila.' }
            : Math.abs(observed - group.configured) <= tolerance
                ? { css: 'coherent', label: 'Coerente', detail: 'O valor configurado acompanha a mediana observada.' }
                : observed > group.configured
                    ? { css: 'under', label: 'Abaixo do observado', detail: 'O acréscimo real está maior que o configurado.' }
                    : { css: 'over', label: 'Acima do observado', detail: 'O acréscimo configurado está maior que o observado.' };
        return `<div class="increment-intelligence-card ${status.css}"><strong>${group.label}</strong><span>Configurado <b>${group.configured} min</b></span><span>Observado por item <b>${observed === null ? '—' : `${observed} min`}</b></span><span>Amostras válidas <b>${samples.length}</b></span><mark>${status.label}</mark><small>${status.detail}</small></div>`;
    });
    target.innerHTML = `<h3>📊 Inteligência de tempos de espera</h3><p>Baseada no intervalo real entre envio e entrega dos pedidos do histórico.</p><div>${cards.join('')}</div><section class="increment-intelligence"><h3>🧭 Coerência dos acréscimos</h3><p>Compara cada acréscimo configurado com a mediana reconstruída de pedidos que estavam simultaneamente na fila. A análise é apenas uma recomendação manual.</p><div>${incrementCards.join('')}</div></section>`;
}

function isChapaItem(item) {
    const name = item && item.product && item.product.name ? item.product.name.toLowerCase() : '';
    return name.includes('carne de sol na chapa') || name.includes('picanha na chapa') || name.includes('misto na chapa');
}

function isCaldoItem(item) {
    const name = item && item.product && item.product.name ? item.product.name.toLowerCase() : '';
    return name.startsWith('caldo ');
}

function isFryerItem(item) {
    const name = item && item.product && item.product.name ? item.product.name.toLowerCase() : '';
    return name.includes('filé de frango frito') || name.includes('filé de tambaqui frito');
}

function renderQueueMetrics() {
    if (!els.queueMetrics) return;
    if (currentTab === 'entregues') { els.queueMetrics.innerHTML = ''; return; }
    const lane = currentTab === 'pratos' || currentTab.startsWith('pratos-') ? 'todos' : currentTab === 'chapeiro' ? 'pratos' : currentTab === 'fritadeira' ? 'fritadeira' : null;
    const stage = currentTab === 'prontos' || currentTab.endsWith('-pronto') ? 'pronto' : null;
    const totals = new Map();
    const chapeiroTotals = { carne: 0, misto: 0, picanha: 0 };
    const fryerTotals = { frango: 0, tambaqui: 0 };
    let pendingUnits = 0;
    let pendingOrders = 0;
    let oldestQueueTime = null;
    Object.values(globalOrders).forEach(order => {
        let orderHasPending = false;
        (order.items || []).forEach(item => {
            const itemStatus = item.status || 'fila';
            if (['chapeiro', 'fritadeira'].includes(currentTab) ? itemStatus !== 'fila' : stage && itemStatus !== stage) return;
            if (!stage && !['chapeiro', 'fritadeira'].includes(currentTab) && !['fila', 'pronto'].includes(itemStatus)) return;
            if (lane === 'pratos' && !isChapaItem(item)) return;
            if (lane === 'fritadeira' && !isFryerItem(item)) return;
            orderHasPending = true;
            pendingUnits += Number(item.qty) || 1;
            const queuedAt = getOrderQueueTime(order);
            if (queuedAt > 0 && (oldestQueueTime === null || queuedAt < oldestQueueTime)) oldestQueueTime = queuedAt;
            const fullName = item.product && item.product.name ? item.product.name : 'Item sem nome';
            if (currentTab === 'chapeiro') {
                const normalizedName = fullName.toLowerCase();
                const chapaKey = normalizedName.includes('picanha') ? 'picanha' : normalizedName.includes('misto') ? 'misto' : 'carne';
                chapeiroTotals[chapaKey] += Number(item.qty) || 1;
            }
            if (currentTab === 'fritadeira') {
                const fryerKey = fullName.toLowerCase().includes('tambaqui') ? 'tambaqui' : 'frango';
                fryerTotals[fryerKey] += Number(item.qty) || 1;
            }
            const baseName = fullName.split(' + ')[0].split(' (')[0].split(' - ')[0];
            totals.set(baseName, (totals.get(baseName) || 0) + (Number(item.qty) || 1));
        });
        if (orderHasPending) pendingOrders++;
    });
    const entries = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    if (currentTab === 'chapeiro') {
        els.queueMetrics.innerHTML = `
            <div class="queue-metric-card"><span>Carnes na Chapa</span><strong>${chapeiroTotals.carne}</strong></div>
            <div class="queue-metric-card"><span>Mistos na Chapa</span><strong>${chapeiroTotals.misto}</strong></div>
            <div class="queue-metric-card"><span>Picanhas na Chapa</span><strong>${chapeiroTotals.picanha}</strong></div>
        `;
        return;
    }
    if (currentTab === 'fritadeira') {
        els.queueMetrics.innerHTML = `
            <div class="queue-metric-card"><span>Filés de Frango</span><strong>${fryerTotals.frango}</strong></div>
            <div class="queue-metric-card"><span>Filés de Tambaqui</span><strong>${fryerTotals.tambaqui}</strong></div>
        `;
        return;
    }
    const oldestMinutes = oldestQueueTime === null ? 0 : Math.max(0, Math.floor((Date.now() - oldestQueueTime) / 60000));
    const summary = `<div class="queue-metric-card queue-metric-summary"><span>Pedidos no painel</span><strong>${pendingOrders}</strong></div>
        <div class="queue-metric-card queue-metric-summary"><span>Unidades no painel</span><strong>${pendingUnits}</strong></div>
        <div class="queue-metric-card queue-metric-summary"><span>Maior espera</span><strong>${oldestMinutes} min</strong></div>
    `;
    const products = entries.length
        ? entries.map(([name, qty]) => `<div class="queue-metric-card"><span>${name}</span><strong>${qty}</strong></div>`).join('')
        : '';
    els.queueMetrics.innerHTML = summary + products;
}

function getOrderQueueTime(pedido) {
    const itemQueueTimes = (pedido.items || []).map(item => Number(item.queuedAt || 0));
    const validStarts = [Number(pedido.startedAt || 0), Number(pedido.timestamp || 0), ...itemQueueTimes]
        .filter(value => Number.isFinite(value) && value > 0);
    const fixedStart = validStarts.length ? Math.min(...validStarts) : Date.now();
    if (!(Number(pedido.startedAt) > 0)) pedido.startedAt = fixedStart;
    return Math.min(fixedStart, Date.now());
}

function getPriorityRank(order) {
    if (order.priority === 'idoso80') return 3;
    if (['idoso60', 'gestante', 'pcd', 'autista', 'colo'].includes(order.priority)) return 2;
    return 0;
}

function getOrderQueuePosition(targetOrder) {
    const operationalQueue = Object.values(globalOrders)
        .filter(order => (order.items || []).some(item => (item.status || 'fila') === 'fila'))
        .sort((a, b) => getPriorityRank(b) - getPriorityRank(a) || getOrderQueueTime(a) - getOrderQueueTime(b));
    const index = operationalQueue.findIndex(order => order.id === targetOrder.id);
    return index >= 0 ? index + 1 : null;
}

function getEstimatedPrepMinutes(targetOrder) {
    const pending = Object.values(globalOrders)
        .filter(order => (order.items || []).some(item => (item.status || 'fila') === 'fila'))
        .sort((a, b) => getPriorityRank(b) - getPriorityRank(a) || getOrderQueueTime(a) - getOrderQueueTime(b));
    const targetIndex = Math.max(0, pending.findIndex(order => order.id === targetOrder.id));
    const ahead = pending.slice(0, targetIndex);
    const targetItems = (targetOrder.items || []).filter(item => (item.status || 'fila') === 'fila');
    const hasCarne = targetItems.some(item => isChapaItem(item));
    const hasCaldo = targetItems.some(item => isCaldoItem(item));
    let plateMinutes = targetItems.reduce((max, item) => {
        const name = item.product && item.product.name || '';
        if (name.includes('Picanha')) return Math.max(max, prepTimeSettings.basePicanha);
        if (isChapaItem(item)) return Math.max(max, prepTimeSettings.baseCarne);
        return max;
    }, 0);
    let brothMinutes = hasCaldo ? prepTimeSettings.baseCaldo : 0;
    ahead.forEach(order => (order.items || []).forEach(item => {
        if ((item.status || 'fila') !== 'fila') return;
        const qty = Number(item.qty) || 1;
        const name = item.product && item.product.name || '';
        if (hasCarne && isChapaItem(item)) plateMinutes += qty * (name.includes('Picanha') ? prepTimeSettings.incrementPicanha : prepTimeSettings.incrementCarne);
        if (hasCaldo && isCaldoItem(item)) brothMinutes += qty * prepTimeSettings.incrementCaldo;
    }));
    return Math.max(plateMinutes, brothMinutes, 1);
}

function ensureOrderTimingMetadata(order) {
    let changed = false;
    const hadFixedStart = Number(order.startedAt) > 0;
    const queueStartedAt = getOrderQueueTime(order);
    if (!hadFixedStart) {
        order.startedAt = queueStartedAt;
        changed = true;
    }
    if (!(Number(order.estimatedReadyAt) > 0)) {
        const estimateMinutes = getEstimatedPrepMinutes(order);
        order.estimatedPrepMinutesAtEntry = estimateMinutes;
        order.estimatedReadyAt = queueStartedAt + estimateMinutes * 60000;
        changed = true;
    }
    return changed;
}

function formatCountdown(milliseconds) {
    const overdue = milliseconds < 0;
    const totalSeconds = Math.max(0, Math.floor(Math.abs(milliseconds) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const clock = `${hours > 0 ? String(hours).padStart(2, '0') + ':' : ''}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return overdue ? `Atrasado ${clock}` : clock;
}

function formatElapsed(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const totalMinutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(totalMinutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function setupPrepSettings() {
    const fieldMap = {
        baseCarne: 'base-carne-time', basePicanha: 'base-picanha-time', baseCaldo: 'base-caldo-time',
        incrementCarne: 'increment-carne-time', incrementPicanha: 'increment-picanha-time', incrementCaldo: 'increment-caldo-time'
    };
    const close = () => els.prepSettingsOverlay.classList.add('hidden');
    els.prepSettingsBtn.onclick = () => {
        Object.entries(fieldMap).forEach(([key, id]) => document.getElementById(id).value = prepTimeSettings[key]);
        els.prepSettingsOverlay.classList.remove('hidden');
    };
    els.closePrepSettingsBtn.onclick = close;
    els.prepSettingsOverlay.addEventListener('click', event => { if (event.target === els.prepSettingsOverlay) close(); });
    els.savePrepSettingsBtn.onclick = () => {
        const settings = {};
        Object.entries(fieldMap).forEach(([key, id]) => settings[key] = Math.max(key.startsWith('base') ? 1 : 0, Number(document.getElementById(id).value) || 0));
        settings.updatedAt = Date.now();
        savePrepTimeSettings(settings, true);
        close();
    };
}

function setupProductPriceSettings() {
    if (!els.productPricesBtn) return;
    const close = () => els.productPricesOverlay.classList.add('hidden');
    const renderFields = () => {
        els.productPricesList.innerHTML = Object.entries(PRODUCT_PRICE_GROUPS).map(([group, products]) => `
            <section class="product-price-group">
                <h3>${escapeKitchenHtml(group)}</h3>
                ${Object.entries(products).map(([name, defaultPrice]) => `
                    <label><span>${escapeKitchenHtml(name)}</span><div class="price-input-wrap"><span>R$</span><input type="number" min="0" step="0.50" data-product-name="${escapeKitchenHtml(name)}" value="${Number(productPriceSettings.items[name] ?? defaultPrice).toFixed(2)}"></div></label>
                `).join('')}
            </section>
        `).join('');
    };
    els.productPricesBtn.onclick = () => { renderFields(); els.productPricesOverlay.classList.remove('hidden'); };
    els.closeProductPricesBtn.onclick = close;
    els.productPricesOverlay.addEventListener('click', event => { if (event.target === els.productPricesOverlay) close(); });
    els.saveProductPricesBtn.onclick = () => {
        const items = { ...PRODUCT_PRICE_DEFAULTS };
        els.productPricesList.querySelectorAll('input[data-product-name]').forEach(input => {
            items[input.dataset.productName] = Math.max(0, Number(input.value) || 0);
        });
        saveProductPriceSettings({ items, updatedAt: Date.now() }, true);
        close();
    };
}

function renderAll() {
    let timingWasNormalized = false;
    Object.values(globalOrders).forEach(order => {
        if (ensureOrderTimingMetadata(order)) timingWasNormalized = true;
    });
    if (timingWasNormalized) saveStoredOrders();
    updateKitchenCounters();
    renderQueueMetrics();

    const containers = [els.pratosFilaContainer, els.prontosContainer,
        els.entreguesContainer, els.chapeiroContainer, els.fritadeiraContainer];
    containers.forEach(container => { if (container) container.innerHTML = ''; });

    const query = kitchenSearchQuery;
    const sortedOrders = Object.values(globalOrders).sort((a, b) => getPriorityRank(b) - getPriorityRank(a) || getOrderQueueTime(a) - getOrderQueueTime(b));

    sortedOrders.forEach(pedido => {
        // Busca
        if (query) {
            const sMatch = (pedido.senha || '').toLowerCase().includes(query);
            const cMatch = (pedido.clientName || '').toLowerCase().includes(query);
            const fMatch = (pedido.feature || '').toLowerCase().includes(query);
            const wMatch = (pedido.waiterName || '').toLowerCase().includes(query);
            const itemMatch = pedido.items.some(i => (i.product && i.product.name ? i.product.name.toLowerCase().includes(query) : false));
            if (!sMatch && !cMatch && !fMatch && !wMatch && !itemMatch) return;
        }

        const pratosFila = [], pratosPronto = [];
        const entregueItems = [];
        const chapaItems = [];
        const fryerItems = [];
        pedido.items.forEach(item => {
            const st = item.status || 'fila';
            if (st === 'fila') pratosFila.push(item);
            if (st === 'pronto') pratosPronto.push(item);
            if (isChapaItem(item)) {
                if (st === 'fila') chapaItems.push(item);
            }
            if (isFryerItem(item) && st === 'fila') fryerItems.push(item);
            if (st === 'entregue') entregueItems.push(item);
        });

        if (pratosFila.length) renderCard(pedido, pratosFila, 'pratos-fila', els.pratosFilaContainer);
        if (pratosPronto.length) renderCard(pedido, pratosPronto, 'prontos', els.prontosContainer);
        if (entregueItems.length > 0 || pedido.deliveredAt) renderCard(pedido, entregueItems.length > 0 ? entregueItems : pedido.items, 'entregues', els.entreguesContainer);
        if (chapaItems.length > 0) renderCard(pedido, chapaItems, 'chapeiro', els.chapeiroContainer);
        if (fryerItems.length > 0) renderCard(pedido, fryerItems, 'fritadeira', els.fritadeiraContainer);
    });

    const visibleContainers = currentTab === 'pratos'
        ? [els.pratosFilaContainer]
        : currentTab === 'prontos' ? [els.prontosContainer]
        : currentTab === 'chapeiro' ? [els.chapeiroContainer] : currentTab === 'fritadeira' ? [els.fritadeiraContainer] : [els.entreguesContainer];
    els.emptyState.classList.toggle('hidden', visibleContainers.some(container => container && container.children.length > 0));
}

function escapeKitchenHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
}

function getKitchenOrderTotal(order) {
    const calculated = (order && order.items || []).reduce((sum, item) => {
        return sum + (Number(item.product && item.product.price) || 0) * (Number(item.qty) || 1);
    }, 0);
    return calculated || Number(order && order.total) || 0;
}

function applyItemStatusMetadata(item, status, changedAt = Date.now()) {
    item.status = status;
    if (status === 'fila') {
        delete item.preparationStartedAt;
        delete item.readyAt;
        delete item.deliveredAt;
    } else if (status === 'pronto') {
        item.preparationStartedAt ||= changedAt;
        item.readyAt = changedAt;
        delete item.deliveredAt;
    } else if (status === 'entregue') {
        item.deliveredAt = changedAt;
    }
}

function refreshOrderDeliveryMarker(order, changedAt = Date.now()) {
    const fullyDelivered = (order.items || []).length > 0 && order.items.every(item => item.status === 'entregue');
    if (fullyDelivered) order.deliveredAt ||= changedAt;
    else delete order.deliveredAt;
}

function setOrderStatusOverride(order, item, status, changedAt) {
    if (!item.id) return;
    order.statusOverrides ||= {};
    order.statusOverrides[item.id] = { status, updatedAt: changedAt };
}

function updateOrderItemsStatus(order, items, status) {
    const changedAt = Date.now();
    items.forEach(item => {
        applyItemStatusMetadata(item, status, changedAt);
        setOrderStatusOverride(order, item, status, changedAt);
    });
    refreshOrderDeliveryMarker(order, changedAt);
    order.updatedAt = changedAt;
    globalOrders[order.id] = order;
    saveStoredOrders();
    reconcileDeliveredBeverages();
    publishUpdate({ type: 'ORDER_UPDATE', order }, false);
    renderAll();
}

function openEditOrder(pedido) {
    editingOrderId = pedido.id;
    els.editOrderPassword.textContent = `#${pedido.senha || '—'}`;
    els.editOrderClient.value = pedido.clientName || '';
    els.editOrderFeature.value = pedido.feature || '';
    els.editOrderPriority.value = pedido.priority || 'normal';
    els.editOrderStatus.value = 'preservar';
    els.editOrderObs.value = pedido.obs || '';
    els.editOrderItems.innerHTML = (pedido.items || []).map((item, index) => `
        <div class="edit-order-item" data-index="${index}">
            <div class="edit-order-item-name">${escapeKitchenHtml(item.product && item.product.name || 'Item')}</div>
            <label>Qtd.<input class="edit-item-qty" type="number" min="1" step="1" value="${Math.max(1, Number(item.qty) || 1)}"></label>
            <label>Local<select class="edit-item-consumption">
                <option value="local" ${item.consumption !== 'levar' ? 'selected' : ''}>Comer no local</option>
                <option value="levar" ${item.consumption === 'levar' ? 'selected' : ''}>Para levar</option>
            </select></label>
            <label>Estado<select class="edit-item-status">
                <option value="fila" ${(item.status || 'fila') === 'fila' ? 'selected' : ''}>Na fila</option>
                <option value="pronto" ${item.status === 'pronto' ? 'selected' : ''}>Pronto</option>
                <option value="entregue" ${item.status === 'entregue' ? 'selected' : ''}>Entregue</option>
            </select></label>
            <label class="edit-order-remove"><input class="edit-item-remove" type="checkbox"> Excluir</label>
        </div>
    `).join('');
    els.editOrderOverlay.classList.remove('hidden');
}

function closeEditOrder() {
    editingOrderId = null;
    els.editOrderOverlay.classList.add('hidden');
}

function markOrderDelivered(pedido) {
    updateOrderItemsStatus(pedido, pedido.items || [], 'entregue');
}

if (els.closeEditOrderBtn) els.closeEditOrderBtn.onclick = closeEditOrder;
function openFullOrderEditor(pedido) {
    if (!pedido || !pedido.id) return;
    let atendimentoOrders = {};
    try { atendimentoOrders = JSON.parse(localStorage.getItem('canela_atendimento_orders')) || {}; } catch (error) { atendimentoOrders = {}; }
    atendimentoOrders[pedido.id] = pedido;
    localStorage.setItem('canela_atendimento_orders', JSON.stringify(atendimentoOrders));
    localStorage.setItem('canela_open_order_id', pedido.id);
    document.body.classList.add('page-leaving');
    setTimeout(() => { window.location.href = 'index.html?editar=' + encodeURIComponent(pedido.id); }, 140);
}
if (els.openFullOrderEditorBtn) {
    els.openFullOrderEditorBtn.onclick = () => {
        const pedido = globalOrders[editingOrderId];
        openFullOrderEditor(pedido);
    };
}
if (els.editOrderOverlay) {
    els.editOrderOverlay.addEventListener('click', event => {
        if (event.target === els.editOrderOverlay) closeEditOrder();
    });
}
if (els.saveEditOrderBtn) {
    els.saveEditOrderBtn.onclick = () => {
        const pedido = globalOrders[editingOrderId];
        if (!pedido) return closeEditOrder();
        const rows = [...els.editOrderItems.querySelectorAll('.edit-order-item')];
        const removedIds = new Set(pedido.removedItemIds || []);
        const updatedItems = [];
        const itemChangedAt = Date.now();
        rows.forEach((row, index) => {
            const item = pedido.items[index];
            if (!item) return;
            if (row.querySelector('.edit-item-remove').checked) {
                if (item.id) removedIds.add(item.id);
                return;
            }
            item.qty = Math.max(1, Number(row.querySelector('.edit-item-qty').value) || 1);
            item.consumption = row.querySelector('.edit-item-consumption').value;
            const itemStatus = row.querySelector('.edit-item-status').value;
            applyItemStatusMetadata(item, itemStatus, itemChangedAt);
            setOrderStatusOverride(pedido, item, itemStatus, itemChangedAt);
            updatedItems.push(item);
        });
        if (updatedItems.length === 0) {
            alert('O pedido precisa manter pelo menos um item.');
            return;
        }
        pedido.clientName = els.editOrderClient.value.trim() || pedido.clientName || 'Cliente';
        pedido.feature = els.editOrderFeature.value.trim();
        pedido.priority = els.editOrderPriority.value || 'normal';
        const requestedStatus = els.editOrderStatus.value;
        if (requestedStatus !== 'preservar') {
            const statusChangedAt = Date.now();
            updatedItems.forEach(item => {
                applyItemStatusMetadata(item, requestedStatus, statusChangedAt);
                setOrderStatusOverride(pedido, item, requestedStatus, statusChangedAt);
                if (requestedStatus === 'fila' && !item.queuedAt) item.queuedAt = getOrderQueueTime(pedido);
            });
        }
        pedido.obs = els.editOrderObs.value.trim();
        pedido.items = updatedItems;
        refreshOrderDeliveryMarker(pedido);
        pedido.removedItemIds = [...removedIds];
        pedido.updatedAt = Date.now();
        globalOrders[pedido.id] = pedido;
        saveStoredOrders();
        reconcileDeliveredBeverages();
        publishUpdate({ type: 'ORDER_UPDATE', order: pedido }, false);
        closeEditOrder();
        renderAll();
    };
}

function renderCard(pedido, itemsArr, tabType, containerTarget) {
    const card = document.createElement('div');
    card.className = `order-card ${tabType.endsWith('-fila') ? 'novinho' : ''}`;
    const isOperational = tabType.startsWith('pratos-') || tabType === 'prontos' || tabType === 'chapeiro';
    const isQueue = tabType.endsWith('-fila');
    const isReady = tabType === 'prontos' || tabType.endsWith('-pronto');
    if (tabType === 'entregues') {
        card.style.borderColor = "#27ae60";
        card.style.opacity = "0.85";
    }

    let itemsHTML = '';
    itemsArr.forEach(item => {
        item.id ||= `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        itemsHTML += renderKitchenItem(item, false);
    });

    const obsHTML = pedido.obs && pedido.obs.trim() !== ''
        ? `<div style="background: #fff9e6; color: #6a1215; padding: 0.8rem; margin: 0 1rem 1rem 1rem; border-radius: 8px; font-weight: bold; border-left: 5px solid #ffbb00; line-height: 1.3;">📋 Obs: ${pedido.obs}</div>`
        : '';
    const featureHTML = pedido.feature && pedido.feature.trim() !== ''
        ? `<div style="color: #ccc; margin: 0 1rem 0.5rem 1rem; font-style: italic;">📍 ${pedido.feature}</div>`
        : '';

    const dataHoraStr = pedido.timestamp ? new Date(pedido.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--';
    const entregueHoraStr = pedido.deliveredAt ? new Date(pedido.deliveredAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null;
    const priorityLabels = { idoso60: '👴 Idoso 60+', idoso80: '⭐ Idoso 80+', gestante: '🤰 Gestante', pcd: '♿ PCD', autista: '♾️ Autista', colo: '👶 Criança de colo' };
    const priorityBadge = pedido.priority && pedido.priority !== 'normal'
        ? `<span class="kitchen-priority-badge">${priorityLabels[pedido.priority] || 'Prioridade'}</span>` : '';

    let timerHTML = '';
    const queuePosition = isQueue ? getOrderQueuePosition(pedido) : null;
    const queuePositionHTML = queuePosition
        ? `<span class="queue-position-badge" title="Posição operacional considerando prioridade e horário">Fila: ${queuePosition}º</span>`
        : '';
    if (isOperational) {
        const queueStartedAt = getOrderQueueTime(pedido);
        const estimatedDeadline = Number(pedido.estimatedReadyAt) || queueStartedAt + getEstimatedPrepMinutes(pedido) * 60000;
        timerHTML = `<div class="order-timers">
            <div class="timer-card wait-timer">
                <span class="timer-title">⏱️ Espera do cliente</span>
                <strong class="timer-value" id="time-wait-${pedido.id}-${tabType}">${formatElapsed(Date.now() - queueStartedAt)}</strong>
            </div>
            <div class="timer-card prep-estimate">
                <span class="timer-title">🎯 Previsão de entrega</span>
                <strong class="timer-value" id="time-estimate-${pedido.id}-${tabType}">${formatCountdown(estimatedDeadline - Date.now())}</strong>
            </div>
        </div>`;
    } else if (tabType === 'entregues' && entregueHoraStr) {
        timerHTML = `<div style="background: #1c2833; color: #2ecc71; padding: 0.4rem; text-align: center; font-weight: bold; font-size: 0.9rem; border-bottom: 1px solid #333;">
            ✅ Entregue às ${entregueHoraStr}
        </div>`;
    }

    card.innerHTML = `
        <div class="order-header" style="flex-direction: column; align-items: flex-start;">
            <div style="display: flex; justify-content: space-between; width: 100%; align-items: center; flex-wrap: wrap; gap: 0.4rem;">
                <div style="display: flex; align-items: center; gap: 0.6rem;">
                    <h3 style="font-size: 1.8rem; margin: 0; color:var(--primary-color);">#${pedido.senha}</h3>
                    ${priorityBadge}
                    ${queuePositionHTML}
                </div>
                <span class="order-time">${dataHoraStr}</span>
            </div>
            <div style="font-size: 1.25rem; font-weight: bold; margin-top: 0.4rem;">${pedido.clientName}</div>
            <div style="color: #bbb; font-size: 0.85rem; margin-top: 0.2rem;">Atendido por: <strong style="color:#fff;">${pedido.waiterName || 'Desconhecido'}</strong></div>
            <div class="kitchen-order-total">Total: <strong>${getKitchenOrderTotal(pedido).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong></div>
        </div>
        ${featureHTML}
        ${timerHTML}
        <ul class="order-items">
            ${itemsHTML}
        </ul>
        ${obsHTML}
        <div class="kitchen-note-box">
            <button type="button" class="toggle-kitchen-note-btn" aria-expanded="false">📝 Anotação da cozinha</button>
            <div class="kitchen-note-content hidden">
                <label>Anotação da cozinha</label>
                <textarea class="kitchen-note-input" rows="2" placeholder="Anotação interna; não altera o tempo de espera."></textarea>
                <button type="button" class="save-kitchen-note-btn">Salvar anotação</button>
            </div>
        </div>
        ${['chapeiro', 'fritadeira'].includes(tabType) ? `<div class="chapeiro-readonly-hint">👁️ Visualização operacional — a finalização é feita no painel da cozinha.</div>` : ''}
        <button type="button" class="edit-customer-kitchen-btn">👤 Editar dados do cliente</button>
        ${isQueue ? `<div class="order-footer"><div class="order-footer-actions four-actions"><button class="edit-order-btn icon-action-btn" title="Editar pedido" aria-label="Editar pedido">✏️</button><button class="mark-ready-btn icon-action-btn" title="Marcar como pronto" aria-label="Marcar como pronto">✅</button><button class="deliver-lane-btn icon-action-btn" title="Entregar pedido" aria-label="Entregar pedido">📦</button><button class="delete-kitchen-order-btn icon-action-btn" title="Excluir pedido definitivamente" aria-label="Excluir pedido definitivamente">🗑️</button></div></div>` : ''}
        ${isReady ? `<div class="order-footer"><div class="order-footer-actions four-actions"><button class="edit-order-btn icon-action-btn" title="Editar pedido" aria-label="Editar pedido">✏️</button><button class="regress-status-btn icon-action-btn" title="Voltar pedido para a fila" aria-label="Voltar pedido para a fila">↩️</button><button class="deliver-lane-btn icon-action-btn" title="Entregar pedido" aria-label="Entregar pedido">📦</button><button class="delete-kitchen-order-btn icon-action-btn" title="Excluir pedido definitivamente" aria-label="Excluir pedido definitivamente">🗑️</button></div></div>` : ''}
        ${tabType === 'entregues' ? `<div class="order-footer"><div class="order-footer-actions three-actions"><button class="edit-order-btn icon-action-btn" title="Editar pedido" aria-label="Editar pedido">✏️</button><button class="regress-status-btn icon-action-btn" title="Reabrir pedido como pronto" aria-label="Reabrir pedido como pronto">↩️</button><button class="delete-kitchen-order-btn icon-action-btn" title="Excluir pedido definitivamente" aria-label="Excluir pedido definitivamente">🗑️</button></div></div>` : ''}
    `;

    const noteInput = card.querySelector('.kitchen-note-input');
    const noteButton = card.querySelector('.save-kitchen-note-btn');
    const noteToggle = card.querySelector('.toggle-kitchen-note-btn');
    const noteContent = card.querySelector('.kitchen-note-content');
    if (noteToggle && noteContent) {
        noteToggle.onclick = () => {
            const willOpen = noteContent.classList.contains('hidden');
            noteContent.classList.toggle('hidden', !willOpen);
            noteToggle.setAttribute('aria-expanded', String(willOpen));
            noteToggle.textContent = willOpen ? '▲ Ocultar anotação' : '📝 Anotação da cozinha';
            if (willOpen) noteInput.focus();
        };
    }
    if (noteInput) noteInput.value = pedido.kitchenNote || '';
    if (noteButton) {
        noteButton.onclick = () => {
            pedido.kitchenNote = noteInput.value.trim();
            pedido.kitchenNoteUpdatedAt = Date.now();
            globalOrders[pedido.id] = pedido;
            saveStoredOrders();
            publishUpdate({ type: 'ORDER_UPDATE', order: pedido }, false);
            noteButton.textContent = 'Anotação salva ✓';
            setTimeout(() => {
                if (document.body.contains(noteButton)) noteButton.textContent = 'Salvar anotação';
            }, 1600);
        };
    }

    const editButton = card.querySelector('.edit-order-btn');
    if (editButton) editButton.onclick = () => openFullOrderEditor(pedido);
    const editCustomerButton = card.querySelector('.edit-customer-kitchen-btn');
    if (editCustomerButton) editCustomerButton.onclick = () => openEditOrder(pedido);
    const deleteButton = card.querySelector('.delete-kitchen-order-btn');
    if (deleteButton) deleteButton.onclick = () => deleteOrderPermanently(pedido);
    if (isOperational) {
        const timeWaitEl = card.querySelector(`#time-wait-${pedido.id}-${tabType}`);
        const timeEstimateEl = card.querySelector(`#time-estimate-${pedido.id}-${tabType}`);
        const estimateDeadline = Number(pedido.estimatedReadyAt) || getOrderQueueTime(pedido) + getEstimatedPrepMinutes(pedido) * 60000;
        let timerInterval = null;
        const updateTimers = () => {
            const diffMs = Math.max(0, Date.now() - getOrderQueueTime(pedido));
            const diffMins = Math.floor(diffMs / 60000);
            if (timeWaitEl && document.body.contains(timeWaitEl)) {
                timeWaitEl.textContent = formatElapsed(diffMs);
                if (diffMins >= 15) timeWaitEl.style.color = 'var(--danger)';
            } else if (timerInterval) {
                clearInterval(timerInterval);
            }
            if (timeEstimateEl && document.body.contains(timeEstimateEl)) {
                const remaining = estimateDeadline - Date.now();
                timeEstimateEl.textContent = formatCountdown(remaining);
                timeEstimateEl.classList.toggle('estimate-overdue', remaining < 0);
            }
        };
        updateTimers();
        timerInterval = setInterval(updateTimers, 1000);

        const readyButton = card.querySelector('.mark-ready-btn');
        if (readyButton) readyButton.onclick = () => updateOrderItemsStatus(pedido, itemsArr, 'pronto');
        const regressButton = card.querySelector('.regress-status-btn');
        if (regressButton && isReady) regressButton.onclick = () => updateOrderItemsStatus(pedido, itemsArr, 'fila');
        const deliverButton = card.querySelector('.deliver-lane-btn');
        if (deliverButton) deliverButton.onclick = () => markOrderDelivered(pedido);
    }
    if (tabType === 'entregues') {
        const regressButton = card.querySelector('.regress-status-btn');
        if (regressButton) regressButton.onclick = () => updateOrderItemsStatus(pedido, pedido.items || [], 'pronto');
    }

    containerTarget.append(card);
}

function renderKitchenItem(item) {
    const name = item.product && item.product.name ? item.product.name : 'Item sem nome';
    const qty = Number(item.qty) || 1;
    const readyAction = '';
    const consumptionMatch = name.match(/-\s(Comer no Local|Para Levar)$/);
    const consumption = item.consumption === 'levar' ? 'Para Levar' : item.consumption === 'local' ? 'Comer no Local' : consumptionMatch ? consumptionMatch[1] : 'Comer no Local';
    const doneness = item.doneness ? `<span class="prep-block item-doneness"><b>Ponto da picanha</b><span>🔥 ${escapeKitchenHtml(item.doneness)}</span></span>` : '';
    const itemNote = item.note ? `<span class="prep-block individual-item-note"><b>Observação do prato</b><span>📝 ${escapeKitchenHtml(item.note)}</span></span>` : '';

    if (item.product && item.product.dynamic === 'prato' && name.includes(' + ')) {
        const baseName = name.split(' + ')[0];
        const riceMatch = name.match(/\+\s(.+?)\s\[(?:TIRAR:|COMPLETO)/);
        const removeMatch = name.match(/\[TIRAR:\s*([^\]]+)\]/);
        const additionsMatch = name.match(/\[ADICIONAIS:\s*([^\]]+)\]/i);
        const removed = removeMatch ? removeMatch[1].split(',').map(value => value.trim()) : [];
        const additions = Array.isArray(item.additions) ? item.additions : additionsMatch ? additionsMatch[1].split(',').map(value => value.trim()) : [];
        const defaults = baseName.includes('Picanha')
            ? ['Tropeiro', 'Salada', 'Vinagrete', 'Farofa', 'Macaxeira', 'Maionese', 'Batata Palha', 'Vatapá']
            : baseName.includes('Tambaqui')
                ? ['Vinagrete', 'Banana Frita', 'Farofa']
                : ['Tropeiro', 'Salada', 'Vinagrete', 'Farofa', 'Macaxeira', 'Vatapá'];
        const mounted = defaults.filter(value => !removed.includes(value));
        const preparation = removed.length
            ? `<span class="prep-block prep-remove"><b>Retirar</b><span>${removed.join(' • ')}</span></span>
               <span class="prep-block"><b>Prato montado</b><span>${mounted.join(' • ')}</span></span>`
            : `<span class="prep-block prep-complete"><b>Completo</b></span>`;

        return `<li class="configured-item">
            <span class="item-qty">${qty}x</span>
            <span class="item-name">${baseName}
                <span class="prep-block"><b>Arroz</b><span>${riceMatch ? riceMatch[1] : 'Não informado'}</span></span>
                ${doneness}
                ${preparation}
                ${additions.length ? `<span class="prep-block prep-additions"><b>Adicionais</b><span>${additions.map(escapeKitchenHtml).join(' • ')}</span></span>` : ''}
                ${itemNote}
            </span>
            <span class="prep-location ${consumption === 'Para Levar' ? 'to-go' : ''}">${consumption === 'Para Levar' ? '🛍️ PARA LEVAR' : '🍽️ COMER NO LOCAL'}</span>
            ${readyAction}
        </li>`;
    }

    if (name.startsWith('Caldo ')) {
        const caldoMatch = name.match(/^Caldo\s+(.+?)\s+(350ml|500ml)\s+\((.+?)\)\s+-/);
        const flavor = caldoMatch ? caldoMatch[1] : 'Não informado';
        const size = caldoMatch ? caldoMatch[2] : '';
        const accompaniment = caldoMatch ? caldoMatch[3].replace(/^Com:\s*/, '') : 'Sem acompanhamento';
        return `<li class="configured-item">
            <span class="item-qty">${qty}x</span>
            <span class="item-name">Caldo de ${flavor}
                <span class="prep-block"><b>Tamanho</b><span>${size}</span></span>
                <span class="prep-block"><b>Acompanhamentos</b><span>${accompaniment === 'Sem Acomp.' ? 'Sem acompanhamento' : accompaniment}</span></span>
            </span>
            <span class="prep-location ${consumption === 'Para Levar' ? 'to-go' : ''}">${consumption === 'Para Levar' ? '🛍️ PARA LEVAR' : '🍽️ COMER NO LOCAL'}</span>
            ${readyAction}
        </li>`;
    }

    return `<li><span class="item-qty">${qty}x</span><span class="item-name">${name}</span>${readyAction}</li>`;
}

// Inicializa Aba Padrão Fila
setupPrepSettings();
setupProductPriceSettings();
switchTab('pratos');
hydrateKitchenOrders();
setInterval(renderQueueMetrics, 30000);

// --- WAKE LOCK E SINCRONIZAÇÃO EM SEGUNDO PLANO ---
let wakeLock = null;
async function keepScreenAlive() {
    try {
        if ('wakeLock' in navigator && (!wakeLock || wakeLock.released)) {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => { wakeLock = null; }, { once: true });
        }
    } catch (err) { }
}

function handleKitchenResume() {
    globalOrders = loadStoredOrders();
    renderAll();
    keepScreenAlive();

    if (syncClient && syncClient.connected) {
        publishUpdate({ type: 'REQUEST_SYNC' }, false);
    } else if (navigator.onLine) {
        connectSync();
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        handleKitchenResume();
    }
});

window.addEventListener('pageshow', handleKitchenResume);
window.addEventListener('focus', handleKitchenResume);
window.addEventListener('online', handleKitchenResume);
window.addEventListener('offline', () => {
    kitchenSyncOnline = false;
    els.status.textContent = '● SEM INTERNET';
    els.status.className = 'status-offline';
});
setInterval(() => {
    if (!navigator.onLine && kitchenSyncOnline) {
        kitchenSyncOnline = false;
        els.status.textContent = '● SEM INTERNET';
        els.status.className = 'status-offline';
    }
}, 1000);
setInterval(() => {
    if (syncClient && syncClient.connected) flushKitchenOutbox();
}, 3000);
setInterval(() => {
    if (syncClient && syncClient.connected) publishUpdate({ type: 'REQUEST_SYNC' }, false);
}, 20000);

document.body.addEventListener('click', keepScreenAlive);
document.body.addEventListener('touchstart', keepScreenAlive);

// --- GESTOR DE ESTOQUE DE BEBIDAS ---
const beverageNames = [
    'Coca-Cola Lata', 'Coca-Cola Zero Lata', 'Fanta Uva Lata', 'Fanta Laranja Lata',
    'Coca-Cola 1L', 'Fanta Laranja 1L', 'Baré 1L',
    'Suco de Acerola', 'Suco de Maracujá', 'Água Mineral'
];

const stockEls = {
    openBtn: document.getElementById('beverage-stock-btn'),
    overlay: document.getElementById('beverage-stock-overlay'),
    closeBtn: document.getElementById('close-beverage-stock-btn'),
    list: document.getElementById('beverage-stock-list')
};

function createInitialBeverageStock() {
    const items = {};
    beverageNames.forEach(name => items[name] = { qty: 0, minimum: 5, configured: false });
    return { items, movements: [], processedItems: {}, updatedAt: 0 };
}

function loadBeverageStock() {
    try {
        const saved = JSON.parse(localStorage.getItem('canela_beverage_stock'));
        const data = saved && saved.items ? saved : createInitialBeverageStock();
        if (!data.items['Suco de Acerola'] && data.items['Suco de Açerola']) data.items['Suco de Acerola'] = { ...data.items['Suco de Açerola'] };
        beverageNames.forEach(name => {
            if (!data.items[name]) data.items[name] = { qty: 0, minimum: 5, configured: false };
            const minimum = Math.floor(Number(data.items[name].minimum));
            data.items[name].minimum = Number.isFinite(minimum) && minimum >= 0 ? minimum : 5;
        });
        if (!Array.isArray(data.movements)) data.movements = [];
        if (!data.processedItems || typeof data.processedItems !== 'object') data.processedItems = {};
        if (!Number.isFinite(data.updatedAt)) data.updatedAt = 0;
        return data;
    } catch (error) {
        return createInitialBeverageStock();
    }
}

let beverageStock = loadBeverageStock();

function saveBeverageStock(broadcast = true, touchRevision = true) {
    if (touchRevision) beverageStock.updatedAt = Date.now();
    localStorage.setItem('canela_beverage_stock', JSON.stringify(beverageStock));
    if (window.CanelaPersistence) CanelaPersistence.saveSnapshot('beverage_stock', beverageStock);
    if (window.CanelaSupabase) CanelaSupabase.state.save('beverage_stock', beverageStock).catch(error => console.warn('Estoque aguardando sincronização:', error));
    if (broadcast) publishStockSnapshot(true);
}

function publishStockSnapshot(reliable = true) {
    if (typeof beverageStock === 'undefined') return;
    const payload = { type: 'STOCK_UPDATE', stock: beverageStock };
    if (reliable) {
        publishUpdate(payload, false);
    } else if (syncClient && syncClient.connected) {
        syncClient.publish(topic, JSON.stringify(payload), { qos: 1 });
    }
}

function receiveStockSnapshot(stock) {
    if (!stock || !stock.items) return;
    const incomingRevision = Number(stock.updatedAt || 0);
    const currentRevision = Number(beverageStock.updatedAt || 0);
    if (incomingRevision < currentRevision) return;
    beverageStock = stock;
    if (!beverageStock.items['Suco de Acerola'] && beverageStock.items['Suco de Açerola']) beverageStock.items['Suco de Acerola'] = { ...beverageStock.items['Suco de Açerola'] };
    if (!Array.isArray(beverageStock.movements)) beverageStock.movements = [];
    if (!beverageStock.processedItems) beverageStock.processedItems = {};
    beverageNames.forEach(name => {
        if (!beverageStock.items[name]) beverageStock.items[name] = { qty: 0, minimum: 5, configured: false };
        const minimum = Math.floor(Number(beverageStock.items[name].minimum));
        beverageStock.items[name].minimum = Number.isFinite(minimum) && minimum >= 0 ? minimum : 5;
    });
    localStorage.setItem('canela_beverage_stock', JSON.stringify(beverageStock));
    if (window.CanelaPersistence) CanelaPersistence.saveSnapshot('beverage_stock', beverageStock);
    reconcileDeliveredBeverages();
    renderBeverageStock();
}

function reconcileDeliveredBeverages() {
    if (typeof beverageStock === 'undefined' || !beverageStock.items) return;
    if (!beverageStock.processedItems) beverageStock.processedItems = {};
    let changed = false;

    Object.values(globalOrders).forEach(order => {
        (order.items || []).forEach((item, index) => {
            if (item.status !== 'entregue') return;
            const productName = item.product && item.product.name;
            if (!beverageNames.includes(productName)) return;
            const ledgerId = item.id || `${order.id || order.senha}_item_${index}`;
            const deliveredQty = Math.max(0, Number(item.qty) || 0);
            const accountedQty = Math.max(0, Number(beverageStock.processedItems[ledgerId]) || 0);
            const delta = deliveredQty - accountedQty;
            if (delta <= 0) return;

            beverageStock.items[productName].qty -= delta;
            beverageStock.processedItems[ledgerId] = deliveredQty;
            beverageStock.movements.push({
                id: `stock_sale_${ledgerId}_${Date.now()}`,
                product: productName,
                type: 'venda',
                qty: delta,
                balanceAfter: beverageStock.items[productName].qty,
                orderId: order.id,
                orderSenha: order.senha,
                createdAt: order.deliveredAt || Date.now()
            });
            changed = true;
        });
    });

    if (changed) {
        saveBeverageStock(true);
        renderBeverageStock();
    }
}

function establishBeverageDeductionBaseline() {
    if (beverageStock.autoDeductionStartedAt) return;
    if (!beverageStock.processedItems) beverageStock.processedItems = {};
    Object.values(globalOrders).forEach(order => {
        (order.items || []).forEach((item, index) => {
            if (item.status !== 'entregue') return;
            const productName = item.product && item.product.name;
            if (!beverageNames.includes(productName)) return;
            const ledgerId = item.id || `${order.id || order.senha}_item_${index}`;
            beverageStock.processedItems[ledgerId] = Math.max(0, Number(item.qty) || 0);
        });
    });
    beverageStock.autoDeductionStartedAt = Date.now();
    saveBeverageStock(false, true);
}

async function hydrateBeverageStock() {
    if (!window.CanelaPersistence) return;
    const persisted = await CanelaPersistence.loadSnapshot('beverage_stock');
    if (persisted && persisted.items && Number(persisted.updatedAt || 0) > Number(beverageStock.updatedAt || 0)) {
        const localProcessed = beverageStock.processedItems || {};
        beverageStock = persisted;
        beverageStock.processedItems = { ...(beverageStock.processedItems || {}), ...localProcessed };
        beverageNames.forEach(name => {
            if (!beverageStock.items[name]) beverageStock.items[name] = { qty: 0, minimum: 5, configured: false };
            const minimum = Math.floor(Number(beverageStock.items[name].minimum));
            beverageStock.items[name].minimum = Number.isFinite(minimum) && minimum >= 0 ? minimum : 5;
        });
        saveBeverageStock(false, false);
        establishBeverageDeductionBaseline();
        reconcileDeliveredBeverages();
        renderBeverageStock();
    }
}

function renderBeverageStock() {
    if (!stockEls.list) return;
    stockEls.list.innerHTML = beverageNames.map(name => {
        const item = beverageStock.items[name];
        const low = item.configured && item.qty <= item.minimum;
        return `<div class="beverage-stock-card ${low ? 'low-stock' : ''}">
            <strong>${name}</strong>
            <div class="stock-number-fields">
                <label class="manual-stock-label">Saldo atual
                    <input type="number" class="manual-stock-input" data-product="${escapeKitchenHtml(name)}" min="0" step="1" inputmode="numeric" value="${item.configured ? Math.max(0, Number(item.qty) || 0) : ''}" placeholder="0">
                </label>
                <label class="manual-stock-label">Estoque mínimo
                    <input type="number" class="minimum-stock-input" data-product="${escapeKitchenHtml(name)}" min="0" step="1" inputmode="numeric" value="${Math.max(0, Number(item.minimum) || 0)}">
                </label>
            </div>
            <small class="stock-alert-text">${low ? '⚠️ Estoque mínimo atingido — repor' : `Alerta ao chegar em ${item.minimum} unidade(s)`}</small>
            <div class="stock-quick-actions">
                <button type="button" class="quick-stock-btn minus-stock-btn" data-product="${escapeKitchenHtml(name)}" aria-label="Remover uma unidade" title="Remover uma unidade" ${!item.configured || item.qty <= 0 ? 'disabled' : ''}>➖</button>
                <button type="button" class="quick-stock-btn plus-stock-btn" data-product="${escapeKitchenHtml(name)}" aria-label="Adicionar uma unidade" title="Adicionar uma unidade">➕</button>
                <button type="button" class="zero-stock-btn" data-product="${escapeKitchenHtml(name)}" ${item.configured && item.qty === 0 ? 'disabled' : ''}>🧹 Zerar</button>
            </div>
        </div>`;
    }).join('');

    const applyQuickStockChange = (product, delta) => {
        const item = beverageStock.items[product];
        if (!item || (delta < 0 && (!item.configured || item.qty <= 0))) return;
        item.qty = Math.max(0, (Number(item.qty) || 0) + delta);
        item.configured = true;
        saveBeverageStock();
        renderBeverageStock();
    };
    stockEls.list.querySelectorAll('.plus-stock-btn').forEach(button => button.onclick = () => applyQuickStockChange(button.dataset.product, 1));
    stockEls.list.querySelectorAll('.minus-stock-btn').forEach(button => button.onclick = () => applyQuickStockChange(button.dataset.product, -1));
    stockEls.list.querySelectorAll('.manual-stock-input').forEach(input => {
        const saveManualValue = () => {
            const value = Math.floor(Number(input.value));
            if (!Number.isFinite(value) || value < 0) {
                input.value = beverageStock.items[input.dataset.product].configured ? beverageStock.items[input.dataset.product].qty : '';
                return;
            }
            const item = beverageStock.items[input.dataset.product];
            if (!item) return;
            item.qty = value;
            item.configured = true;
            saveBeverageStock();
            renderBeverageStock();
        };
        input.onchange = saveManualValue;
        input.onkeydown = event => {
            if (event.key === 'Enter') { event.preventDefault(); saveManualValue(); }
        };
    });
    stockEls.list.querySelectorAll('.minimum-stock-input').forEach(input => {
        const saveMinimumValue = () => {
            const item = beverageStock.items[input.dataset.product];
            const value = Math.floor(Number(input.value));
            if (!item || !Number.isFinite(value) || value < 0) {
                input.value = item ? item.minimum : 5;
                return;
            }
            item.minimum = value;
            saveBeverageStock();
            renderBeverageStock();
        };
        input.onchange = saveMinimumValue;
        input.onkeydown = event => {
            if (event.key === 'Enter') { event.preventDefault(); saveMinimumValue(); }
        };
    });

    stockEls.list.querySelectorAll('.zero-stock-btn').forEach(button => {
        button.onclick = () => {
            const product = button.dataset.product;
            const item = beverageStock.items[product];
            if (!item || !confirm(`Zerar o estoque de ${product}?`)) return;
            item.qty = 0;
            item.configured = true;
            saveBeverageStock();
            renderBeverageStock();
        };
    });
}

if (stockEls.openBtn) {
    stockEls.openBtn.onclick = () => {
        renderBeverageStock();
        stockEls.overlay.classList.remove('hidden');
    };
    stockEls.closeBtn.onclick = () => stockEls.overlay.classList.add('hidden');
    stockEls.overlay.addEventListener('click', event => {
        if (event.target === stockEls.overlay) stockEls.overlay.classList.add('hidden');
    });
}

establishBeverageDeductionBaseline();
hydrateBeverageStock();

function setupInternalPageTransitions() {
    document.querySelectorAll('a[href]').forEach(link => {
        link.addEventListener('click', event => {
            if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || link.target === '_blank') return;
            const targetUrl = new URL(link.href, window.location.href);
            if (targetUrl.origin !== window.location.origin || targetUrl.href === window.location.href) return;
            event.preventDefault();
            document.body.classList.add('page-leaving');
            setTimeout(() => { window.location.href = targetUrl.href; }, 180);
        });
    });
    window.addEventListener('pageshow', () => document.body.classList.remove('page-leaving'));
}

setupInternalPageTransitions();
