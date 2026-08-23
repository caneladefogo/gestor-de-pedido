const DB = {
    products: [
        { id: 1, name: "Carne de Sol na Chapa", desc: "Montar Prato", price: 25.00, dynamic: "prato", category: "Pratos" },
        { id: 2, name: "Picanha na Chapa", desc: "Montar Prato", price: 35.00, dynamic: "prato", category: "Pratos" },

        { id: 3, name: "Caldo", desc: "Montar Caldo", price: 0.00, dynamic: "caldo", category: "Caldos" },

        { id: 4, name: "Coca-Cola Lata", desc: "350ml", price: 6.00, category: "Refrigerantes" },
        { id: 5, name: "Coca-Cola Zero Lata", desc: "350ml", price: 6.00, category: "Refrigerantes" },
        { id: 6, name: "Fanta Uva Lata", desc: "350ml", price: 6.00, category: "Refrigerantes" },
        { id: 7, name: "Fanta Laranja Lata", desc: "350ml", price: 6.00, category: "Refrigerantes" },

        { id: 8, name: "Coca-Cola 1L", desc: "1 Litro", price: 12.00, category: "Refrigerantes" },
        { id: 9, name: "Fanta Uva 1L", desc: "1 Litro", price: 12.00, category: "Refrigerantes" },
        { id: 10, name: "Fanta Laranja 1L", desc: "1 Litro", price: 12.00, category: "Refrigerantes" },
        { id: 11, name: "Baré 1L", desc: "1 Litro", price: 10.00, category: "Refrigerantes" },

        { id: 12, name: "Suco de Goiaba", desc: "Tamanho Único", price: 8.00, category: "Sucos" },
        { id: 13, name: "Suco de Açerola", desc: "Tamanho Único", price: 8.00, category: "Sucos" },
        { id: 14, name: "Suco de Maracujá", desc: "Tamanho Único", price: 8.00, category: "Sucos" },

        { id: 15, name: "Água Mineral", desc: "", price: 5.00, category: "Outras Bebidas" },
        { id: 16, name: "Redbull", desc: "Lata", price: 12.00, category: "Outras Bebidas" },
        { id: 17, name: "Monster", desc: "Lata", price: 12.00, category: "Outras Bebidas" }
    ]
};

// --- ESTADO GLOBAL DO ATENDIMENTO ---
let waiterName = localStorage.getItem('canela_waiter_name') || "";
let currentOrder = null;
let historyClearedAt = Number(localStorage.getItem('canela_history_cleared_at')) || 0;
let deletedOrderIds = loadDeletedOrderIds();
let globalActiveOrders = loadStoredOrders();
let globalSenhaCount = parseInt(localStorage.getItem('canela_senha'), 10) || 0;
let activeCategory = "Todos";
let currentWaiterTab = 'fila';
let searchQuery = "";
let selectedOrderDetail = null;
let selectedTipoConsumo = "local"; // 'local' ou 'levar'
let beverageStockState = loadBeverageStockState();
let kitchenConfirmations = loadKitchenConfirmations();

function loadKitchenConfirmations() {
    try { return JSON.parse(localStorage.getItem('canela_kitchen_confirmations')) || {}; }
    catch (error) { return {}; }
}

function trackKitchenConfirmation(payload) {
    const order = payload && payload.order;
    if (!order || !order.id) return;
    kitchenConfirmations[order.id] = { payload, updatedAt: order.updatedAt, lastSentAt: Date.now(), attempts: 1 };
    localStorage.setItem('canela_kitchen_confirmations', JSON.stringify(kitchenConfirmations));
}

function confirmKitchenReceipt(orderId, updatedAt) {
    const pending = kitchenConfirmations[orderId];
    if (!pending || Number(updatedAt || 0) < Number(pending.updatedAt || 0)) return;
    delete kitchenConfirmations[orderId];
    localStorage.setItem('canela_kitchen_confirmations', JSON.stringify(kitchenConfirmations));
}

function loadBeverageStockState() {
    try {
        return JSON.parse(localStorage.getItem('canela_beverage_stock_view')) || null;
    } catch (error) {
        return null;
    }
}

// --- PERSISTÊNCIA LOCAL ---
function loadStoredOrders() {
    try {
        const raw = localStorage.getItem('canela_atendimento_orders');
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        const normalized = {};
        for (let key in parsed) {
            const ord = parsed[key];
            if (deletedOrderIds[ord.id || key]) continue;
            if (shouldSuppressDeliveredOrder(ord)) continue;
            const safeKey = ord.id || ord.senha || key;
            if (!ord.id) ord.id = safeKey;
            normalized[safeKey] = ord;
        }
        return normalized;
    } catch (e) {
        console.error("Erro ao carregar pedidos:", e);
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
        delete globalActiveOrders[id];
    });
    localStorage.setItem('canela_deleted_order_ids', JSON.stringify(deletedOrderIds));
    saveStoredOrders();
}

function deleteOrderPermanently(order) {
    if (!order || !order.id) return;
    if (!confirm(`Excluir definitivamente o pedido #${order.senha || '—'} de ${order.clientName || 'Cliente'}? Esta ação não pode ser desfeita.`)) return;
    const deletedAt = Date.now();
    applyDeletedOrderMarkers({ [order.id]: deletedAt });
    publishMQTT({ type: 'DELETE_ORDER', orderId: order.id, deletedAt });
    if (currentOrder && currentOrder.id === order.id) currentOrder = null;
    renderActiveOrders();
}

function isFullyDelivered(order) {
    return Boolean(order && ((order.items || []).length > 0 && order.items.every(item => item.status === 'entregue') || order.deliveredAt));
}

function shouldSuppressDeliveredOrder(order) {
    if (!historyClearedAt || !isFullyDelivered(order)) return false;
    const completedAt = Number(order.deliveredAt || order.updatedAt || order.timestamp || 0);
    return completedAt <= historyClearedAt;
}

function applyHistoryClear(clearedAt = Date.now()) {
    historyClearedAt = Math.max(historyClearedAt, Number(clearedAt) || Date.now());
    localStorage.setItem('canela_history_cleared_at', String(historyClearedAt));
    for (const key in globalActiveOrders) {
        if (shouldSuppressDeliveredOrder(globalActiveOrders[key])) delete globalActiveOrders[key];
    }
    saveStoredOrders();
}

function saveStoredOrders() {
    try {
        localStorage.setItem('canela_atendimento_orders', JSON.stringify(globalActiveOrders));
        if (window.CanelaPersistence) {
            CanelaPersistence.saveSnapshot('atendimento_orders', globalActiveOrders);
        }
    } catch (e) {
        console.error("Erro ao salvar pedidos:", e);
    }
}

async function hydratePersistentOrders() {
    if (!window.CanelaPersistence) return;
    const persisted = await CanelaPersistence.loadSnapshot('atendimento_orders');
    if (!persisted || typeof persisted !== 'object') return;
    Object.values(persisted).forEach(order => processIncomingOrder(order, false));
    saveStoredOrders();
    renderActiveOrders();
    openRequestedOrderEditor();
}

function openRequestedOrderEditor() {
    const requestedId = new URLSearchParams(window.location.search).get('editar') || localStorage.getItem('canela_open_order_id');
    if (!requestedId || !globalActiveOrders[requestedId]) return;
    const order = globalActiveOrders[requestedId];
    if (!waiterName) {
        waiterName = order.waiterName || 'Cozinha';
        localStorage.setItem('canela_waiter_name', waiterName);
        updateWaiterDisplay();
    }
    localStorage.removeItem('canela_open_order_id');
    openExistingOrder(order);
}

// --- SISTEMA DE ÁUDIO E ALARME CONTÍNUO ---
let waiterAudioCtx = null;
let alarmInterval = null;
let isAlarmRinging = false;

function unlockAudio() {
    if (!waiterAudioCtx) {
        waiterAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (waiterAudioCtx && waiterAudioCtx.state === 'suspended') {
        waiterAudioCtx.resume();
    }
}

document.body.addEventListener('click', unlockAudio);
document.body.addEventListener('touchstart', unlockAudio);

function playAlarmChime() {
    unlockAudio();
    if (!waiterAudioCtx) return;

    try {
        const notes = [784.00, 987.77, 1318.51, 1567.98];
        const now = waiterAudioCtx.currentTime;

        notes.forEach((freq, idx) => {
            const osc = waiterAudioCtx.createOscillator();
            const gain = waiterAudioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + (idx * 0.1));

            gain.gain.setValueAtTime(0, now + (idx * 0.1));
            gain.gain.linearRampToValueAtTime(0.7, now + (idx * 0.1) + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.01, now + (idx * 0.1) + 0.4);

            osc.connect(gain);
            gain.connect(waiterAudioCtx.destination);

            osc.start(now + (idx * 0.1));
            osc.stop(now + (idx * 0.1) + 0.45);
        });

        if (navigator.vibrate) {
            navigator.vibrate([400, 150, 400, 150, 400]);
        }
    } catch (e) {
        console.warn("Áudio não pôde ser reproduzido:", e);
    }
}

function startContinuousAlarm(msg) {
    if (els.waiterNotifMsg) els.waiterNotifMsg.textContent = msg;
    if (els.waiterNotifOverlay) els.waiterNotifOverlay.classList.remove('hidden');

    if (isAlarmRinging) return;
    isAlarmRinging = true;

    playAlarmChime();
    alarmInterval = setInterval(playAlarmChime, 1300);
}

function stopContinuousAlarm() {
    isAlarmRinging = false;
    if (alarmInterval) {
        clearInterval(alarmInterval);
        alarmInterval = null;
    }
    if (els.waiterNotifOverlay) {
        els.waiterNotifOverlay.classList.add('hidden');
    }
    if (navigator.vibrate) {
        navigator.vibrate(0);
    }
}

// --- CONFIGURAÇÃO MQTT E SINCRONIZAÇÃO EM SEGUNDO PLANO ---
const mqttTopic = 'caneladefogo/pedidos/sync';
let mqttClient = null;
let mqttIsOnline = false;
const uniquePhoneClientId = 'canela_waiter_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now();

function setConnectionStatus(online) {
    mqttIsOnline = online;
    refreshConnectionStatus();
}

async function refreshConnectionStatus() {
    const el = document.getElementById('conn-status');
    if (!el) return;
    const pending = window.CanelaPersistence
        ? (await CanelaPersistence.listPending('atendimento')).length
        : 0;
    if (!navigator.onLine) {
        el.textContent = pending > 0 ? `● Sem internet • ${pending} pendente(s)` : '● Sem internet';
        el.className = pending > 0 ? 'status-badge status-pending' : 'status-badge status-offline';
    } else if (mqttIsOnline && pending === 0) {
        el.textContent = '● Online • Sincronizado';
        el.className = 'status-badge status-online';
    } else if (pending > 0) {
        el.textContent = `● ${pending} envio(s) pendente(s)`;
        el.className = 'status-badge status-pending';
    } else {
        el.textContent = '● Reconectando...';
        el.className = 'status-badge status-offline';
    }
}

function initMQTT() {
    if (typeof mqtt === 'undefined') return;

    try {
        mqttClient = mqtt.connect('wss://broker.hivemq.com:8884/mqtt', {
            clientId: uniquePhoneClientId,
            keepalive: 60,
            reconnectPeriod: 2000,
            clean: true
        });

        mqttClient.on('connect', () => {
            setConnectionStatus(true);
            mqttClient.subscribe(mqttTopic, (err) => {
                if (!err) {
                    publishMQTT({ type: 'REQUEST_SYNC' });
                    flushWaiterOutbox();
                }
            });
        });

        mqttClient.on('reconnect', () => setConnectionStatus(false));
        mqttClient.on('close', () => setConnectionStatus(false));
        mqttClient.on('offline', () => setConnectionStatus(false));
        mqttClient.on('error', () => setConnectionStatus(false));

        mqttClient.on('message', (t, msg) => {
            try {
                if (t !== mqttTopic) return;
                const data = JSON.parse(msg.toString());

                if (data.type === 'REQUEST_SYNC') {
                    const list = Object.values(globalActiveOrders);
                    publishMQTT({ type: 'SYNC_ALL_ORDERS', orders: list, historyClearedAt, deletedOrderIds });
                    return;
                }

                if (data.type === 'SYNC_ALL_ORDERS' && Array.isArray(data.orders)) {
                    applyDeletedOrderMarkers(data.deletedOrderIds);
                    if (data.historyClearedAt) applyHistoryClear(data.historyClearedAt);
                    data.orders.forEach(order => processIncomingOrder(order, false));
                    saveStoredOrders();
                    renderActiveOrders();
                    return;
                }

                if (data.type === 'CLEAR_HISTORY') {
                    applyHistoryClear(data.clearedAt);
                    renderActiveOrders();
                    return;
                }

                if (data.type === 'DELETE_ORDER' && data.orderId) {
                    applyDeletedOrderMarkers({ [data.orderId]: data.deletedAt || Date.now() });
                    renderActiveOrders();
                    return;
                }

                if (data.type === 'ORDER_RECEIVED_ACK' && data.orderId) {
                    confirmKitchenReceipt(data.orderId, data.updatedAt);
                    return;
                }

                if (data.type === 'RESET_PASSWORDS') {
                    globalSenhaCount = 0;
                    localStorage.setItem('canela_senha', '0');
                    localStorage.setItem('canela_senha_date', data.date || new Date().toLocaleDateString('en-CA'));
                    localStorage.setItem('canela_senha_reset_at', String(data.resetAt || Date.now()));
                    return;
                }

                if (data.type === 'STOCK_UPDATE' && data.stock && data.stock.items) {
                    const incomingRevision = Number(data.stock.updatedAt || 0);
                    const currentRevision = Number(beverageStockState && beverageStockState.updatedAt || 0);
                    if (!beverageStockState || incomingRevision >= currentRevision) {
                        beverageStockState = data.stock;
                        localStorage.setItem('canela_beverage_stock_view', JSON.stringify(beverageStockState));
                        renderProducts();
                    }
                    return;
                }

                const orderData = data.order || data;
                if (orderData && (orderData.id || orderData.senha)) {
                    processIncomingOrder(orderData, true);
                    saveStoredOrders();
                    renderActiveOrders();
                }

            } catch (e) {
                console.error("Erro no processamento da mensagem:", e);
            }
        });
    } catch (e) {
        console.error("Erro MQTT:", e);
    }
}

async function publishMQTT(payload) {
    const reliable = payload && (payload.type === 'ORDER_UPDATE' || payload.type === 'CLEAR_HISTORY' || payload.type === 'DELETE_ORDER');
    if (reliable && window.CanelaPersistence) {
        const queued = await CanelaPersistence.enqueue('atendimento', payload);
        if (queued) {
            refreshConnectionStatus();
            flushWaiterOutbox();
            return;
        }
    }
    if (mqttClient && mqttClient.connected) mqttClient.publish(mqttTopic, JSON.stringify(payload), { qos: 1 });
}

let waiterOutboxFlushing = false;
async function flushWaiterOutbox() {
    if (waiterOutboxFlushing || !window.CanelaPersistence || !mqttClient || !mqttClient.connected) return;
    waiterOutboxFlushing = true;
    try {
        const pending = await CanelaPersistence.listPending('atendimento');
        for (const entry of pending) {
            if (!mqttClient.connected) break;
            await new Promise((resolve, reject) => {
                mqttClient.publish(mqttTopic, JSON.stringify(entry.payload), { qos: 1 }, error => error ? reject(error) : resolve());
            });
            await CanelaPersistence.removePending(entry.id);
            refreshConnectionStatus();
        }
    } catch (error) {
        console.warn('Envios do atendimento continuarão pendentes:', error);
    } finally {
        waiterOutboxFlushing = false;
        if (mqttClient && mqttClient.connected) {
            const remaining = await CanelaPersistence.listPending('atendimento');
            if (remaining.length > 0) setTimeout(flushWaiterOutbox, 0);
        }
    }
}

function processIncomingOrder(orderData, notifyIfReady) {
    if (!orderData.id) {
        orderData.id = `ord_${orderData.senha}_${orderData.timestamp || Date.now()}`;
    }
    if (deletedOrderIds[orderData.id]) return;
    if (shouldSuppressDeliveredOrder(orderData)) {
        delete globalActiveOrders[orderData.id];
        return;
    }

    const incSenha = parseInt(orderData.senha, 10);
    if (!isNaN(incSenha) && incSenha >= globalSenhaCount) {
        globalSenhaCount = incSenha;
        localStorage.setItem('canela_senha', globalSenhaCount);
    }

    const existing = globalActiveOrders[orderData.id];
    orderData = window.mergeCanelaOrders ? mergeCanelaOrders(existing, orderData) : orderData;
    let hasNewPronto = false;

    if (existing && notifyIfReady) {
        const oldPronto = existing.items.filter(i => i.status === 'pronto').length;
        const newPronto = orderData.items.filter(i => i.status === 'pronto').length;

        const matchesWaiter = !orderData.waiterName || !waiterName || orderData.waiterName.toLowerCase() === waiterName.toLowerCase();
        if (newPronto > oldPronto && matchesWaiter) {
            hasNewPronto = true;
        }
    } else if (!existing && notifyIfReady) {
        const prontoCount = orderData.items.filter(i => i.status === 'pronto').length;
        const matchesWaiter = !orderData.waiterName || !waiterName || orderData.waiterName.toLowerCase() === waiterName.toLowerCase();
        if (prontoCount > 0 && matchesWaiter) {
            hasNewPronto = true;
        }
    }

    globalActiveOrders[orderData.id] = orderData;

    if (hasNewPronto && notifyIfReady) {
        startContinuousAlarm(`📣 Chame ${orderData.clientName}! Senha #${orderData.senha}. O pedido está pronto.`);
    }
}

// --- RECONEXÃO E RESSINCRONIZAÇÃO AUTOMÁTICA AO RETORNAR PARA O APP ---
function handleAppResume() {
    globalActiveOrders = loadStoredOrders();
    renderActiveOrders();
    openRequestedOrderEditor();

    keepScreenAlive();
    unlockAudio();

    if (mqttClient && mqttClient.connected) {
        publishMQTT({ type: 'REQUEST_SYNC' });
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        handleAppResume();
    }
});

window.addEventListener('pageshow', handleAppResume);
window.addEventListener('focus', handleAppResume);
window.addEventListener('online', handleAppResume);
window.addEventListener('offline', () => setConnectionStatus(false));
setInterval(() => {
    if (!navigator.onLine && mqttIsOnline) setConnectionStatus(false);
}, 1000);
setInterval(() => {
    if (mqttClient && mqttClient.connected) flushWaiterOutbox();
}, 3000);
setInterval(() => {
    if (!mqttClient || !mqttClient.connected) return;
    Object.values(kitchenConfirmations).forEach(entry => {
        if (Date.now() - Number(entry.lastSentAt || 0) < 5000) return;
        mqttClient.publish(mqttTopic, JSON.stringify(entry.payload), { qos: 1 });
        entry.lastSentAt = Date.now();
        entry.attempts = (Number(entry.attempts) || 0) + 1;
    });
    localStorage.setItem('canela_kitchen_confirmations', JSON.stringify(kitchenConfirmations));
}, 5000);
setInterval(() => {
    if (mqttClient && mqttClient.connected) publishMQTT({ type: 'REQUEST_SYNC' });
}, 30000);

// Auto-remove badges do Netlify injetadas
setInterval(() => {
    document.querySelectorAll('iframe[src*="netlify"], div[class*="netlify"], #netlify-badge, .netlify-badge, [data-netlify-drawer], [class*="drawer"]').forEach(el => {
        try { el.remove(); } catch(e) {}
    });
}, 500);

// --- CONTROLE DE TIPO DE CONSUMO (Local vs Levar) ---
window.setOrderTipoConsumo = function (tipo) {
    selectedTipoConsumo = tipo;
};

// --- ELEMENTOS DO DOM ---
const els = {
    waiterDisplay: document.getElementById('waiter-display'),
    loginScreen: document.getElementById('login-screen'),
    waiterNameInput: document.getElementById('waiter-name-input'),
    btnLogin: document.getElementById('btn-login'),

    activeOrdersScreen: document.getElementById('active-orders-screen'),
    activeOrdersContainer: document.getElementById('active-orders-container'),
    btnNewOrder: document.getElementById('btn-new-order'),
    btnNewQuickOrder: document.getElementById('btn-new-quick-order'),
    waiterFilter: document.getElementById('waiter-filter'),
    orderSearchInput: document.getElementById('order-search-input'),

    badgeFila: document.getElementById('badge-fila'),
    badgePronto: document.getElementById('badge-pronto'),
    badgeEntregue: document.getElementById('badge-entregue'),

    historySummaryBar: document.getElementById('history-summary-bar'),
    histTotalCount: document.getElementById('hist-total-count'),
    btnClearHistory: document.getElementById('btn-clear-history'),

    newOrderModal: document.getElementById('new-order-modal'),
    newOrderClient: document.getElementById('new-order-client'),
    newOrderFeature: document.getElementById('new-order-feature'),
    newOrderPriority: document.getElementById('new-order-priority'),
    btnCreateOrder: document.getElementById('btn-create-order'),
    btnCancelNewOrder: document.getElementById('btn-cancel-new-order'),
    quickOrderModal: document.getElementById('quick-order-modal'),
    btnStartQuickOrder: document.getElementById('btn-start-quick-order'),
    btnCancelQuickOrder: document.getElementById('btn-cancel-quick-order'),

    productsContainer: document.getElementById('products-container'),
    categoriesContainer: document.getElementById('categories-container'),
    screenMenu: document.getElementById('menu-screen'),
    backToOrdersBtn: document.getElementById('back-to-orders'),
    menuOrderTitle: document.getElementById('menu-order-title'),
    menuRunningTotal: document.getElementById('menu-running-total'),

    cartBar: document.getElementById('cart-bar'),
    cartCount: document.getElementById('cart-count'),
    cartBarTotal: document.getElementById('cart-bar-total'),
    viewCartBtn: document.getElementById('view-cart-btn'),
    cartModal: document.getElementById('cart-modal'),
    closeCartBtn: document.getElementById('close-cart'),
    cartItemsContainer: document.getElementById('cart-items-container'),
    cartModalTableTitle: document.getElementById('cart-modal-table'),
    checkoutBtn: document.getElementById('checkout-btn'),
    quickOrderBtn: document.getElementById('quick-order-btn'),
    cartNotes: document.getElementById('cart-notes'),
    paymentReceived: document.getElementById('payment-received'),
    changeResult: document.getElementById('change-result'),
    cartTotalSummary: document.getElementById('cart-total-summary'),
    toggleChangeBtn: document.getElementById('toggle-change-btn'),
    changePanel: document.getElementById('change-panel'),

    orderDetailModal: document.getElementById('order-detail-modal'),
    detailModalTitle: document.getElementById('detail-modal-title'),
    detailModalBody: document.getElementById('detail-modal-body'),
    closeDetailModal: document.getElementById('close-detail-modal'),
    btnReopenOrder: document.getElementById('btn-reopen-order'),

    waiterNotifOverlay: document.getElementById('waiter-notif-overlay'),
    waiterNotifMsg: document.getElementById('waiter-notif-msg'),
    btnIndoBuscar: document.getElementById('btn-indo-buscar'),

    optionsModal: document.getElementById('options-modal'),
    modalOptionsTitle: document.getElementById('modal-options-title'),
    optionsModalBody: document.getElementById('options-modal-body'),
    btnConfirmOptions: document.getElementById('btn-confirm-options'),
    btnCancelOptions: document.getElementById('btn-cancel-options')
};

// --- SELEÇÃO RÁPIDA DE ATENDENTE (Emanuel, João, Joana, Jeferson) ---
window.selectWaiterName = function (name) {
    if (!name) return;
    waiterName = name.trim();
    localStorage.setItem('canela_waiter_name', waiterName);
    updateWaiterDisplay();
    els.loginScreen.classList.remove('view-active');
    els.activeOrdersScreen.classList.add('view-active');
    renderActiveOrders();
    keepScreenAlive();
    unlockAudio();
};

function updateWaiterDisplay() {
    if (waiterName) {
        els.waiterDisplay.innerHTML = `👤 Atendente: <strong>${waiterName}</strong> <span style="font-size:0.8rem; text-decoration:underline; opacity:0.8;">(Trocar)</span>`;
    } else {
        els.waiterDisplay.innerHTML = `👤 Atendente: <strong>Nenhum</strong>`;
    }
}

function init() {
    renderCategories();
    renderProducts();
    setupEventListeners();
    initMQTT();

    if (waiterName) {
        updateWaiterDisplay();
        els.loginScreen.classList.remove('view-active');
        els.activeOrdersScreen.classList.add('view-active');
    }

    els.waiterDisplay.style.cursor = 'pointer';
    els.waiterDisplay.onclick = () => {
        els.activeOrdersScreen.classList.remove('view-active');
        els.screenMenu.classList.remove('view-active');
        els.loginScreen.classList.add('view-active');
        if (els.waiterNameInput) els.waiterNameInput.value = waiterName;
    };

    renderActiveOrders();
    keepScreenAlive();
    hydratePersistentOrders();
}

window.switchWaiterTab = function (tab) {
    currentWaiterTab = tab;
    document.querySelectorAll('.wtab-btn').forEach(btn => {
        btn.style.background = '#444';
        btn.style.color = 'white';
    });
    const activeBtn = document.getElementById(`wtab-${tab}`);
    if (activeBtn) {
        activeBtn.style.background = 'var(--primary-color)';
        activeBtn.style.color = '#000';
    }

    if (els.historySummaryBar) {
        if (tab === 'entregue') {
            els.historySummaryBar.classList.remove('hidden');
        } else {
            els.historySummaryBar.classList.add('hidden');
        }
    }

    renderActiveOrders();
};

function updateTabBadges() {
    const filterVal = els.waiterFilter ? els.waiterFilter.value : 'meus';
    let countFila = 0;
    let countPronto = 0;
    let countEntregue = 0;

    Object.values(globalActiveOrders).forEach(order => {
        if (filterVal === 'meus' && order.waiterName && order.waiterName.toLowerCase() !== waiterName.toLowerCase()) return;

        const hasFila = order.items.some(i => (i.status || 'fila') === 'fila');
        const hasPronto = order.items.some(i => i.status === 'pronto');
        const isEntregue = order.items.every(i => i.status === 'entregue') || order.deliveredAt;

        if (hasFila) countFila++;
        if (hasPronto) countPronto++;
        if (isEntregue) countEntregue++;
    });

    if (els.badgeFila) els.badgeFila.textContent = countFila;
    if (els.badgePronto) els.badgePronto.textContent = countPronto;
    if (els.badgeEntregue) els.badgeEntregue.textContent = countEntregue;

    if (els.histTotalCount) els.histTotalCount.textContent = countEntregue;
}

function getWaiterQueueStart(order) {
    const itemStarts = (order.items || [])
        .filter(item => ['fila', 'em_preparo'].includes(item.status || 'fila'))
        .map(item => Number(item.queuedAt || 0))
        .filter(value => Number.isFinite(value) && value > 0);
    const fallback = Number(order.startedAt || order.timestamp || 0);
    return itemStarts.length ? Math.min(...itemStarts) : (Number.isFinite(fallback) && fallback > 0 ? fallback : Date.now());
}

function getWaiterPriorityRank(order) {
    if (order.priority === 'idoso80') return 3;
    if (['idoso60', 'gestante', 'pcd', 'autista', 'colo'].includes(order.priority)) return 2;
    return 0;
}

function getWaiterQueuePosition(targetOrder) {
    const queue = Object.values(globalActiveOrders)
        .filter(order => (order.items || []).some(item => ['fila', 'em_preparo'].includes(item.status || 'fila')))
        .sort((a, b) => getWaiterPriorityRank(b) - getWaiterPriorityRank(a) || getWaiterQueueStart(a) - getWaiterQueueStart(b));
    const index = queue.findIndex(order => order.id === targetOrder.id);
    return index >= 0 ? index + 1 : null;
}

function renderActiveOrders() {
    updateTabBadges();
    els.activeOrdersContainer.innerHTML = '';
    const filterVal = els.waiterFilter ? els.waiterFilter.value : 'meus';
    const query = searchQuery.trim().toLowerCase();

    const orderList = Object.values(globalActiveOrders).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    let hasAny = false;

    orderList.forEach(order => {
        if (filterVal === 'meus' && order.waiterName && order.waiterName.toLowerCase() !== waiterName.toLowerCase()) return;

        if (query) {
            const sMatch = (order.senha || '').toLowerCase().includes(query);
            const cMatch = (order.clientName || '').toLowerCase().includes(query);
            const fMatch = (order.feature || '').toLowerCase().includes(query);
            const wMatch = (order.waiterName || '').toLowerCase().includes(query);
            const itemMatch = order.items.some(i => (i.product && i.product.name ? i.product.name.toLowerCase().includes(query) : false));
            if (!sMatch && !cMatch && !fMatch && !wMatch && !itemMatch) return;
        }

        let validItems = [];
        let shouldShowInTab = false;

        if (currentWaiterTab === 'fila') {
            validItems = order.items.filter(i => (i.status || 'fila') === 'fila');
            shouldShowInTab = validItems.length > 0;
        } else if (currentWaiterTab === 'pronto') {
            validItems = order.items.filter(i => i.status === 'pronto');
            shouldShowInTab = validItems.length > 0;
        } else if (currentWaiterTab === 'entregue') {
            validItems = order.items.filter(i => i.status === 'entregue');
            shouldShowInTab = validItems.length > 0 || order.deliveredAt;
        }

        if (!shouldShowInTab) return;
        hasAny = true;

        const div = document.createElement('div');
        div.className = `table-card occupied ${currentWaiterTab === 'entregue' ? 'delivered-card' : ''}`;

        const horaStr = order.timestamp ? new Date(order.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--';
        const entregueHoraStr = order.deliveredAt ? new Date(order.deliveredAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null;

        const isLevar = order.tipoConsumo === 'levar' || (order.items && order.items.some(i => i.consumption === 'levar' || (i.product && i.product.name && i.product.name.includes('Para Levar'))));
        const tipoBadgeHTML = isLevar
            ? `<span class="badge-mini-levar">🛍️ Viagem</span>`
            : `<span class="badge-mini-local">🍽️ Local</span>`;
        const priorityLabels = { idoso60: '👴 Idoso 60+', idoso80: '⭐ Idoso 80+', gestante: '🤰 Gestante', pcd: '♿ PCD', autista: '♾️ Autista', colo: '👶 Criança de colo' };
        const priorityBadgeHTML = order.priority && order.priority !== 'normal'
            ? `<span class="priority-badge">${priorityLabels[order.priority] || 'Prioridade'}</span>` : '';
        const queuePosition = currentWaiterTab === 'fila' ? getWaiterQueuePosition(order) : null;
        const queuePositionHTML = queuePosition
            ? `<span class="waiter-queue-position">Fila: ${queuePosition}º</span>`
            : '';

        const headerStr = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; align-items:center; gap:0.4rem;">
                    <span class="senha-tag">#${order.senha}</span>
                    ${tipoBadgeHTML}
                    ${priorityBadgeHTML}
                    ${queuePositionHTML}
                </div>
                <span style="font-size:0.85rem; color:#666; font-weight:normal;">${horaStr}</span>
            </div>
            <div style="font-size:1.15rem; font-weight:bold; margin-top:0.4rem; color:var(--primary-bg);">${order.clientName}</div>
            ${order.feature ? `<div style="font-size:0.85rem; color:#555; font-style:italic;">📍 ${order.feature}</div>` : ''}
            <div style="font-size:0.8rem; color:#888; margin-top:0.2rem;">Atend: <strong>${order.waiterName || 'Geral'}</strong></div>
        `;

        if (currentWaiterTab === 'fila') {
            div.innerHTML = headerStr + `
                <div style="margin-top:0.6rem; font-size:0.9rem; background:rgba(0,0,0,0.05); padding:0.4rem; border-radius:5px;">
                    ⏳ <strong>${validItems.length}</strong> item(ns) na fila de preparo
                </div>
                <div style="margin-top:0.5rem; font-size:0.85rem; color:var(--primary-bg); font-weight:bold;">
                    Toque para adicionar mais itens ➕
                </div>
            `;
            div.onclick = () => openExistingOrder(order);
        } else if (currentWaiterTab === 'pronto') {
            div.innerHTML = headerStr + `
                <div style="margin-top:0.6rem; font-size:0.95rem; color:#27ae60; font-weight:bold; background:#e8f8f5; padding:0.5rem; border-radius:6px; border:1px solid #a3e4d7;">
                    🛎️ ${validItems.length} item(ns) pronto(s)!
                </div>
                <button class="btn-entregar-card" style="background:#27ae60; color:white; border:none; padding:0.7rem; border-radius:6px; width:100%; font-weight:bold; margin-top:0.6rem; cursor:pointer; font-size:1rem; box-shadow:0 2px 4px rgba(0,0,0,0.15);">
                    CONFIRMAR ENTREGA ✅
                </button>
            `;
            div.querySelector('.btn-entregar-card').onclick = (e) => {
                e.stopPropagation();
                deliverOrder(order);
            };
        } else {
            div.innerHTML = headerStr + `
                <div style="margin-top:0.6rem; font-size:0.85rem; color:#27ae60; font-weight:bold;">
                    ✅ Entregue ${entregueHoraStr ? 'às ' + entregueHoraStr : ''}
                </div>
                <div style="margin-top:0.3rem; font-size:0.85rem; color:#666;">
                    ${order.items.length} item(ns)
                </div>
                <button class="btn-ver-detalhes" style="background:#3498db; color:white; border:none; padding:0.5rem; border-radius:6px; width:100%; font-weight:bold; margin-top:0.5rem; cursor:pointer; font-size:0.85rem;">
                    📄 Ver Detalhes / Reabrir
                </button>
            `;
            div.querySelector('.btn-ver-detalhes').onclick = (e) => {
                e.stopPropagation();
                openOrderDetailModal(order);
            };
        }

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'delete-order-btn';
        deleteButton.textContent = '🗑️';
        deleteButton.title = 'Excluir pedido definitivamente';
        deleteButton.setAttribute('aria-label', 'Excluir pedido definitivamente');
        deleteButton.onclick = event => {
            event.stopPropagation();
            deleteOrderPermanently(order);
        };
        div.appendChild(deleteButton);

        els.activeOrdersContainer.appendChild(div);
    });

    if (!hasAny) {
        els.activeOrdersContainer.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; color: #777; padding: 3rem 1rem;">
                <img src="logo.png" alt="Canela de Fogo" style="width: 140px; height: 140px; border-radius: 50%; opacity: 0.2; margin-bottom: 1.2rem; filter: drop-shadow(0 0 20px rgba(255, 187, 0, 0.4)); object-fit: cover;">
            </div>
        `;
    }
}

function deliverOrder(order) {
    order.items.forEach(i => {
        if (i.status === 'pronto') {
            i.status = 'entregue';
            i.deliveredAt = Date.now();
        }
    });
    const fullyDelivered = order.items.length > 0 && order.items.every(i => i.status === 'entregue');
    if (fullyDelivered) {
        order.deliveredAt = Date.now();
    } else {
        delete order.deliveredAt;
    }
    order.updatedAt = Date.now();

    globalActiveOrders[order.id] = order;
    saveStoredOrders();
    publishMQTT({ type: 'ORDER_UPDATE', order: order });
    renderActiveOrders();
}

function openOrderDetailModal(order) {
    selectedOrderDetail = order;
    els.detailModalTitle.textContent = `Pedido #${order.senha} - ${order.clientName}`;

    const horaPed = order.timestamp ? new Date(order.timestamp).toLocaleTimeString('pt-BR') : '--';
    const horaEnt = order.deliveredAt ? new Date(order.deliveredAt).toLocaleTimeString('pt-BR') : 'Não registrada';
    const isLevar = order.tipoConsumo === 'levar' || (order.items && order.items.some(i => i.consumption === 'levar' || (i.product && i.product.name && i.product.name.includes('Para Levar'))));

    let itemsHTML = '';
    order.items.forEach(item => {
        itemsHTML += `
            <div style="display:flex; justify-content:space-between; padding:0.4rem 0; border-bottom:1px dashed #eee;">
                <span><strong>${item.qty}x</strong> ${item.product.name}</span>
            </div>
        `;
    });

    els.detailModalBody.innerHTML = `
        <div style="background:#f8f9fa; padding:0.8rem; border-radius:8px; margin-bottom:1rem; font-size:0.9rem;">
            <div><strong>Tipo:</strong> ${isLevar ? '🛍️ Para Levar (Viagem)' : '🍽️ Comer no Local'}</div>
            <div><strong>Atendente:</strong> ${order.waiterName || 'Geral'}</div>
            <div><strong>Mesa/Identificação:</strong> ${order.feature || 'Não informada'}</div>
            <div><strong>Horário do Pedido:</strong> ${horaPed}</div>
            <div><strong>Horário de Entrega:</strong> ${horaEnt}</div>
            ${order.paymentReceived ? `<div><strong>Valor recebido:</strong> ${formatCurrency(order.paymentReceived)}</div>` : ''}
            ${order.changeDue !== null && order.changeDue !== undefined ? `<div><strong>Troco:</strong> ${formatCurrency(order.changeDue)}</div>` : ''}
        </div>

        <h4 style="margin-bottom:0.5rem; color:var(--primary-bg);">Itens do Pedido:</h4>
        <div style="margin-bottom:1rem;">
            ${itemsHTML}
        </div>

        ${order.obs ? `<div style="background:#fff9e6; color:#6a1215; padding:0.6rem; border-radius:6px; margin-bottom:1rem; border-left:4px solid #ffbb00;"><strong>Obs:</strong> ${order.obs}</div>` : ''}
    `;

    els.orderDetailModal.classList.remove('hidden');
}

function openExistingOrder(orderObj) {
    currentOrder = {
        id: orderObj.id,
        senha: orderObj.senha,
        clientName: orderObj.clientName,
        feature: orderObj.feature || '',
        priority: orderObj.priority || 'normal',
        tipoConsumo: orderObj.tipoConsumo || 'local',
        waiterName: orderObj.waiterName || waiterName,
        items: JSON.parse(JSON.stringify(orderObj.items || [])),
        obs: orderObj.obs || ""
    };

    els.menuOrderTitle.textContent = `Pedido #${currentOrder.senha} - ${currentOrder.clientName}`;
    els.cartNotes.value = currentOrder.obs || "";

    els.activeOrdersScreen.classList.remove('view-active');
    els.screenMenu.classList.add('view-active');
    updateCartIcon();
}

function renderCategories() {
    const categories = ["Todos", ...new Set(DB.products.map(p => p.category))];
    if (els.categoriesContainer) {
        els.categoriesContainer.innerHTML = '';
        categories.forEach(cat => {
            const btn = document.createElement('button');
            btn.className = `cat-btn ${cat === activeCategory ? 'active' : ''}`;
            btn.textContent = cat;
            btn.onclick = () => {
                activeCategory = cat;
                renderCategories();
                renderProducts();
            };
            els.categoriesContainer.appendChild(btn);
        });
    }
}

function renderProducts() {
    els.productsContainer.innerHTML = '';
    const filtered = activeCategory === "Todos"
        ? DB.products
        : DB.products.filter(p => p.category === activeCategory);

    filtered.forEach(p => {
        const div = document.createElement('div');
        div.className = 'product-card';
        const stockItem = beverageStockState && beverageStockState.items ? beverageStockState.items[p.name] : null;
        const unavailable = Boolean(stockItem && stockItem.configured && Number(stockItem.qty) <= 0);
        if (unavailable) div.classList.add('product-unavailable');
        div.innerHTML = `
            <div class="product-info">
                <h3>${p.name}</h3>
                <div class="product-desc">${unavailable ? 'Indisponível no estoque' : p.desc}</div>
            </div>
            <div class="product-action">
                <span class="product-card-price">${p.dynamic === 'caldo' ? 'A partir de R$ 15,00' : formatCurrency(p.price)}</span>
                <button class="add-btn" ${unavailable ? 'disabled' : `onclick="openProductOptions(${p.id})"`}>${unavailable ? '×' : '+'}</button>
            </div>
        `;
        els.productsContainer.appendChild(div);
    });
}

function createNewOrder() {
    const client = els.newOrderClient.value.trim() || 'Cliente';
    const feature = els.newOrderFeature.value.trim() || '';

    const uniqueId = `CANELA-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    currentOrder = {
        id: uniqueId,
        senha: null,
        clientName: client,
        feature: feature,
        priority: els.newOrderPriority.value || 'normal',
        tipoConsumo: selectedTipoConsumo || 'local',
        waiterName: waiterName || "Geral",
        items: [],
        startedAt: null,
        quickMode: false
    };

    els.newOrderModal.classList.add('hidden');
    els.menuOrderTitle.textContent = `Novo Pedido - ${client}`;
    els.cartNotes.value = "";

    els.activeOrdersScreen.classList.remove('view-active');
    els.screenMenu.classList.add('view-active');
    updateCartIcon();
}

function createQuickOrder() {
    currentOrder = {
        id: `CANELA-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        senha: null,
        clientName: 'Pedido Rápido',
        feature: '',
        priority: 'normal',
        tipoConsumo: 'local',
        waiterName: waiterName || 'Geral',
        items: [],
        startedAt: null,
        quickMode: true
    };
    els.menuOrderTitle.textContent = '⚡ Pedido Rápido';
    els.cartNotes.value = '';
    els.activeOrdersScreen.classList.remove('view-active');
    els.screenMenu.classList.add('view-active');
    updateCartIcon();
}

let pendingProductId = null;
let pendingEditIndex = null;
window.openProductOptions = function (productId, editIndex = null) {
    const product = DB.products.find(p => p.id === productId);
    pendingProductId = productId;
    pendingEditIndex = Number.isInteger(editIndex) ? editIndex : null;
    const editItem = pendingEditIndex !== null && currentOrder ? currentOrder.items[pendingEditIndex] : null;

    if (product.dynamic === "caldo") {
        els.modalOptionsTitle.textContent = "Montar Caldo";
        els.optionsModalBody.innerHTML = `
            <label><strong>1. Tamanho:</strong></label>
            <select id="caldo-tamanho" style="width:100%; padding:0.8rem; margin:0.5rem 0 1rem 0; border-radius:8px;">
                <option value="350ml">350ml</option>
                <option value="500ml">500ml</option>
            </select>
            <label><strong>2. Sabor:</strong></label>
            <select id="caldo-sabor" style="width:100%; padding:0.8rem; margin:0.5rem 0 1rem 0; border-radius:8px;">
                <option value="Carne">Carne</option>
                <option value="Quenga">Quenga</option>
                <option value="Camarão">Camarão</option>
                <option value="Frango">Frango</option>
            </select>
            <label><strong>3. Acompanhamentos?</strong></label>
            <div style="margin: 0.5rem 0 1rem 0; background:rgba(0,0,0,0.05); padding:1rem; border-radius:8px; border:1px solid #ddd;">
                <label class="option-checkbox"><input type="checkbox" name="caldo-acc" value="Calabresa"><span>Calabresa</span></label>
                <label class="option-checkbox"><input type="checkbox" name="caldo-acc" value="Ovo"><span>Ovo</span></label>
                <label class="option-checkbox"><input type="checkbox" name="caldo-acc" value="Macarrão"><span>Macarrão</span></label>
                <label class="option-checkbox"><input type="checkbox" name="caldo-acc" value="Bacon"><span>Bacon</span></label>
                <label class="option-checkbox"><input type="checkbox" name="caldo-acc" value="Cheiro Verde"><span>Cheiro Verde</span></label>
            </div>
            <label><strong>4. Local do Consumo:</strong></label>
            <select id="caldo-local" style="width:100%; padding:0.8rem; margin:0.5rem 0 1rem 0; border-radius:8px;">
                <option value="Comer no Local" ${selectedTipoConsumo === 'local' ? 'selected' : ''}>Comer no Local</option>
                <option value="Para Levar" ${selectedTipoConsumo === 'levar' ? 'selected' : ''}>Para Levar</option>
            </select>
            <label><strong>5. Quantidade:</strong></label>
            <div class="option-qty-control">
                <button type="button" class="option-qty-btn" onclick="changeOptionQty(-1)">−</button>
                <input type="number" id="option-qty" value="1" min="1" max="99" inputmode="numeric">
                <button type="button" class="option-qty-btn" onclick="changeOptionQty(1)">+</button>
            </div>
            <div id="caldo-price-preview" class="caldo-price-preview">Valor unitário: R$ 15,00</div>
        `;
        ['caldo-tamanho', 'caldo-sabor'].forEach(id => document.getElementById(id).addEventListener('change', updateCaldoPricePreview));
        document.querySelectorAll('input[name="caldo-acc"]').forEach(input => input.addEventListener('change', updateCaldoPricePreview));
        document.getElementById('option-qty').addEventListener('input', updateCaldoPricePreview);
        updateCaldoPricePreview();
        els.optionsModal.classList.remove('hidden');
        if (editItem) prefillProductOptions(editItem, 'caldo');
    } else if (product.dynamic === "prato") {
        els.modalOptionsTitle.textContent = `Montar Prato: ${product.name}`;

        let extras = product.name.includes("Carne de Sol")
            ? ["Tropeiro", "Salada", "Vinagrete", "Farofa", "Macaxeira", "Vatapá"]
            : ["Tropeiro", "Salada", "Vinagrete", "Farofa", "Macaxeira", "Maionese", "Batata Palha", "Vatapá"];

        let extrasHTML = extras.map(e => `<label class="option-checkbox"><input type="checkbox" name="prato-retira" value="${e}"><span>${e}</span></label>`).join('');

        els.optionsModalBody.innerHTML = `
            <label><strong>1. Tipo de Arroz:</strong></label>
            <select id="prato-arroz" style="width:100%; padding:0.8rem; margin:0.5rem 0 1rem 0; border-radius:8px;">
                <option value="Arroz Branco">Arroz Branco</option>
                <option value="Arroz c/ Brócolis">Arroz com Brócolis</option>
                <option value="Baião">Baião de Dois</option>
            </select>
            <label><strong>2. Deseja RETIRAR algo?</strong> Marque o que NÃO vai:</label>
            <div style="margin: 0.5rem 0 1rem 0; background:rgba(0,0,0,0.05); padding:1rem; border-radius:8px; border:1px solid #ddd; color:var(--danger)">
                ${extrasHTML}
            </div>
            <label><strong>3. Local do Consumo:</strong></label>
            <select id="prato-local" style="width:100%; padding:0.8rem; margin:0.5rem 0 1rem 0; border-radius:8px;">
                <option value="Comer no Local" ${selectedTipoConsumo === 'local' ? 'selected' : ''}>Comer no Local</option>
                <option value="Para Levar" ${selectedTipoConsumo === 'levar' ? 'selected' : ''}>Para Levar</option>
            </select>
            <label><strong>4. Quantidade:</strong></label>
            <div class="option-qty-control">
                <button type="button" class="option-qty-btn" onclick="changeOptionQty(-1)">−</button>
                <input type="number" id="option-qty" value="1" min="1" max="99" inputmode="numeric">
                <button type="button" class="option-qty-btn" onclick="changeOptionQty(1)">+</button>
            </div>
        `;
        els.optionsModal.classList.remove('hidden');
        if (editItem) prefillProductOptions(editItem, 'prato');
    } else {
        commitAddToCart(product, product.name, product.price);
    }
};

function prefillProductOptions(item, type) {
    const name = item.product && item.product.name || '';
    document.getElementById('option-qty').value = Math.max(1, Number(item.qty) || 1);
    if (type === 'caldo') {
        const match = name.match(/^Caldo\s+(.+?)\s+(350ml|500ml)\s+\((.+?)\)\s+-/);
        if (match) {
            document.getElementById('caldo-sabor').value = match[1];
            document.getElementById('caldo-tamanho').value = match[2];
            const selected = match[3].replace(/^Com:\s*/, '').split(',').map(value => value.trim());
            document.querySelectorAll('input[name="caldo-acc"]').forEach(input => input.checked = selected.includes(input.value));
        }
        document.getElementById('caldo-local').value = item.consumption === 'levar' ? 'Para Levar' : 'Comer no Local';
        updateCaldoPricePreview();
    } else {
        const riceMatch = name.match(/\+\s(.+?)\s\[(?:TIRAR:|COMPLETO)/);
        const removeMatch = name.match(/\[TIRAR:\s*([^\]]+)\]/);
        if (riceMatch) document.getElementById('prato-arroz').value = riceMatch[1];
        const removed = removeMatch ? removeMatch[1].split(',').map(value => value.trim()) : [];
        document.querySelectorAll('input[name="prato-retira"]').forEach(input => input.checked = removed.includes(input.value));
        document.getElementById('prato-local').value = item.consumption === 'levar' ? 'Para Levar' : 'Comer no Local';
    }
}

function calculateCaldoPrice(tam, sabor, hasAccompaniment) {
    if (sabor === 'Camarão') {
        return tam === '350ml' ? (hasAccompaniment ? 20 : 18) : (hasAccompaniment ? 30 : 25);
    }
    return tam === '350ml' ? (hasAccompaniment ? 18 : 15) : 27;
}

function updateCaldoPricePreview() {
    const size = document.getElementById('caldo-tamanho');
    const flavor = document.getElementById('caldo-sabor');
    const preview = document.getElementById('caldo-price-preview');
    if (!size || !flavor || !preview) return;
    const hasAccompaniment = document.querySelectorAll('input[name="caldo-acc"]:checked').length > 0;
    const unitPrice = calculateCaldoPrice(size.value, flavor.value, hasAccompaniment);
    const qty = getOptionQty();
    preview.textContent = `Unitário: ${formatCurrency(unitPrice)} • Total: ${formatCurrency(unitPrice * qty)}`;
}

window.changeOptionQty = function (delta) {
    const input = document.getElementById('option-qty');
    if (!input) return;
    const current = parseInt(input.value, 10) || 1;
    input.value = Math.min(99, Math.max(1, current + delta));
    updateCaldoPricePreview();
};

function getOptionQty() {
    const input = document.getElementById('option-qty');
    const qty = input ? parseInt(input.value, 10) : 1;
    return Math.min(99, Math.max(1, Number.isFinite(qty) ? qty : 1));
}

els.btnConfirmOptions.onclick = () => {
    if (!pendingProductId) return;
    const product = DB.products.find(p => p.id === pendingProductId);

    if (product.dynamic === "caldo") {
        const tam = document.getElementById('caldo-tamanho').value;
        const sabor = document.getElementById('caldo-sabor').value;
        const local = document.getElementById('caldo-local').value;

        const accChecked = Array.from(document.querySelectorAll('input[name="caldo-acc"]:checked')).map(cb => cb.value);
        const temAcc = accChecked.length > 0;

        const preco = calculateCaldoPrice(tam, sabor, temAcc);
        let nName = `Caldo ${sabor} ${tam} (${temAcc ? "Com: " + accChecked.join(', ') : "Sem Acomp."}) - ${local}`;
        commitAddToCart(product, nName, preco, getOptionQty());

    } else if (product.dynamic === "prato") {
        const arroz = document.getElementById('prato-arroz').value;
        const local = document.getElementById('prato-local').value;

        const retiradas = Array.from(document.querySelectorAll('input[name="prato-retira"]:checked')).map(cb => cb.value);
        const retiStr = retiradas.length > 0 ? `[TIRAR: ${retiradas.join(', ')}]` : '[COMPLETO]';

        let preco = product.name.includes("Picanha") ? 35.00 : 25.00;
        let nName = `${product.name} + ${arroz} ${retiStr} - ${local}`;
        commitAddToCart(product, nName, preco, getOptionQty());
    }

    els.optionsModal.classList.add('hidden');
    pendingProductId = null;
    pendingEditIndex = null;
};

function commitAddToCart(baseProduct, finalName, finalPrice, quantity = 1) {
    if (!currentOrder) return;
    const productCopy = JSON.parse(JSON.stringify(baseProduct));
    productCopy.name = finalName;
    productCopy.price = finalPrice;
    const newConsumption = finalName.includes('Para Levar') ? 'levar' : 'local';

    if (pendingEditIndex !== null && currentOrder.items[pendingEditIndex]) {
        const previous = currentOrder.items[pendingEditIndex];
        currentOrder.items[pendingEditIndex] = { ...previous, product: productCopy, qty: quantity, consumption: newConsumption };
        updateCartIcon();
        renderCartModalItems();
        return;
    }

    const existingPos = currentOrder.items.findIndex(item => {
        const itemConsumption = item.consumption || (item.product.name.includes('Para Levar') ? 'levar' : 'local');
        return item.product.name === productCopy.name && itemConsumption === newConsumption && (item.status === 'fila' || !item.status);
    });
    if (existingPos > -1) {
        currentOrder.items[existingPos].qty += quantity;
    } else {
        currentOrder.items.push({
            id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            product: productCopy,
            qty: quantity,
            status: 'fila',
            queuedAt: null,
            consumption: newConsumption
        });
    }
    updateCartIcon();
}

function updateCartIcon() {
    const totals = getCurrentOrderTotals();
    if (currentOrder && currentOrder.items.length > 0) {
        els.cartBar.classList.remove('hidden');
        let itemsCount = currentOrder.items.reduce((sum, item) => sum + item.qty, 0);
        els.cartCount.textContent = itemsCount;
        if (els.cartBarTotal) els.cartBarTotal.textContent = formatCurrency(totals.total);
        if (els.menuRunningTotal) {
            els.menuRunningTotal.textContent = totals.newItemsTotal !== totals.total
                ? `Total: ${formatCurrency(totals.total)} • Novos: ${formatCurrency(totals.newItemsTotal)}`
                : `Total: ${formatCurrency(totals.total)}`;
        }
    } else {
        els.cartBar.classList.add('hidden');
        if (els.cartBarTotal) els.cartBarTotal.textContent = formatCurrency(0);
        if (els.menuRunningTotal) els.menuRunningTotal.textContent = `Total: ${formatCurrency(0)}`;
    }
    if (currentOrder && els.changeResult) updateChangePreview();
}

function getCurrentOrderTotals() {
    if (!currentOrder) return { total: 0, previousTotal: 0, newItemsTotal: 0 };
    const total = currentOrder.items.reduce((sum, item) => sum + item.product.price * item.qty, 0);
    const existingOrder = globalActiveOrders[currentOrder.id];
    const previousItems = new Map((existingOrder && existingOrder.items || []).map(item => [item.id, item]));
    const newItemsTotal = existingOrder
        ? currentOrder.items.reduce((sum, item) => {
            const previous = previousItems.get(item.id);
            const addedQty = previous ? Math.max(0, item.qty - previous.qty) : item.qty;
            return sum + item.product.price * addedQty;
        }, 0)
        : total;
    return { total, previousTotal: total - newItemsTotal, newItemsTotal };
}

function setupEventListeners() {
    if (els.btnLogin) {
        els.btnLogin.onclick = () => {
            const n = els.waiterNameInput.value.trim();
            if (n) {
                selectWaiterName(n);
            }
        };
    }

    if (els.waiterFilter) {
        els.waiterFilter.onchange = () => renderActiveOrders();
    }

    if (els.orderSearchInput) {
        els.orderSearchInput.oninput = (e) => {
            searchQuery = e.target.value;
            renderActiveOrders();
        };
    }

    els.btnNewOrder.onclick = () => {
        els.newOrderClient.value = '';
        els.newOrderFeature.value = '';
        els.newOrderPriority.value = 'normal';
        setOrderTipoConsumo('local');
        els.newOrderModal.classList.remove('hidden');
    };
    els.btnNewQuickOrder.onclick = () => els.quickOrderModal.classList.remove('hidden');
    els.btnStartQuickOrder.onclick = () => {
        els.quickOrderModal.classList.add('hidden');
        createQuickOrder();
    };
    els.btnCancelQuickOrder.onclick = () => els.quickOrderModal.classList.add('hidden');
    els.btnCancelNewOrder.onclick = () => els.newOrderModal.classList.add('hidden');
    els.btnCreateOrder.onclick = createNewOrder;

    els.backToOrdersBtn.onclick = () => {
        els.screenMenu.classList.remove('view-active');
        els.activeOrdersScreen.classList.add('view-active');
        els.cartBar.classList.add('hidden');
        currentOrder = null;
        renderActiveOrders();
    };

    if (els.closeDetailModal) {
        els.closeDetailModal.onclick = () => {
            els.orderDetailModal.classList.add('hidden');
            selectedOrderDetail = null;
        };
    }

    if (els.btnReopenOrder) {
        els.btnReopenOrder.onclick = () => {
            if (selectedOrderDetail) {
                const ord = selectedOrderDetail;
                els.orderDetailModal.classList.add('hidden');
                openExistingOrder(ord);
            }
        };
    }

    els.viewCartBtn.onclick = openCartModal;
    els.closeCartBtn.onclick = () => els.cartModal.classList.add('hidden');

    els.btnCancelOptions.onclick = () => {
        els.optionsModal.classList.add('hidden');
        pendingProductId = null;
        pendingEditIndex = null;
    };

    els.btnIndoBuscar.onclick = () => {
        stopContinuousAlarm();
        switchWaiterTab('pronto');
    };

    if (els.btnClearHistory) {
        els.btnClearHistory.onclick = () => {
            const entreguesCount = Object.values(globalActiveOrders).filter(o => o.items.every(i => i.status === 'entregue') || o.deliveredAt).length;
            if (entreguesCount === 0) {
                alert("Não há pedidos entregues no histórico para limpar.");
                return;
            }
            if (confirm(`Deseja limpar os ${entreguesCount} pedidos entregues do histórico? Os pedidos em aberto continuarão salvos.`)) {
                const clearedAt = Date.now();
                applyHistoryClear(clearedAt);
                publishMQTT({ type: 'CLEAR_HISTORY', clearedAt });
                renderActiveOrders();
            }
        };
    }

    els.checkoutBtn.onclick = () => finalizeCurrentOrder(false);
    els.quickOrderBtn.onclick = () => finalizeCurrentOrder(true);

    els.paymentReceived.oninput = updateChangePreview;
    els.toggleChangeBtn.onclick = () => {
        const willOpen = els.changePanel.classList.contains('hidden');
        els.changePanel.classList.toggle('hidden', !willOpen);
        els.toggleChangeBtn.setAttribute('aria-expanded', String(willOpen));
        els.toggleChangeBtn.textContent = willOpen ? '▲ Ocultar troco' : '💵 Informar valor para troco';
        if (willOpen) els.paymentReceived.focus();
    };

    setupDialogBehavior(els.newOrderModal, [els.newOrderClient, els.newOrderFeature, els.newOrderPriority], createNewOrder);
    setupDialogBehavior(els.optionsModal, [], () => els.btnConfirmOptions.click());
    setupOutsideClose(els.newOrderModal, () => els.newOrderModal.classList.add('hidden'));
    setupOutsideClose(els.quickOrderModal, () => els.quickOrderModal.classList.add('hidden'));
    setupOutsideClose(els.optionsModal, () => {
        els.optionsModal.classList.add('hidden');
        pendingProductId = null;
        pendingEditIndex = null;
    });
    setupOutsideClose(els.orderDetailModal, () => els.orderDetailModal.classList.add('hidden'));
    setupOutsideClose(els.cartModal, () => els.cartModal.classList.add('hidden'));
}

function assignOrderSenha() {
    const today = new Date().toLocaleDateString('en-CA');
    const savedDate = localStorage.getItem('canela_senha_date');
    if (savedDate !== today) {
        globalSenhaCount = 0;
        localStorage.setItem('canela_senha', '0');
        localStorage.setItem('canela_senha_date', today);
        localStorage.setItem('canela_senha_reset_at', String(Date.now()));
    }
    const resetAt = Number(localStorage.getItem('canela_senha_reset_at')) || new Date(`${today}T00:00:00`).getTime();
    let maxKnown = globalSenhaCount;
    Object.values(globalActiveOrders).forEach(order => {
        if (Number(order.timestamp || 0) < resetAt) return;
        const num = parseInt(order.senha, 10);
        if (!isNaN(num)) maxKnown = Math.max(maxKnown, num);
    });
    globalSenhaCount = maxKnown + 1;
    localStorage.setItem('canela_senha', globalSenhaCount);
    localStorage.setItem('canela_senha_date', today);
    return globalSenhaCount.toString().padStart(3, '0');
}

function updateChangePreview() {
    if (!currentOrder) return;
    const totals = getCurrentOrderTotals();
    const total = totals.total;
    const received = Number(els.paymentReceived.value) || 0;
    const difference = received - total;
    if (els.cartTotalSummary) {
        els.cartTotalSummary.innerHTML = totals.newItemsTotal !== totals.total
            ? `Total do pedido: ${formatCurrency(total)}<br><span style="font-size:0.9rem;color:#fff;">Novos itens: ${formatCurrency(totals.newItemsTotal)}</span>`
            : `Total do pedido: ${formatCurrency(total)}`;
    }
    els.changeResult.textContent = received > 0 && difference < 0
        ? `Falta: ${formatCurrency(Math.abs(difference))}`
        : `Troco: ${formatCurrency(Math.max(0, difference))}`;
}

function formatCurrency(value) {
    return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function finalizeCurrentOrder(isQuickOrder) {
    if (!currentOrder || currentOrder.items.length === 0) return;
    const existingOrder = globalActiveOrders[currentOrder.id];
    const now = Date.now();
    const quickMode = Boolean(isQuickOrder || currentOrder.quickMode);
    const immutableStart = Number(existingOrder && (existingOrder.startedAt || existingOrder.timestamp)) || now;

    const total = currentOrder.items.reduce((sum, item) => sum + item.product.price * item.qty, 0);
    const received = Math.max(0, Number(els.paymentReceived.value) || 0);
    if (received > 0 && received < total) {
        alert(`O valor recebido é menor que o total do pedido. Ainda faltam ${formatCurrency(total - received)}.`);
        return;
    }
    if (!quickMode && !currentOrder.senha) currentOrder.senha = assignOrderSenha();
    currentOrder.items.forEach(item => {
        const previous = existingOrder && existingOrder.items.find(oldItem => oldItem.id === item.id);
        if (previous) item.status = previous.status;
        if (!item.status) item.status = 'fila';
        if (!previous && !quickMode && item.status === 'fila') item.queuedAt = immutableStart;
        if (quickMode && item.status !== 'entregue') {
            item.status = 'entregue';
            item.deliveredAt = now;
        }
    });
    const pedidoMsg = {
        ...currentOrder,
        waiterName: waiterName || currentOrder.waiterName || 'Geral',
        obs: els.cartNotes.value.trim(),
        total,
        paymentReceived: received || null,
        changeDue: received ? Math.max(0, received - total) : null,
        senha: currentOrder.senha || (quickMode ? 'RÁPIDO' : null),
        quickOrder: quickMode,
        startedAt: existingOrder ? immutableStart : now,
        timestamp: existingOrder ? (existingOrder.timestamp || now) : now,
        updatedAt: now
    };
    if (quickMode) {
        pedidoMsg.items.forEach(item => {
            item.status = 'entregue';
            item.deliveredAt = now;
        });
        pedidoMsg.quickOrder = true;
        pedidoMsg.deliveredAt = now;
    }

    globalActiveOrders[pedidoMsg.id] = pedidoMsg;
    saveStoredOrders();
    if (!quickMode) {
        const updatePayload = { type: 'ORDER_UPDATE', order: pedidoMsg };
        trackKitchenConfirmation(updatePayload);
        publishMQTT(updatePayload);
    }

    els.cartModal.classList.add('hidden');
    els.cartNotes.value = '';
    els.paymentReceived.value = '';
    currentOrder = null;
    updateCartIcon();
    els.screenMenu.classList.remove('view-active');
    els.activeOrdersScreen.classList.add('view-active');
    renderActiveOrders();
}

function setupOutsideClose(overlay, closeAction) {
    if (!overlay) return;
    overlay.addEventListener('click', event => {
        if (event.target === overlay) closeAction();
    });
}

function setupDialogBehavior(dialog, fields, finalAction) {
    if (!dialog) return;
    dialog.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || event.shiftKey || event.target.tagName === 'TEXTAREA') return;
        event.preventDefault();
        const index = fields.indexOf(event.target);
        if (index >= 0 && index < fields.length - 1) {
            fields[index + 1].focus();
        } else {
            finalAction();
        }
    });
}

function openCartModal() {
    els.cartModal.classList.remove('hidden');
    els.cartModalTableTitle.textContent = currentOrder.clientName;
    const isQuickMode = Boolean(currentOrder.quickMode);
    els.checkoutBtn.classList.toggle('hidden', isQuickMode);
    els.quickOrderBtn.classList.toggle('hidden', !isQuickMode);
    els.cartModal.classList.toggle('quick-mode', isQuickMode);
    els.changePanel.classList.add('hidden');
    els.toggleChangeBtn.setAttribute('aria-expanded', 'false');
    els.toggleChangeBtn.textContent = '💵 Informar valor para troco';
    renderCartModalItems();
    updateChangePreview();
}

window.changeCartQty = function (index, delta) {
    if (!currentOrder.items[index]) return;
    currentOrder.items[index].qty += delta;
    if (currentOrder.items[index].qty <= 0) {
        removeCartItem(index);
        return;
    }
    updateCartIcon();
    renderCartModalItems();
    if (currentOrder.items.length === 0) {
        els.cartModal.classList.add('hidden');
    }
};

window.removeCartItem = function (index) {
    if (!currentOrder || !currentOrder.items[index]) return;
    const item = currentOrder.items[index];
    if (item.id) {
        if (!Array.isArray(currentOrder.removedItemIds)) currentOrder.removedItemIds = [];
        if (!currentOrder.removedItemIds.includes(item.id)) currentOrder.removedItemIds.push(item.id);
    }
    currentOrder.items.splice(index, 1);
    updateCartIcon();
    renderCartModalItems();
    if (currentOrder.items.length === 0) els.cartModal.classList.add('hidden');
};

window.changeItemConsumption = function (index, consumption) {
    if (!currentOrder || !currentOrder.items[index]) return;
    currentOrder.items[index].consumption = consumption;
    updateCartIcon();
    renderCartModalItems();
};

function renderCartModalItems() {
    els.cartItemsContainer.innerHTML = '';
    currentOrder.items.forEach((item, idx) => {
        const itemConsumption = item.consumption || (item.product.name.includes('Para Levar') ? 'levar' : 'local');
        const div = document.createElement('div');
        div.className = 'cart-item';
        div.innerHTML = `
            <div class="cart-item-details">
                <div class="cart-item-name">${item.product.name}</div>
                <div class="cart-item-price">${formatCurrency(item.product.price)} un. • ${formatCurrency(item.product.price * item.qty)}</div>
                ${item.status ? `<span style="font-size:0.75rem; color:#888;">Status: ${item.status}</span>` : ''}
                <select class="item-consumption-select" onchange="changeItemConsumption(${idx}, this.value)">
                    <option value="local" ${itemConsumption === 'local' ? 'selected' : ''}>🍽️ Comer no local</option>
                    <option value="levar" ${itemConsumption === 'levar' ? 'selected' : ''}>🛍️ Para levar</option>
                </select>
            </div>
            <div class="qty-controls">
                ${item.product.dynamic ? `<button class="edit-cart-item-btn" onclick="openProductOptions(${item.product.id}, ${idx})" title="Editar configuração completa">✏️</button>` : ''}
                <button class="qty-btn" onclick="changeCartQty(${idx}, -1)">-</button>
                <span class="qty-text">${item.qty}</span>
                <button class="qty-btn" onclick="changeCartQty(${idx}, 1)">+</button>
                <button class="remove-item-btn" onclick="removeCartItem(${idx})" title="Excluir item">🗑️</button>
            </div>
        `;
        els.cartItemsContainer.appendChild(div);
    });
}

// --- WAKE LOCK PERSISTENTE (Impede a tela de apagar) ---
let wakeLock = null;
async function keepScreenAlive() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) { }
}

document.body.addEventListener('click', keepScreenAlive);
document.body.addEventListener('touchstart', keepScreenAlive);

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

init();
