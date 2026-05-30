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
  const creds = await env.DB.prepare('SELECT cred_id FROM bio_credentials').all();
  if (!creds.results?.length) return json({ error: 'Sin credenciales' }, 404);
  await cleanChallenges(env.DB);
  const challenge = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO bio_challenges VALUES (?,?,?)').bind(id, challenge, Date.now()).run();
  return json({ challengeId: id, publicKey: {
    challenge, rpId: env.RP_ID,
    allowCredentials: creds.results.map(r => ({ id: r.cred_id, type:'public-key', transports:['internal'] })),
    userVerification: 'required', timeout: 60000,
  }});
}
export async function onRequestOptions() { return new Response(null, { headers: { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type' }}); }
