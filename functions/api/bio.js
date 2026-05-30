// functions/api/bio.js
// Cloudflare Pages Function — maneja /api/bio/*
// Variables de entorno: ADMIN_PASS, RP_ID
// Binding D1: DB

const ADMIN_USER = 'admin';

function b64urlEncode(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function b64urlDecode(str) {
  str = str.replace(/-/g,'+').replace(/_/g,'/');
  while (str.length % 4) str += '=';
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

function json(data, status=200, origin='*') {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }});
}

async function cleanChallenges(db) {
  await db.prepare('DELETE FROM bio_challenges WHERE created < ?')
    .bind(Date.now() - 5*60*1000).run();
}

export async function onRequest(ctx) {
  const { request, env } = ctx;
  const url  = new URL(request.url);
  const path = url.pathname; // /api/bio/register/start etc.
  const origin = request.headers.get('origin') || '*';

  if (request.method === 'OPTIONS') return new Response(null, { headers: {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }});

  const RP_ID = env.RP_ID;

  // ── /api/bio/register/start ────────────────────────────────────────────────
  if (path.endsWith('/register/start') && request.method === 'POST') {
    const { user, pass } = await request.json();
    if (user !== ADMIN_USER || pass !== env.ADMIN_PASS)
      return json({ error: 'No autorizado' }, 401, origin);

    await cleanChallenges(env.DB);
    const challenge = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO bio_challenges VALUES (?,?,?)')
      .bind(id, challenge, Date.now()).run();

    const existing = await env.DB.prepare('SELECT cred_id FROM bio_credentials').all();
    const excludeCredentials = (existing.results||[]).map(r => ({ id: r.cred_id, type: 'public-key' }));

    return json({ challengeId: id, publicKey: {
      rp: { id: RP_ID, name: 'iA Terminal' },
      user: { id: b64urlEncode(new TextEncoder().encode('ia-admin')), name: ADMIN_USER, displayName: 'Admin' },
      challenge,
      pubKeyCredParams: [{ type:'public-key', alg:-7 }, { type:'public-key', alg:-257 }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'required',
        requireResidentKey: true,
      },
      excludeCredentials,
      timeout: 60000,
    }}, 200, origin);
  }

  // ── /api/bio/register/finish ───────────────────────────────────────────────
  if (path.endsWith('/register/finish') && request.method === 'POST') {
    const { challengeId, credential } = await request.json();
    const row = await env.DB.prepare('SELECT challenge FROM bio_challenges WHERE id = ?')
      .bind(challengeId).first();
    if (!row) return json({ error: 'Challenge expirado' }, 400, origin);

    const clientData = JSON.parse(new TextDecoder().decode(b64urlDecode(credential.response.clientDataJSON)));
    if (clientData.challenge !== row.challenge)
      return json({ error: 'Challenge inválido' }, 400, origin);

    await env.DB.prepare('INSERT OR REPLACE INTO bio_credentials VALUES (?,?,?,?)')
      .bind(credential.id, credential.response.attestationObject, 0, Date.now()).run();
    await env.DB.prepare('DELETE FROM bio_challenges WHERE id = ?').bind(challengeId).run();
    return json({ ok: true }, 200, origin);
  }

  // ── /api/bio/auth/start ────────────────────────────────────────────────────
  if (path.endsWith('/auth/start') && request.method === 'POST') {
    const creds = await env.DB.prepare('SELECT cred_id FROM bio_credentials').all();
    if (!creds.results?.length)
      return json({ error: 'Sin credenciales registradas' }, 404, origin);

    await cleanChallenges(env.DB);
    const challenge = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO bio_challenges VALUES (?,?,?)')
      .bind(id, challenge, Date.now()).run();

    return json({ challengeId: id, publicKey: {
      challenge,
      rpId: RP_ID,
      allowCredentials: creds.results.map(r => ({ id: r.cred_id, type:'public-key', transports:['internal'] })),
      userVerification: 'required',
      timeout: 60000,
    }}, 200, origin);
  }

  // ── /api/bio/auth/finish ───────────────────────────────────────────────────
  if (path.endsWith('/auth/finish') && request.method === 'POST') {
    const { challengeId, credential } = await request.json();
    const row = await env.DB.prepare('SELECT challenge FROM bio_challenges WHERE id = ?')
      .bind(challengeId).first();
    if (!row) return json({ error: 'Challenge expirado' }, 400, origin);

    const credRow = await env.DB.prepare('SELECT * FROM bio_credentials WHERE cred_id = ?')
      .bind(credential.id).first();
    if (!credRow) return json({ error: 'Credencial no reconocida' }, 401, origin);

    const clientData = JSON.parse(new TextDecoder().decode(b64urlDecode(credential.response.clientDataJSON)));
    if (clientData.challenge !== row.challenge)
      return json({ error: 'Challenge inválido' }, 400, origin);

    await env.DB.prepare('UPDATE bio_credentials SET counter = counter + 1 WHERE cred_id = ?')
      .bind(credential.id).run();
    await env.DB.prepare('DELETE FROM bio_challenges WHERE id = ?').bind(challengeId).run();

    return json({ ok: true }, 200, origin);
  }

  return json({ error: 'Not found' }, 404, origin);
}
