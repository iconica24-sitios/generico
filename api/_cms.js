import crypto from 'crypto';

// =====================================================================
// Piezas compartidas del inicio de sesión del panel /admin
// =====================================================================
// (El guion bajo al inicio hace que Vercel no lo publique como ruta.)
//
// El editor entra con usuario y contraseña, no con GitHub:
//   1. /api/auth valida la contraseña y entrega al panel una SESIÓN
//      firmada por nosotros (no es una llave de GitHub).
//   2. El panel manda cada llamada a /api/github, que revisa la sesión
//      y la reenvía a GitHub con una llave temporal de la GitHub App.
// La llave de GitHub nunca sale del servidor.
//
// Variables de entorno (Vercel → Settings → Environment Variables):
//   CMS_USUARIOS             usuario:sal:hash, separados por comas
//                            (se generan con scripts/clave.mjs)
//   CMS_SECRETO              texto largo al azar para firmar sesiones
//   CMS_REPO                 dueño/repo que el panel puede editar
//   GITHUB_APP_ID            número de la GitHub App
//   GITHUB_APP_PRIVATE_KEY   llave privada (.pem) de la GitHub App
// =====================================================================

export const GITHUB_API = process.env.GITHUB_API_URL || 'https://api.github.com';
const HORAS_DE_SESION = 8;

const b64url = buf => Buffer.from(buf).toString('base64url');

/* ---------- Contraseñas ---------- */

function usuarios() {
  return (process.env.CMS_USUARIOS || '').split(',').map(s => s.trim()).filter(Boolean).map(linea => {
    const [usuario, sal, hash] = linea.split(':');
    return { usuario, sal, hash };
  });
}

export function verificarClave(usuario, clave) {
  const u = usuarios().find(x => x.usuario === String(usuario || '').trim().toLowerCase());
  // Sin usuario se calcula igual, para que la respuesta tarde lo mismo.
  const sal = u ? u.sal : 'sin-usuario';
  const calculado = crypto.scryptSync(String(clave || ''), sal, 32);
  if (!u) return false;
  const esperado = Buffer.from(u.hash, 'hex');
  return esperado.length === calculado.length && crypto.timingSafeEqual(esperado, calculado);
}

/* ---------- Sesiones ---------- */

function secreto() {
  const s = process.env.CMS_SECRETO;
  if (!s || s.length < 32) throw new Error('CMS_SECRETO falta o es muy corto (mínimo 32 caracteres)');
  return s;
}

export function crearSesion(usuario) {
  const datos = b64url(JSON.stringify({ u: usuario, exp: Date.now() + HORAS_DE_SESION * 3600e3 }));
  const firma = crypto.createHmac('sha256', secreto()).update(datos).digest('base64url');
  return `${datos}.${firma}`;
}

// Devuelve el usuario si la sesión es válida y no ha vencido; si no, null.
export function leerSesion(req) {
  const m = (req.headers.authorization || '').match(/^(?:token|bearer)\s+([\w-]+)\.([\w-]+)$/i);
  if (!m) return null;
  const esperada = crypto.createHmac('sha256', secreto()).update(m[1]).digest();
  const recibida = Buffer.from(m[2], 'base64url');
  if (recibida.length !== esperada.length || !crypto.timingSafeEqual(recibida, esperada)) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(m[1], 'base64url').toString());
    return exp > Date.now() ? u : null;
  } catch {
    return null;
  }
}

/* ---------- Llave temporal de la GitHub App ---------- */

function jwtDeApp() {
  const ahora = Math.floor(Date.now() / 1000);
  const cabeza = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  // iat un minuto atrás por si el reloj de GitHub va adelantado.
  const cuerpo = b64url(JSON.stringify({ iat: ahora - 60, exp: ahora + 540, iss: process.env.GITHUB_APP_ID }));
  // Vercel guarda los saltos de línea del .pem como "\n" literales.
  const llave = (process.env.GITHUB_APP_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const firma = crypto.createSign('RSA-SHA256').update(`${cabeza}.${cuerpo}`).sign(llave, 'base64url');
  return `${cabeza}.${cuerpo}.${firma}`;
}

// Se reutiliza mientras la instancia siga viva y le quede tiempo.
let cache = null;

export async function llaveDeGithub() {
  if (cache && cache.vence - Date.now() > 5 * 60e3) return cache.token;
  const repo = process.env.CMS_REPO;
  const jwt = jwtDeApp();
  const cabeceras = { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json', 'User-Agent': 'iconica24-cms' };

  const inst = await fetch(`${GITHUB_API}/repos/${repo}/installation`, { headers: cabeceras });
  if (!inst.ok) throw new Error(`La GitHub App no está instalada en ${repo} (${inst.status})`);
  const { id } = await inst.json();

  // Llave limitada a este repo y sólo a su contenido.
  const r = await fetch(`${GITHUB_API}/app/installations/${id}/access_tokens`, {
    method: 'POST',
    headers: cabeceras,
    body: JSON.stringify({ repositories: [repo.split('/')[1]], permissions: { contents: 'write' } }),
  });
  if (!r.ok) throw new Error(`GitHub no entregó la llave temporal (${r.status})`);
  const datos = await r.json();
  cache = { token: datos.token, vence: new Date(datos.expires_at).getTime() };
  return cache.token;
}

/* ---------- Respuesta para la ventana emergente de Decap ---------- */
// Protocolo de Decap:
//   ventana emergente → panel:  "authorizing:github"
//   panel → ventana emergente:  (cualquier mensaje, para saber su origen)
//   ventana emergente → panel:  "authorization:github:success:{token}"
// Sólo se entrega a una ventana de este mismo dominio.

export function origenDe(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

export function entregarAlPanel(res, estado, contenido, origen) {
  const mensaje = `authorization:github:${estado}:${JSON.stringify(contenido)}`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(`<!doctype html><html><body><p>Conectando con el panel…</p><script>
(function () {
  var origen = ${JSON.stringify(origen)};
  var mensaje = ${JSON.stringify(mensaje).replace(/</g, '\\u003c')};
  function recibir(e) {
    if (e.origin !== origen) return;
    window.removeEventListener('message', recibir);
    window.opener.postMessage(mensaje, origen);
  }
  window.addEventListener('message', recibir);
  window.opener.postMessage('authorizing:github', origen);
})();
</script></body></html>`);
}
