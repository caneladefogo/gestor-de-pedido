(function () {
    const SUPABASE_URL = 'https://bcnxnxasvcyocusmwrsn.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjbnhueGFzdmN5b2N1c213cnNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1MDYxODMsImV4cCI6MjEwMzA4MjE4M30.PFewu7mvOFVCFiVV3N9LN71ClohHR9G6DPSjzsiOwFU';
    const API = `${SUPABASE_URL}/rest/v1`;
    const HEADERS = {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
    };

    async function request(path, options = {}) {
        const response = await fetch(`${API}/${path}`, {
            ...options,
            headers: { ...HEADERS, ...(options.headers || {}) }
        });
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

    const stateApi = {
        async load(scope) {
            const rows = await request(`sync_state?scope=eq.${encodeURIComponent(scope)}&select=payload,updated_at&limit=1`);
            return rows && rows[0] ? rows[0] : null;
        },
        async save(scope, payload) {
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
                archivedAt: Date.now()
            };
            await stateApi.save(scope, payload);
            return payload;
        },
        async list() {
            return request('sync_state?scope=like.history-*&select=scope,payload,updated_at&order=scope.desc');
        }
    };

    function createClient() {
        const handlers = new Map();
        let polling = false;
        let stopped = false;
        let lastEventId = 0;
        let reconnectTimer = null;

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
            async publish(topic, message, _options, callback) {
                if (typeof _options === 'function') callback = _options;
                try {
                    const payload = typeof message === 'string' ? JSON.parse(message) : message;
                    await request('sync_events', {
                        method: 'POST',
                        headers: { Prefer: 'return=minimal' },
                        body: JSON.stringify({ topic, payload, created_at: Date.now() })
                    });
                    callback && callback(null);
                } catch (error) {
                    markOffline(error);
                    callback && callback(error);
                }
                return client;
            },
            reconnect() {
                connect();
                return client;
            },
            end() {
                stopped = true;
                client.connected = false;
                return client;
            }
        };

        function emit(name, ...args) {
            (handlers.get(name) || []).forEach(handler => {
                try { handler(...args); } catch (error) { console.error('Erro no sincronizador:', error); }
            });
        }

        function scheduleReconnect() {
            if (stopped || reconnectTimer) return;
            client.reconnecting = true;
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                emit('reconnect');
                connect();
            }, 2500);
        }

        function markOffline(error) {
            const wasConnected = client.connected;
            client.connected = false;
            if (wasConnected) emit('offline');
            emit('error', error);
            scheduleReconnect();
        }

        async function poll() {
            if (polling || stopped || !client.connected) return;
            polling = true;
            try {
                const rows = await request(`sync_events?id=gt.${lastEventId}&select=id,topic,payload&order=id.asc&limit=200`);
                for (const row of rows || []) {
                    lastEventId = Math.max(lastEventId, Number(row.id) || 0);
                    emit('message', row.topic, { toString: () => JSON.stringify(row.payload) });
                }
            } catch (error) {
                markOffline(error);
            } finally {
                polling = false;
            }
        }

        async function connect() {
            if (stopped || client.connected) return;
            try {
                const newest = await request('sync_events?select=id&order=id.desc&limit=1');
                lastEventId = Math.max(lastEventId, Number(newest && newest[0] && newest[0].id) || 0);
                client.connected = true;
                client.reconnecting = false;
                emit('connect');
            } catch (error) {
                markOffline(error);
            }
        }

        setInterval(poll, 1200);
        setTimeout(connect, 0);
        window.addEventListener('online', connect);
        window.addEventListener('offline', () => markOffline(new Error('Sem internet')));
        return client;
    }

    window.CanelaSupabase = { createClient, state: stateApi, history: historyApi };
})();
