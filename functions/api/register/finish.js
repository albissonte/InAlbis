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
  const { challengeId, credential } = await request.json();
  const row = await env.DB.prepare('SELECT challenge FROM bio_challenges WHERE id = ?').bind(challengeId).first();
  if (!row) return json({ error: 'Challenge expirado' }, 400);
  const clientData = JSON.parse(new TextDecoder().decode(b64urlDecode(credential.response.clientDataJSON)));
  if (clientData.challenge !== row.challenge) return json({ error: 'Challenge inválido' }, 400);
  await env.DB.prepare('INSERT OR REPLACE INTO bio_credentials VALUES (?,?,?,?)').bind(credential.id, credential.response.attestationObject, 0, Date.now()).run();
  await env.DB.prepare('DELETE FROM bio_challenges WHERE id = ?').bind(challengeId).run();
  return json({ ok: true });
}
export async function onRequestOptions() { return new Response(null, { headers: { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type' }}); }
