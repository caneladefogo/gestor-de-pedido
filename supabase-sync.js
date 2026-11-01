(function () {
    const SUPABASE_URL = 'https://bcnxnxasvcyocusmwrsn.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjbnhueGFzdmN5b2N1c213cnNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1MDYxODMsImV4cCI6MjEwMzA4MjE4M30.PFewu7mvOFVCFiVV3N9LN71ClohHR9G6DPSjzsiOwFU';
    const API = `${SUPABASE_URL}/rest/v1`;
    const EMERGENCY_API = '/.netlify/functions/emergency-sync';
    const TRANSPORT_KEY = 'canela_sync_transport';
    const requestedTransport = new URLSearchParams(window.location.search).get('sync');
    if (requestedTransport === 'supabase' || requestedTransport === 'netlify') {
        localStorage.setItem(TRANSPORT_KEY, requestedTransport);
    }
    const selectedTransport = localStorage.getItem(TRANSPORT_KEY) === 'netlify' ? 'netlify' : 'supabase';
    const HEADERS = {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
    };

    async function request(path, options = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        let response;
        try {
            response = await fetch(`${API}/${path}`, {
                ...options,
                signal: controller.signal,
                headers: { ...HEADERS, ...(options.headers || {}) }
            });
        } finally {
            clearTimeout(timeout);
        }
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            const error = new Error(`Supabase ${response.status}: ${detail || response.statusText}`);
            error.status = response.status;
            throw error;
        }
        if (response.status === 204) return null;
        const text = await response.text();
        return text ? JSON.parse(text) : null;
    }

    async function emergencyRequest(path = '', options = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
            const response = await fetch(`${EMERGENCY_API}${path}`, {
                ...options,
                signal: controller.signal,
                headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
                cache: 'no-store'
            });
            if (!response.ok) throw new Error(`Canal Netlify ${response.status}`);
            return response.json();
        } finally {
            clearTimeout(timeout);
        }
    }

    const stateApi = {
        async load(scope) {
            if (selectedTransport === 'netlify') {
                const data = await emergencyRequest(`?state=${encodeURIComponent(scope)}`);
                return data.row || null;
            }
            const rows = await request(`sync_state?scope=eq.${encodeURIComponent(scope)}&select=payload,updated_at&limit=1`);
            return rows && rows[0] ? rows[0] : null;
        },
        async save(scope, payload) {
            if (selectedTransport === 'netlify') {
                const data = await emergencyRequest('', {
                    method: 'POST',
                    body: JSON.stringify({ kind: 'state', scope, payload, updated_at: Date.now() })
                });
                return data.row || null;
            }
            return request('sync_state?on_conflict=scope', {
                method: 'POST',
                headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
                body: JSON.stringify({ scope, payload, updated_at: Date.now() })
            });
        }
    };

    const historyApi = {
        async archive(record) {
            if (!record || !record.date || !record.orders) throw new Error('Histórico inválido para arquivamento');
            const scope = `history-${record.date}`;
            const current = await stateApi.load(scope);
            const currentPayload = current && current.payload && typeof current.payload === 'object' ? current.payload : {};
            const mergedOrders = { ...(currentPayload.orders || {}), ...(record.orders || {}) };
            const payload = {
                ...currentPayload,
                ...record,
                scope,
                orders: mergedOrders,
                orderCount: Object.keys(mergedOrders).length,
                deleted: false,
                deletedAt: null,
                archivedAt: Date.now()
            };
            await stateApi.save(scope, payload);
            return payload;
        },
        async list() {
            const rows = selectedTransport === 'netlify'
                ? (await emergencyRequest('?histories=1')).rows || []
                : await request('sync_state?scope=like.history-*&select=scope,payload,updated_at&order=scope.desc');
            return (rows || []).filter(row => !(row.payload && row.payload.deleted));
        },
        async remove(scopes) {
            const targets = [...new Set((scopes || []).filter(scope => /^history-\d{4}-\d{2}-\d{2}$/.test(scope)))];
            if (!targets.length) throw new Error('Nenhum histórico válido selecionado');
            const deletedAt = Date.now();
            for (const scope of targets) {
                await stateApi.save(scope, {
                    scope,
                    date: scope.replace(/^history-/, ''),
                    orders: {},
                    orderCount: 0,
                    deleted: true,
                    deletedAt
                });
                const check = await stateApi.load(scope);
                if (!check || !check.payload || !check.payload.deleted || Object.keys(check.payload.orders || {}).length) {
                    throw new Error('O banco não confirmou a limpeza do histórico.');
                }
            }
            return targets.length;
        }
    };

    function createClient() {
        const handlers = new Map();
        const localChannel = typeof BroadcastChannel !== 'undefined'
            ? new BroadcastChannel('canela_local_sync')
            : null;
        let stopped = false;
        let reconnectTimer = null;
        let reconnectAttempt = 0;
        let transport = 'idle';
        let lastEmergencyKey = `events/${String(Date.now()).padStart(13, '0')}-`;
        let realtimeClient = null;
        let realtimeChannel = null;
        let realtimeTimeout = null;

        const client = {
            connected: false,
            reconnecting: false,
            disconnecting: false,
            on(name, handler) {
                if (!handlers.has(name)) handlers.set(name, new Set());
                handlers.get(name).add(handler);
                return client;
            },
            subscribe(_topic, callback) {
                if (callback) queueMicrotask(() => callback(client.connected ? null : new Error('Supabase desconectado')));
                return client;
            },
            publishLocal(topic, message) {
                if (!localChannel) return client;
                const payload = typeof message === 'string' ? JSON.parse(message) : message;
                localChannel.postMessage({ topic, payload });
                return client;
            },
            async publish(topic, message, _options, callback) {
                if (typeof _options === 'function') callback = _options;
                try {
                    const payload = typeof message === 'string' ? JSON.parse(message) : message;
                    if (transport === 'realtime' && realtimeChannel) {
                        const result = await realtimeChannel.send({
                            type: 'broadcast',
                            event: 'sync',
                            payload: { topic, payload }
                        });
                        if (result !== 'ok') throw new Error(`Supabase Realtime: ${result}`);
                    } else if (transport === 'netlify') {
                        const response = await fetch(EMERGENCY_API, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ topic, payload })
                        });
                        if (!response.ok) throw new Error(`Canal emergencial ${response.status}`);
                    } else {
                        throw new Error('Canal de sincronização ainda não conectado');
                    }
                    callback && callback(null);
                } catch (error) {
                    markOffline(error);
                    callback && callback(error);
                }
                return client;
            },
            reconnect() {
                client.connected = false;
                transport = 'idle';
                connect();
                return client;
            },
            end() {
                stopped = true;
                client.connected = false;
                clearTimeout(realtimeTimeout);
                clearTimeout(reconnectTimer);
                if (realtimeClient && realtimeChannel) realtimeClient.removeChannel(realtimeChannel);
                if (localChannel) localChannel.close();
                return client;
            }
        };

        if (localChannel) {
            localChannel.onmessage = event => {
                const data = event && event.data;
                if (!data || !data.topic) return;
                emit('message', data.topic, { toString: () => JSON.stringify(data.payload) });
            };
        }

        function emit(name, ...args) {
            (handlers.get(name) || []).forEach(handler => {
                try { handler(...args); } catch (error) { console.error('Erro no sincronizador:', error); }
            });
        }

        function scheduleReconnect() {
            if (stopped || reconnectTimer || !navigator.onLine) return;
            client.reconnecting = true;
            const delay = Math.min(5000 * (2 ** reconnectAttempt), 60000);
            reconnectAttempt += 1;
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                emit('reconnect');
                connect();
            }, delay);
        }

        function markOffline(error) {
            const wasConnected = client.connected;
            client.connected = false;
            transport = 'idle';
            document.documentElement.dataset.syncTransport = `${selectedTransport}-offline`;
            if (wasConnected) emit('offline');
            emit('error', error);
            scheduleReconnect();
        }

        async function pollEmergency() {
            if (stopped || selectedTransport !== 'netlify' || transport !== 'netlify' || document.hidden || !navigator.onLine) return;
            try {
                const response = await fetch(`${EMERGENCY_API}?since=${encodeURIComponent(lastEmergencyKey)}`, { cache: 'no-store' });
                if (!response.ok) throw new Error(`Canal emergencial ${response.status}`);
                const data = await response.json();
                for (const event of data.events || []) {
                    lastEmergencyKey = event.key > lastEmergencyKey ? event.key : lastEmergencyKey;
                    emit('message', event.topic, { toString: () => JSON.stringify(event.payload) });
                }
            } catch (error) {
                markOffline(error);
            }
        }

        async function connectNetlify() {
            try {
                const response = await fetch(`${EMERGENCY_API}?since=${encodeURIComponent(lastEmergencyKey)}`, { cache: 'no-store' });
                if (!response.ok) throw new Error(`Canal emergencial ${response.status}`);
                const data = await response.json();
                for (const event of data.events || []) {
                    lastEmergencyKey = event.key > lastEmergencyKey ? event.key : lastEmergencyKey;
                    emit('message', event.topic, { toString: () => JSON.stringify(event.payload) });
                }
                transport = 'netlify';
                document.documentElement.dataset.syncTransport = 'netlify';
                client.connected = true;
                client.reconnecting = false;
                reconnectAttempt = 0;
                emit('connect');
            } catch (error) {
                markOffline(error);
            }
        }

        function connectSupabase() {
            clearTimeout(realtimeTimeout);

            if (!window.supabase || typeof window.supabase.createClient !== 'function') {
                markOffline(new Error('Biblioteca Supabase Realtime indisponível'));
                return;
            }

            try {
                realtimeClient ||= window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
                    realtime: { params: { eventsPerSecond: 20 } }
                });
                if (realtimeChannel) realtimeClient.removeChannel(realtimeChannel).catch(() => {});
                const channel = realtimeClient
                    .channel('canela-pedidos-sync', { config: { broadcast: { self: false, ack: true } } })
                    .on('broadcast', { event: 'sync' }, event => {
                        const data = event && event.payload;
                        if (!data || !data.topic) return;
                        emit('message', data.topic, { toString: () => JSON.stringify(data.payload) });
                    })
                    .subscribe(status => {
                        if (realtimeChannel !== channel) return;
                        if (status === 'SUBSCRIBED') {
                            clearTimeout(realtimeTimeout);
                            transport = 'realtime';
                            document.documentElement.dataset.syncTransport = 'realtime';
                            client.connected = true;
                            client.reconnecting = false;
                            reconnectAttempt = 0;
                            emit('connect');
                            return;
                        }
                        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                            markOffline(new Error(`Supabase Realtime: ${status}`));
                        }
                    });
                realtimeChannel = channel;
                realtimeTimeout = setTimeout(() => {
                    if (transport === 'connecting') markOffline(new Error('Tempo limite do Supabase Realtime'));
                }, 12000);
            } catch (error) {
                markOffline(error);
            }
        }

        function connect() {
            if (stopped || client.connected || transport === 'connecting' || !navigator.onLine) return;
            transport = 'connecting';
            document.documentElement.dataset.syncTransport = `${selectedTransport}-connecting`;
            if (selectedTransport === 'netlify') connectNetlify();
            else connectSupabase();
        }

        // O transporte é fixo durante a operação. Netlify só é usado quando ativado explicitamente.
        setInterval(pollEmergency, 5000);
        document.documentElement.dataset.syncTransport = 'idle';
        setTimeout(connect, 0);
        window.addEventListener('online', () => {
            reconnectAttempt = 0;
            client.connected = false;
            transport = 'idle';
            document.documentElement.dataset.syncTransport = 'idle';
            connect();
        });
        window.addEventListener('offline', () => markOffline(new Error('Sem internet')));
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && navigator.onLine) connect();
        });
        return client;
    }

    window.CanelaSupabase = { createClient, state: stateApi, history: historyApi };
})();
