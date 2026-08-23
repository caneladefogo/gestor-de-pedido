(function () {
    const DB_NAME = 'canela_de_fogo_db';
    const DB_VERSION = 1;
    const SNAPSHOTS = 'snapshots';
    const OUTBOX = 'outbox';

    function openDatabase() {
        return new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) return reject(new Error('IndexedDB indisponível'));
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(SNAPSHOTS)) db.createObjectStore(SNAPSHOTS);
                if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'id' });
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function run(storeName, mode, operation) {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            const request = operation(store);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            tx.oncomplete = () => db.close();
        });
    }

    const api = {
        async loadSnapshot(scope) {
            try {
                return await run(SNAPSHOTS, 'readonly', store => store.get(scope));
            } catch (error) {
                console.warn('Falha ao ler persistência reforçada:', error);
                return null;
            }
        },

        async saveSnapshot(scope, data) {
            try {
                await run(SNAPSHOTS, 'readwrite', store => store.put(data, scope));
            } catch (error) {
                console.warn('Falha ao gravar persistência reforçada:', error);
            }
        },

        async enqueue(scope, payload) {
            const entry = {
                id: `${scope}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
                scope,
                payload,
                createdAt: Date.now(),
                attempts: 0
            };
            try {
                await run(OUTBOX, 'readwrite', store => store.put(entry));
                return entry;
            } catch (error) {
                console.warn('Falha ao guardar envio pendente:', error);
                return null;
            }
        },

        async listPending(scope) {
            try {
                const all = await run(OUTBOX, 'readonly', store => store.getAll());
                return (all || []).filter(entry => entry.scope === scope).sort((a, b) => a.createdAt - b.createdAt);
            } catch (error) {
                console.warn('Falha ao ler envios pendentes:', error);
                return [];
            }
        },

        async removePending(id) {
            try {
                await run(OUTBOX, 'readwrite', store => store.delete(id));
            } catch (error) {
                console.warn('Falha ao concluir envio pendente:', error);
            }
        }
    };

    window.CanelaPersistence = api;

    const statusRank = { fila: 0, pronto: 1, entregue: 2 };
    window.mergeCanelaOrders = function (current, incoming) {
        if (!current) return incoming;
        if (!incoming) return current;

        const currentRevision = Number(current.updatedAt || current.timestamp || 0);
        const incomingRevision = Number(incoming.updatedAt || incoming.timestamp || 0);
        const incomingIsNewer = incomingRevision >= currentRevision;
        const primary = incomingIsNewer ? incoming : current;
        const secondary = incomingIsNewer ? current : incoming;
        const merged = { ...secondary, ...primary };
        const itemMap = new Map();

        (secondary.items || []).forEach((item, index) => {
            itemMap.set(item.id || `secondary_${index}_${item.product && item.product.name}`, { ...item });
        });
        (primary.items || []).forEach((item, index) => {
            const key = item.id || `primary_${index}_${item.product && item.product.name}`;
            const previous = item.id ? itemMap.get(item.id) : null;
            if (!previous) {
                itemMap.set(key, { ...item });
                return;
            }
            const previousStatus = previous.status || 'fila';
            const incomingStatus = item.status || 'fila';
            const strongestStatus = (statusRank[incomingStatus] || 0) >= (statusRank[previousStatus] || 0)
                ? incomingStatus
                : previousStatus;
            const queueTimes = [Number(previous.queuedAt), Number(item.queuedAt)].filter(Number.isFinite);
            itemMap.set(item.id, {
                ...previous,
                ...item,
                status: strongestStatus,
                queuedAt: queueTimes.length ? Math.min(...queueTimes) : (item.queuedAt || previous.queuedAt)
            });
        });

        merged.items = [...itemMap.values()];
        const removedIds = new Set([...(current.removedItemIds || []), ...(incoming.removedItemIds || [])]);
        merged.removedItemIds = [...removedIds];
        merged.items = merged.items.filter(item => !item.id || !removedIds.has(item.id));
        merged.timestamp = Number(current.timestamp || incoming.timestamp || Date.now());
        merged.updatedAt = Math.max(currentRevision, incomingRevision);

        const currentNoteRevision = Number(current.kitchenNoteUpdatedAt || 0);
        const incomingNoteRevision = Number(incoming.kitchenNoteUpdatedAt || 0);
        if (currentNoteRevision > incomingNoteRevision) {
            merged.kitchenNote = current.kitchenNote;
            merged.kitchenNoteUpdatedAt = current.kitchenNoteUpdatedAt;
        }

        if (merged.items.length > 0 && merged.items.every(item => item.status === 'entregue')) {
            merged.deliveredAt = Math.max(Number(current.deliveredAt || 0), Number(incoming.deliveredAt || 0)) || Date.now();
        } else {
            delete merged.deliveredAt;
        }

        return merged;
    };
})();
