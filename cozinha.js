const topic = 'caneladefogo/pedidos/sync';
let audioCtx = null;
let mqttClient = null;
let kitchenMqttOnline = false;

const els = {
    overlay: document.getElementById('audio-overlay'),
    startBtn: document.getElementById('start-btn'),
    audioToggleBtn: document.getElementById('audio-toggle-btn'),
    pratosFilaContainer: document.getElementById('pratos-fila-container'),
    pratosPreparoContainer: document.getElementById('pratos-preparo-container'),
    pratosProntoContainer: document.getElementById('pratos-pronto-container'),
    caldosFilaContainer: document.getElementById('caldos-fila-container'),
    caldosPreparoContainer: document.getElementById('caldos-preparo-container'),
    caldosProntoContainer: document.getElementById('caldos-pronto-container'),
    entreguesContainer: document.getElementById('entregues-container'),
    chapeiroContainer: document.getElementById('chapeiro-container'),
    status: document.getElementById('status'),
    emptyState: document.getElementById('empty-state'),
    kitchenSearch: document.getElementById('kitchen-search'),
    countPratosFila: document.getElementById('count-pratos-fila'),
    countPratosPreparo: document.getElementById('count-pratos-preparo'),
    countPratosPronto: document.getElementById('count-pratos-pronto'),
    countCaldosFila: document.getElementById('count-caldos-fila'),
    countCaldosPreparo: document.getElementById('count-caldos-preparo'),
    countCaldosPronto: document.getElementById('count-caldos-pronto'),
    countPratosTotal: document.getElementById('count-pratos-total'),
    countCaldosTotal: document.getElementById('count-caldos-total'),
    countEntregues: document.getElementById('kitchen-count-entregues'),
    countChapeiro: document.getElementById('kitchen-count-chapeiro'),
    queueMetrics: document.getElementById('queue-metrics'),
    kitchenHistoryBar: document.getElementById('kitchen-history-bar'),
    kitchenTotalEntreguesVal: document.getElementById('kitchen-total-entregues-val'),
    kitchenClearHistoryBtn: document.getElementById('kitchen-clear-history-btn'),
    resetPasswordsBtn: document.getElementById('reset-passwords-btn'),
    prepSettingsBtn: document.getElementById('prep-settings-btn'),
    prepSettingsOverlay: document.getElementById('prep-settings-overlay'),
    closePrepSettingsBtn: document.getElementById('close-prep-settings-btn'),
    savePrepSettingsBtn: document.getElementById('save-prep-settings-btn'),
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

let audioEnabled = localStorage.getItem('canela_audio_pref') !== 'off';
let audioUnlocked = false;
let currentTab = 'pratos';
let kitchenSearchQuery = "";
let historyClearedAt = Number(localStorage.getItem('canela_history_cleared_at')) || 0;
let deletedOrderIds = loadDeletedOrderIds();
let editingOrderId = null;
let prepTimeSettings = loadPrepTimeSettings();

function loadPrepTimeSettings() {
    const defaults = { baseCarne: 10, basePicanha: 12, baseCaldo: 8, incrementCarne: 4, incrementPicanha: 6, incrementCaldo: 3, updatedAt: 0 };
    try { return { ...defaults, ...(JSON.parse(localStorage.getItem('canela_prep_time_settings')) || {}) }; }
    catch (error) { return defaults; }
}

function savePrepTimeSettings(settings, publish = true) {
    prepTimeSettings = { ...prepTimeSettings, ...settings, updatedAt: Number(settings.updatedAt) || Date.now() };
    localStorage.setItem('canela_prep_time_settings', JSON.stringify(prepTimeSettings));
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
            const ord = parsed[key];
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
    } catch (e) {
        console.error("Erro ao salvar dados da cozinha:", e);
    }
}

let globalOrders = loadStoredOrders();

async function hydrateKitchenOrders() {
    if (!window.CanelaPersistence) return;
    const persisted = await CanelaPersistence.loadSnapshot('cozinha_orders');
    if (!persisted || typeof persisted !== 'object') return;
    Object.values(persisted).forEach(order => {
        if (deletedOrderIds[order.id || order.senha]) return;
        if (shouldSuppressDeliveredOrder(order)) return;
        const id = order.id || order.senha;
        const current = globalOrders[id];
        if (!current || (order.updatedAt || order.timestamp || 0) >= (current.updatedAt || current.timestamp || 0)) {
            globalOrders[id] = order;
        }
    });
    saveStoredOrders();
    renderAll();
}

function unlockKitchenAudio() {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        audioUnlocked = true;
    } catch (e) {
        console.warn("Erro ao iniciar áudio:", e);
    }
}

window.testSoundKitchen = function () {
    unlockKitchenAudio();
    playThreeBells();
};

// Desbloqueia áudio em qualquer toque/clique na tela
window.addEventListener('click', unlockKitchenAudio);
window.addEventListener('touchstart', unlockKitchenAudio);

// Inicialização de Preferência de Áudio
if (audioEnabled) {
    els.overlay.classList.add('hidden');
    if (els.audioToggleBtn) els.audioToggleBtn.textContent = 'Som: ON 🔊';
    setTimeout(() => {
        connectMQTT();
        keepScreenAlive();
    }, 0);
} else {
    if (els.audioToggleBtn) els.audioToggleBtn.textContent = 'Som: OFF 🔇';
}

els.startBtn.onclick = () => {
    els.overlay.classList.add('hidden');
    audioEnabled = true;
    localStorage.setItem('canela_audio_pref', 'on');
    if (els.audioToggleBtn) els.audioToggleBtn.textContent = 'Som: ON 🔊';
    unlockKitchenAudio();
    playThreeBells(); // Toca sino de confirmação
    connectMQTT();
    keepScreenAlive();
    renderAll();
};

if (els.audioToggleBtn) {
    els.audioToggleBtn.onclick = () => {
        audioEnabled = !audioEnabled;
        localStorage.setItem('canela_audio_pref', audioEnabled ? 'on' : 'off');
        els.audioToggleBtn.textContent = audioEnabled ? 'Som: ON 🔊' : 'Som: OFF 🔇';
        if (audioEnabled) {
            unlockKitchenAudio();
            playThreeBells();
        }
    };
}

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

function playSingleBell(freq, startTime) {
    if (!audioCtx) return;
    try {
        // Tom fundamental do sino
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(freq, startTime);

        // Harmônico metálico do sino
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(freq * 2.76, startTime);

        // Ganho geral do toque
        const masterGain = audioCtx.createGain();

        osc1.connect(gain1);
        gain1.connect(masterGain);

        osc2.connect(gain2);
        gain2.connect(masterGain);

        masterGain.connect(audioCtx.destination);

        // Curva de volume (Ataque rápido e ressonância suave do sino)
        gain1.gain.setValueAtTime(0.85, startTime);
        gain1.gain.exponentialRampToValueAtTime(0.001, startTime + 0.75);

        gain2.gain.setValueAtTime(0.35, startTime);
        gain2.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);

        masterGain.gain.setValueAtTime(0.9, startTime);
        masterGain.gain.linearRampToValueAtTime(0.9, startTime + 0.02);
        masterGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.8);

        osc1.start(startTime);
        osc1.stop(startTime + 0.85);

        osc2.start(startTime);
        osc2.stop(startTime + 0.45);
    } catch (e) {
        console.warn("Erro ao tocar sino:", e);
    }
}

function playThreeBells() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    if (!audioCtx) return;

    const t = audioCtx.currentTime;
    // Sino curto de passe de cozinha: dois impactos metálicos bem definidos.
    playSingleBell(659.25, t);
    playSingleBell(987.77, t + 0.28);
}

function notifySound() {
    if (audioEnabled) {
        playThreeBells();
    }
}

// --- CONEXÃO MQTT E SINCRONIZAÇÃO ---
function connectMQTT() {
    els.status.textContent = 'Conectando Servidor...';
    els.status.className = 'status-offline';

    const uniqueKitchenClientId = 'canela_kitchen_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now();
    mqttClient = mqtt.connect('wss://broker.hivemq.com:8884/mqtt', {
        clientId: uniqueKitchenClientId,
        keepalive: 60,
        reconnectPeriod: 2000,
        clean: true
    });

    mqttClient.on('connect', () => {
        kitchenMqttOnline = true;
        mqttClient.subscribe(topic, (err) => {
            if (!err) {
                els.status.textContent = '● CONECTADO (Aguardando Pedidos)';
                els.status.className = 'status-online';
                refreshKitchenSyncStatus();
                publishUpdate({ type: 'REQUEST_SYNC' }, false);
                flushKitchenOutbox();
            }
        });
    });

    mqttClient.on('reconnect', () => {
        kitchenMqttOnline = false;
        els.status.textContent = 'Reconectando...';
        els.status.className = 'status-offline';
    });

    mqttClient.on('offline', () => {
        kitchenMqttOnline = false;
        els.status.textContent = '● OFFLINE';
        els.status.className = 'status-offline';
    });

    mqttClient.on('error', () => {
        kitchenMqttOnline = false;
        els.status.textContent = '● ERRO DE CONEXÃO';
        els.status.className = 'status-offline';
    });

    mqttClient.on('message', (t, message) => {
        if (t !== topic) return;
        try {
            const data = JSON.parse(message.toString());

            // 1. Pedido de sincronização de outro dispositivo
            if (data.type === 'REQUEST_SYNC') {
                const list = Object.values(globalOrders);
                publishUpdate({ type: 'SYNC_ALL_ORDERS', orders: list, historyClearedAt, deletedOrderIds, prepTimeSettings }, false);
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
                if (data.prepTimeSettings && Number(data.prepTimeSettings.updatedAt || 0) >= Number(prepTimeSettings.updatedAt || 0)) savePrepTimeSettings(data.prepTimeSettings, false);
                data.orders.forEach(ord => {
                    if (deletedOrderIds[ord.id]) return;
                    if (shouldSuppressDeliveredOrder(ord)) return;
                    const safeId = ord.id || `ord_${ord.senha}_${ord.timestamp || Date.now()}`;
                    ord.id = safeId;
                    const current = globalOrders[safeId];
                    globalOrders[safeId] = window.mergeCanelaOrders ? mergeCanelaOrders(current, ord) : ord;
                });
                saveStoredOrders();
                reconcileDeliveredBeverages();
                renderAll();
                return;
            }

            // 3. Limpeza de Histórico
            if (data.type === 'CLEAR_HISTORY') {
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
                if (Number(data.settings.updatedAt || 0) >= Number(prepTimeSettings.updatedAt || 0)) savePrepTimeSettings(data.settings, false);
                return;
            }

            if (data.type === 'RESET_PASSWORDS') return;

            // 4. Pedido individual
            const pedido = data.order || data;
            if (!pedido || (!pedido.id && !pedido.senha)) return;

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
            if (!existing) {
                const hasFila = mergedPedido.items.some(i => (i.status || 'fila') === 'fila');
                if (hasFila) isNewAction = true;
            } else {
                const oldFila = existing.items.filter(i => (i.status || 'fila') === 'fila').length;
                const newFila = mergedPedido.items.filter(i => (i.status || 'fila') === 'fila').length;
                if (newFila > oldFila) isNewAction = true;
            }

            globalOrders[safeId] = mergedPedido;
            saveStoredOrders();
            reconcileDeliveredBeverages();
            renderAll();

            if (data.type === 'ORDER_UPDATE') {
                publishUpdate({ type: 'ORDER_RECEIVED_ACK', orderId: safeId, updatedAt: mergedPedido.updatedAt || mergedPedido.timestamp || Date.now() }, false);
            }

            if (isNewAction) {
                notifySound();
            }

        } catch (e) {
            console.error("Erro ao processar mensagem na cozinha:", e);
        }
    });
}

async function publishUpdate(payload, saveLocally = true) {
    const reliable = payload && (payload.type === 'ORDER_UPDATE' || payload.type === 'CLEAR_HISTORY' || payload.type === 'STOCK_UPDATE' || payload.type === 'RESET_PASSWORDS' || payload.type === 'DELETE_ORDER' || payload.type === 'PREP_TIME_SETTINGS');
    if (reliable && window.CanelaPersistence) {
        const queued = await CanelaPersistence.enqueue('cozinha', payload);
        if (queued) {
            refreshKitchenSyncStatus();
            flushKitchenOutbox();
        } else if (mqttClient && mqttClient.connected) {
            mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 });
        }
    } else if (mqttClient && mqttClient.connected) {
        mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 });
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
    } else if (kitchenMqttOnline) {
        els.status.textContent = '● CONECTADO • SINCRONIZADO';
        els.status.className = 'status-online';
    }
}

let kitchenOutboxFlushing = false;
async function flushKitchenOutbox() {
    if (kitchenOutboxFlushing || !window.CanelaPersistence || !mqttClient || !mqttClient.connected) return;
    kitchenOutboxFlushing = true;
    try {
        const pending = await CanelaPersistence.listPending('cozinha');
        for (const entry of pending) {
            if (!mqttClient.connected) break;
            await new Promise((resolve, reject) => {
                mqttClient.publish(topic, JSON.stringify(entry.payload), { qos: 1 }, error => error ? reject(error) : resolve());
            });
            await CanelaPersistence.removePending(entry.id);
            refreshKitchenSyncStatus();
        }
    } catch (error) {
        console.warn('Envios da cozinha continuarão pendentes:', error);
    } finally {
        kitchenOutboxFlushing = false;
        if (mqttClient && mqttClient.connected) {
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

// Limpar Histórico na Cozinha
if (els.kitchenClearHistoryBtn) {
    els.kitchenClearHistoryBtn.onclick = () => {
        const entreguesList = Object.values(globalOrders).filter(o => o.items.every(i => i.status === 'entregue') || o.deliveredAt);
        if (entreguesList.length === 0) {
            alert("Não há pedidos no histórico de entregues para limpar.");
            return;
        }
        if (confirm(`Deseja limpar os ${entreguesList.length} pedidos entregues? Os pedidos na fila e prontos permanecerão salvos.`)) {
            const clearedAt = Date.now();
            applyHistoryClear(clearedAt);
            publishUpdate({ type: 'CLEAR_HISTORY', clearedAt }, false);
            renderAll();
        }
    };
}

if (els.resetPasswordsBtn) {
    els.resetPasswordsBtn.onclick = () => {
        if (!confirm('Reiniciar a sequência? O próximo pedido enviado receberá a senha #001.')) return;
        const date = new Date().toLocaleDateString('en-CA');
        publishUpdate({ type: 'RESET_PASSWORDS', date, resetAt: Date.now() }, false);
        alert('Sequência reiniciada. O próximo pedido receberá a senha #001.');
    };
}

function updateKitchenCounters() {
    const counts = { pratosFila: 0, pratosPreparo: 0, pratosPronto: 0, caldosFila: 0, caldosPreparo: 0, caldosPronto: 0 };
    let countEntregues = 0;
    let countChapeiro = 0;

    Object.values(globalOrders).forEach(pedido => {
        const items = pedido.items || [];
        if (items.some(i => isChapaItem(i) && (i.status || 'fila') === 'fila')) counts.pratosFila++;
        if (items.some(i => isChapaItem(i) && i.status === 'em_preparo')) counts.pratosPreparo++;
        if (items.some(i => isChapaItem(i) && i.status === 'pronto')) counts.pratosPronto++;
        if (items.some(i => isCaldoItem(i) && (i.status || 'fila') === 'fila')) counts.caldosFila++;
        if (items.some(i => isCaldoItem(i) && i.status === 'em_preparo')) counts.caldosPreparo++;
        if (items.some(i => isCaldoItem(i) && i.status === 'pronto')) counts.caldosPronto++;
        const isEntregue = pedido.items.every(i => i.status === 'entregue') || pedido.deliveredAt;
        if (isEntregue) countEntregues++;
        if (items.some(i => ['fila', 'em_preparo'].includes(i.status || 'fila') && isChapaItem(i))) countChapeiro++;
    });

    Object.entries(counts).forEach(([key, value]) => { if (els[`count${key[0].toUpperCase()}${key.slice(1)}`]) els[`count${key[0].toUpperCase()}${key.slice(1)}`].textContent = value; });
    if (els.countPratosTotal) els.countPratosTotal.textContent = counts.pratosFila + counts.pratosPreparo + counts.pratosPronto;
    if (els.countCaldosTotal) els.countCaldosTotal.textContent = counts.caldosFila + counts.caldosPreparo + counts.caldosPronto;
    if (els.countEntregues) els.countEntregues.textContent = countEntregues;
    if (els.countChapeiro) els.countChapeiro.textContent = countChapeiro;
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
    const plateTotals = { carne: 0, picanha: 0 };
    const riceTotals = { carne: new Map(), picanha: new Map() };
    const brothTotals = new Map(['Carne', 'Quenga', 'Camarão', 'Frango'].map(name => [name, { withAcc: 0, withoutAcc: 0 }]));
    deliveredOrders.forEach(order => (order.items || []).forEach(item => {
        const rawName = item.product && item.product.name || '';
        const qty = Number(item.qty) || 1;
        const normalized = rawName.toLowerCase();
        const plateType = normalized.includes('carne de sol na chapa') ? 'carne' : normalized.includes('picanha na chapa') ? 'picanha' : null;
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
    return name.includes('carne de sol na chapa') || name.includes('picanha na chapa');
}

function isCaldoItem(item) {
    const name = item && item.product && item.product.name ? item.product.name.toLowerCase() : '';
    return name.startsWith('caldo ');
}

function renderQueueMetrics() {
    if (!els.queueMetrics) return;
    if (currentTab === 'entregues') { els.queueMetrics.innerHTML = ''; return; }
    const lane = currentTab === 'pratos' || currentTab.startsWith('pratos-') || currentTab === 'chapeiro' ? 'pratos' : currentTab === 'caldos' || currentTab.startsWith('caldos-') ? 'caldos' : null;
    const stage = currentTab.endsWith('-preparo') ? 'em_preparo' : currentTab.endsWith('-pronto') ? 'pronto' : null;
    const totals = new Map();
    const chapeiroTotals = { carne: 0, picanha: 0 };
    let pendingUnits = 0;
    let pendingOrders = 0;
    let oldestQueueTime = null;
    Object.values(globalOrders).forEach(order => {
        let orderHasPending = false;
        (order.items || []).forEach(item => {
            const itemStatus = item.status || 'fila';
            if (currentTab === 'chapeiro' ? !['fila', 'em_preparo'].includes(itemStatus) : stage && itemStatus !== stage) return;
            if (!stage && currentTab !== 'chapeiro' && !['fila', 'em_preparo', 'pronto'].includes(itemStatus)) return;
            if (lane === 'pratos' && !isChapaItem(item)) return;
            if (lane === 'caldos' && !isCaldoItem(item)) return;
            orderHasPending = true;
            pendingUnits += Number(item.qty) || 1;
            const queuedAt = getOrderQueueTime(order);
            if (queuedAt > 0 && (oldestQueueTime === null || queuedAt < oldestQueueTime)) oldestQueueTime = queuedAt;
            const fullName = item.product && item.product.name ? item.product.name : 'Item sem nome';
            if (currentTab === 'chapeiro') {
                const chapaKey = fullName.toLowerCase().includes('picanha') ? 'picanha' : 'carne';
                chapeiroTotals[chapaKey] += Number(item.qty) || 1;
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
            <div class="queue-metric-card"><span>Picanhas na Chapa</span><strong>${chapeiroTotals.picanha}</strong></div>
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
    const rawStart = Number(pedido.startedAt || pedido.timestamp || 0);
    if (!Number.isFinite(rawStart) || rawStart <= 0) return Date.now();
    return Math.min(rawStart, Date.now());
}

function getPriorityRank(order) {
    if (order.priority === 'idoso80') return 3;
    if (['idoso60', 'gestante', 'pcd', 'autista', 'colo'].includes(order.priority)) return 2;
    return 0;
}

function getOrderQueuePosition(targetOrder) {
    const operationalQueue = Object.values(globalOrders)
        .filter(order => (order.items || []).some(item => ['fila', 'em_preparo'].includes(item.status || 'fila')))
        .sort((a, b) => getPriorityRank(b) - getPriorityRank(a) || getOrderQueueTime(a) - getOrderQueueTime(b));
    const index = operationalQueue.findIndex(order => order.id === targetOrder.id);
    return index >= 0 ? index + 1 : null;
}

function getEstimatedPrepMinutes(targetOrder) {
    const pending = Object.values(globalOrders)
        .filter(order => (order.items || []).some(item => ['fila', 'em_preparo'].includes(item.status || 'fila')))
        .sort((a, b) => getPriorityRank(b) - getPriorityRank(a) || getOrderQueueTime(a) - getOrderQueueTime(b));
    const targetIndex = Math.max(0, pending.findIndex(order => order.id === targetOrder.id));
    const ahead = pending.slice(0, targetIndex);
    const targetItems = (targetOrder.items || []).filter(item => ['fila', 'em_preparo'].includes(item.status || 'fila'));
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
        if (!['fila', 'em_preparo'].includes(item.status || 'fila')) return;
        const qty = Number(item.qty) || 1;
        const name = item.product && item.product.name || '';
        if (hasCarne && isChapaItem(item)) plateMinutes += qty * (name.includes('Picanha') ? prepTimeSettings.incrementPicanha : prepTimeSettings.incrementCarne);
        if (hasCaldo && isCaldoItem(item)) brothMinutes += qty * prepTimeSettings.incrementCaldo;
    }));
    return Math.max(plateMinutes, brothMinutes, 1);
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

function renderAll() {
    updateKitchenCounters();
    renderQueueMetrics();

    const containers = [els.pratosFilaContainer, els.pratosPreparoContainer, els.pratosProntoContainer,
        els.caldosFilaContainer, els.caldosPreparoContainer, els.caldosProntoContainer,
        els.entreguesContainer, els.chapeiroContainer];
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

        const pratosFila = [], pratosPreparo = [], pratosPronto = [];
        const caldosFila = [], caldosPreparo = [], caldosPronto = [];
        const entregueItems = [];
        const chapaItems = [];

        pedido.items.forEach(item => {
            const st = item.status || 'fila';
            if (isChapaItem(item)) {
                if (st === 'fila') pratosFila.push(item);
                if (st === 'em_preparo') pratosPreparo.push(item);
                if (st === 'pronto') pratosPronto.push(item);
                if (['fila', 'em_preparo'].includes(st)) chapaItems.push(item);
            }
            if (isCaldoItem(item)) {
                if (st === 'fila') caldosFila.push(item);
                if (st === 'em_preparo') caldosPreparo.push(item);
                if (st === 'pronto') caldosPronto.push(item);
            }
            if (st === 'entregue') entregueItems.push(item);
        });

        if (pratosFila.length) renderCard(pedido, pratosFila, 'pratos-fila', els.pratosFilaContainer);
        if (pratosPreparo.length) renderCard(pedido, pratosPreparo, 'pratos-preparo', els.pratosPreparoContainer);
        if (pratosPronto.length) renderCard(pedido, pratosPronto, 'pratos-pronto', els.pratosProntoContainer);
        if (caldosFila.length) renderCard(pedido, caldosFila, 'caldos-fila', els.caldosFilaContainer);
        if (caldosPreparo.length) renderCard(pedido, caldosPreparo, 'caldos-preparo', els.caldosPreparoContainer);
        if (caldosPronto.length) renderCard(pedido, caldosPronto, 'caldos-pronto', els.caldosProntoContainer);
        if (entregueItems.length > 0 || pedido.deliveredAt) renderCard(pedido, entregueItems.length > 0 ? entregueItems : pedido.items, 'entregues', els.entreguesContainer);
        if (chapaItems.length > 0) renderCard(pedido, chapaItems, 'chapeiro', els.chapeiroContainer);
    });

    const visibleContainers = currentTab === 'pratos'
        ? [els.pratosFilaContainer, els.pratosPreparoContainer, els.pratosProntoContainer]
        : currentTab === 'caldos' ? [els.caldosFilaContainer, els.caldosPreparoContainer, els.caldosProntoContainer]
        : currentTab === 'chapeiro' ? [els.chapeiroContainer] : [els.entreguesContainer];
    els.emptyState.classList.toggle('hidden', visibleContainers.some(container => container && container.children.length > 0));
}

function escapeKitchenHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
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
    const now = Date.now();
    (pedido.items || []).forEach(item => {
        item.status = 'entregue';
        item.deliveredAt = now;
    });
    pedido.deliveredAt = now;
    pedido.updatedAt = now;
    globalOrders[pedido.id] = pedido;
    saveStoredOrders();
    reconcileDeliveredBeverages();
    publishUpdate({ type: 'ORDER_UPDATE', order: pedido }, false);
    renderAll();
}

if (els.closeEditOrderBtn) els.closeEditOrderBtn.onclick = closeEditOrder;
if (els.openFullOrderEditorBtn) {
    els.openFullOrderEditorBtn.onclick = () => {
        const pedido = globalOrders[editingOrderId];
        if (!pedido) return;
        let atendimentoOrders = {};
        try { atendimentoOrders = JSON.parse(localStorage.getItem('canela_atendimento_orders')) || {}; } catch (error) { atendimentoOrders = {}; }
        atendimentoOrders[pedido.id] = pedido;
        localStorage.setItem('canela_atendimento_orders', JSON.stringify(atendimentoOrders));
        localStorage.setItem('canela_open_order_id', pedido.id);
        window.location.href = 'index.html?editar=' + encodeURIComponent(pedido.id);
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
        rows.forEach((row, index) => {
            const item = pedido.items[index];
            if (!item) return;
            if (row.querySelector('.edit-item-remove').checked) {
                if (item.id) removedIds.add(item.id);
                return;
            }
            item.qty = Math.max(1, Number(row.querySelector('.edit-item-qty').value) || 1);
            item.consumption = row.querySelector('.edit-item-consumption').value;
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
            pedido.items.forEach(item => {
                item.status = requestedStatus;
                if (requestedStatus === 'entregue') item.deliveredAt = statusChangedAt;
                else delete item.deliveredAt;
                if (requestedStatus === 'fila' && !item.queuedAt) item.queuedAt = getOrderQueueTime(pedido);
            });
            if (requestedStatus === 'entregue') pedido.deliveredAt = statusChangedAt;
            else delete pedido.deliveredAt;
        }
        pedido.obs = els.editOrderObs.value.trim();
        pedido.items = updatedItems;
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
    if (tabType === 'entregues') {
        card.style.borderColor = "#27ae60";
        card.style.opacity = "0.85";
    }

    let itemsHTML = '';
    itemsArr.forEach(item => {
        itemsHTML += renderKitchenItem(item);
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
    const isOperational = tabType.startsWith('pratos-') || tabType.startsWith('caldos-') || tabType === 'chapeiro';
    const isQueue = tabType.endsWith('-fila');
    const isPrep = tabType.endsWith('-preparo');
    const isReady = tabType.endsWith('-pronto');
    const queuePosition = isQueue ? getOrderQueuePosition(pedido) : null;
    const queuePositionHTML = queuePosition
        ? `<span class="queue-position-badge" title="Posição operacional considerando prioridade e horário">Fila: ${queuePosition}º</span>`
        : '';
    if (isOperational) {
        const estimateMinutes = getEstimatedPrepMinutes(pedido);
        const queueStartedAt = getOrderQueueTime(pedido);
        const estimatedDeadline = queueStartedAt + estimateMinutes * 60000;
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
        ${tabType === 'chapeiro' ? `<div class="chapeiro-readonly-hint">👁️ Visualização operacional — a finalização é feita no painel da cozinha.</div>` : ''}
        ${isQueue ? `<div class="order-footer"><div class="order-footer-actions five-actions"><button class="edit-order-btn icon-action-btn" title="Editar pedido" aria-label="Editar pedido">✏️</button><button class="start-prep-btn icon-action-btn" title="Iniciar preparo" aria-label="Iniciar preparo">▶️</button><button class="mark-ready-btn icon-action-btn" title="Marcar como pronto" aria-label="Marcar como pronto">✅</button><button class="deliver-lane-btn icon-action-btn" title="Entregar pedido" aria-label="Entregar pedido">📦</button><button class="delete-kitchen-order-btn icon-action-btn" title="Excluir pedido definitivamente" aria-label="Excluir pedido definitivamente">🗑️</button></div></div>` : ''}
        ${isPrep ? `<div class="order-footer"><div class="order-footer-actions four-actions"><button class="edit-order-btn icon-action-btn" title="Editar pedido" aria-label="Editar pedido">✏️</button><button class="mark-ready-btn icon-action-btn" title="Marcar como pronto" aria-label="Marcar como pronto">✅</button><button class="deliver-lane-btn icon-action-btn" title="Entregar pedido" aria-label="Entregar pedido">📦</button><button class="delete-kitchen-order-btn icon-action-btn" title="Excluir pedido definitivamente" aria-label="Excluir pedido definitivamente">🗑️</button></div></div>` : ''}
        ${isReady ? `<div class="order-footer"><div class="order-footer-actions three-actions"><button class="edit-order-btn icon-action-btn" title="Editar pedido" aria-label="Editar pedido">✏️</button><button class="deliver-lane-btn icon-action-btn" title="Confirmar entrega" aria-label="Confirmar entrega">📦</button><button class="delete-kitchen-order-btn icon-action-btn" title="Excluir pedido definitivamente" aria-label="Excluir pedido definitivamente">🗑️</button></div></div>` : ''}
        ${tabType === 'entregues' ? `<div class="order-footer"><div class="order-footer-actions two-actions"><button class="edit-order-btn icon-action-btn" title="Editar pedido" aria-label="Editar pedido">✏️</button><button class="delete-kitchen-order-btn icon-action-btn" title="Excluir pedido definitivamente" aria-label="Excluir pedido definitivamente">🗑️</button></div></div>` : ''}
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
    if (editButton) editButton.onclick = () => openEditOrder(pedido);
    const deleteButton = card.querySelector('.delete-kitchen-order-btn');
    if (deleteButton) deleteButton.onclick = () => deleteOrderPermanently(pedido);

    if (isOperational) {
        const timeWaitEl = card.querySelector(`#time-wait-${pedido.id}-${tabType}`);
        const timeEstimateEl = card.querySelector(`#time-estimate-${pedido.id}-${tabType}`);
        const estimateMinutes = getEstimatedPrepMinutes(pedido);
        const estimateDeadline = getOrderQueueTime(pedido) + estimateMinutes * 60000;
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

        const updateItemsStatus = status => {
            const now = Date.now();
            itemsArr.forEach(item => { item.status = status; if (status === 'em_preparo') item.preparationStartedAt ||= now; if (status === 'pronto') item.readyAt = now; });
            pedido.updatedAt = now;
            globalOrders[pedido.id] = pedido;
            saveStoredOrders();
            publishUpdate({ type: 'ORDER_UPDATE', order: pedido }, false);
            renderAll();
        };
        const startButton = card.querySelector('.start-prep-btn');
        if (startButton) startButton.onclick = () => updateItemsStatus('em_preparo');
        const readyButton = card.querySelector('.mark-ready-btn');
        if (readyButton) readyButton.onclick = () => updateItemsStatus('pronto');
        const deliverButton = card.querySelector('.deliver-lane-btn');
        if (deliverButton) deliverButton.onclick = () => markOrderDelivered(pedido);
    }

    containerTarget.append(card);
}

function renderKitchenItem(item) {
    const name = item.product && item.product.name ? item.product.name : 'Item sem nome';
    const qty = Number(item.qty) || 1;
    const consumptionMatch = name.match(/-\s(Comer no Local|Para Levar)$/);
    const consumption = item.consumption === 'levar' ? 'Para Levar' : item.consumption === 'local' ? 'Comer no Local' : consumptionMatch ? consumptionMatch[1] : 'Comer no Local';

    if (name.includes(' na Chapa + ')) {
        const baseName = name.split(' + ')[0];
        const riceMatch = name.match(/\+\s(.+?)\s\[(?:TIRAR:|COMPLETO)/);
        const removeMatch = name.match(/\[TIRAR:\s*([^\]]+)\]/);
        const removed = removeMatch ? removeMatch[1].split(',').map(value => value.trim()) : [];
        const defaults = baseName.includes('Picanha')
            ? ['Tropeiro', 'Salada', 'Vinagrete', 'Farofa', 'Macaxeira', 'Maionese', 'Batata Palha', 'Vatapá']
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
                ${preparation}
            </span>
            <span class="prep-location ${consumption === 'Para Levar' ? 'to-go' : ''}">${consumption === 'Para Levar' ? '🛍️ PARA LEVAR' : '🍽️ COMER NO LOCAL'}</span>
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
        </li>`;
    }

    return `<li><span class="item-qty">${qty}x</span><span class="item-name">${name}</span></li>`;
}

// Inicializa Aba Padrão Fila
setupPrepSettings();
switchTab('pratos');
hydrateKitchenOrders();
setInterval(renderQueueMetrics, 30000);

// --- WAKE LOCK E SINCRONIZAÇÃO EM SEGUNDO PLANO ---
let wakeLock = null;
async function keepScreenAlive() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) { }
}

function handleKitchenResume() {
    globalOrders = loadStoredOrders();
    renderAll();
    keepScreenAlive();

    if (mqttClient && mqttClient.connected) {
        publishUpdate({ type: 'REQUEST_SYNC' }, false);
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
    kitchenMqttOnline = false;
    els.status.textContent = '● SEM INTERNET';
    els.status.className = 'status-offline';
});
setInterval(() => {
    if (!navigator.onLine && kitchenMqttOnline) {
        kitchenMqttOnline = false;
        els.status.textContent = '● SEM INTERNET';
        els.status.className = 'status-offline';
    }
}, 1000);
setInterval(() => {
    if (mqttClient && mqttClient.connected) flushKitchenOutbox();
}, 3000);
setInterval(() => {
    if (mqttClient && mqttClient.connected) publishUpdate({ type: 'REQUEST_SYNC' }, false);
}, 30000);

document.body.addEventListener('click', keepScreenAlive);
document.body.addEventListener('touchstart', keepScreenAlive);

// --- GESTOR DE ESTOQUE DE BEBIDAS ---
const beverageNames = [
    'Coca-Cola Lata', 'Coca-Cola Zero Lata', 'Fanta Uva Lata', 'Fanta Laranja Lata',
    'Coca-Cola 1L', 'Fanta Uva 1L', 'Fanta Laranja 1L', 'Baré 1L',
    'Suco de Goiaba', 'Suco de Açerola', 'Suco de Maracujá',
    'Água Mineral', 'Redbull', 'Monster'
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
    if (broadcast) publishStockSnapshot(true);
}

function publishStockSnapshot(reliable = true) {
    if (typeof beverageStock === 'undefined') return;
    const payload = { type: 'STOCK_UPDATE', stock: beverageStock };
    if (reliable) {
        publishUpdate(payload, false);
    } else if (mqttClient && mqttClient.connected) {
        mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 });
    }
}

function receiveStockSnapshot(stock) {
    if (!stock || !stock.items) return;
    const incomingRevision = Number(stock.updatedAt || 0);
    const currentRevision = Number(beverageStock.updatedAt || 0);
    if (incomingRevision < currentRevision) return;
    beverageStock = stock;
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
