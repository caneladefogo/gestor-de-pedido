import { getStore } from '@netlify/blobs';

const responseHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS'
};

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: responseHeaders
});

export default async (request) => {
  if (request.method === 'OPTIONS') return new Response('', { status: 204, headers: responseHeaders });
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Método não permitido' }, 405);

  try {
    const store = getStore({ name: 'canela-emergency-sync', consistency: 'strong' });
    const url = new URL(request.url);

    if (request.method === 'POST') {
      const raw = await request.text();
      if (raw.length > 500000) return json({ error: 'Atualização muito grande' }, 413);
      const body = JSON.parse(raw || '{}');
      if (body.kind === 'state') {
        if (typeof body.scope !== 'string' || !body.scope || body.scope.length > 160 || !body.payload || typeof body.payload !== 'object') {
          return json({ error: 'Estado inválido' }, 400);
        }
        const updatedAt = Number(body.updated_at) || Date.now();
        const row = { scope: body.scope, payload: body.payload, updated_at: updatedAt };
        await store.set(`state/${encodeURIComponent(body.scope)}`, JSON.stringify(row));
        return json({ ok: true, row }, 201);
      }
      if (!body.topic || !body.payload || typeof body.payload !== 'object') {
        return json({ error: 'Atualização inválida' }, 400);
      }
      const timestamp = Date.now();
      const key = `events/${String(timestamp).padStart(13, '0')}-${crypto.randomUUID()}`;
      await store.set(key, JSON.stringify({ key, timestamp, topic: body.topic, payload: body.payload }), { onlyIfNew: true });
      return json({ ok: true, key, timestamp }, 201);
    }

    const stateScope = url.searchParams.get('state');
    if (stateScope) {
      const value = await store.get(`state/${encodeURIComponent(stateScope)}`, { consistency: 'strong' });
      return json({ ok: true, row: value ? JSON.parse(value) : null });
    }
    if (url.searchParams.get('histories') === '1') {
      const { blobs } = await store.list({ prefix: 'state/history-' });
      const rows = (await Promise.all(blobs.map(async entry => {
        const value = await store.get(entry.key, { consistency: 'strong' });
        return value ? JSON.parse(value) : null;
      }))).filter(Boolean).sort((a, b) => String(b.scope).localeCompare(String(a.scope)));
      return json({ ok: true, rows });
    }

    const since = url.searchParams.get('since') || '';
    const { blobs } = await store.list({ prefix: 'events/' });
    const selected = blobs
      .filter(entry => !since || entry.key > since)
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-250);
    const events = (await Promise.all(selected.map(async entry => {
      const value = await store.get(entry.key, { consistency: 'strong' });
      return value ? JSON.parse(value) : null;
    }))).filter(Boolean);
    return json({ ok: true, events });
  } catch (error) {
    console.error('Falha no canal emergencial:', error);
    return json({ error: 'Canal emergencial indisponível' }, 503);
  }
};
