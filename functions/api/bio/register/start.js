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
function json(data, status=200) {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type':'application/json',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Methods':'POST,OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type',
  }});
}
async function cleanChallenges(db) {
  await db.prepare('DELETE FROM bio_challenges WHERE created < ?')
    .bind(Date.now() - 5*60*1000).run();
}

export async function onRequestPost({request, env}) {
  const { user, pass } = await request.json();
  if (user !== ADMIN_USER || pass !== env.ADMIN_PASS)
    return json({ error: 'No autorizado' }, 401);
  await cleanChallenges(env.DB);
  const challenge = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO bio_challenges VALUES (?,?,?)').bind(id, challenge, Date.now()).run();
  const existing = await env.DB.prepare('SELECT cred_id FROM bio_credentials').all();
  const excludeCredentials = (existing.results||[]).map(r => ({ id: r.cred_id, type: 'public-key' }));
  return json({ challengeId: id, publicKey: {
    rp: { id: env.RP_ID, name: 'iA Terminal' },
    user: { id: b64urlEncode(new TextEncoder().encode('ia-admin')), name: ADMIN_USER, displayName: 'Admin' },
    challenge,
    pubKeyCredParams: [{ type:'public-key', alg:-7 }, { type:'public-key', alg:-257 }],
    authenticatorSelection: { authenticatorAttachment:'platform', userVerification:'required', residentKey:'required', requireResidentKey:true },
    excludeCredentials,
    timeout: 60000,
  }});
}
export async function onRequestOptions() { return new Response(null, { headers: { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type' }}); }
