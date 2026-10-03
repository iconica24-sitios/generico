import { verificarClave, crearSesion, entregarAlPanel, origenDe } from './_cms.js';

// =====================================================================
// Inicio de sesión del panel /admin (Decap CMS)
// =====================================================================
// Decap abre esta ruta en una ventana emergente al dar clic en "Iniciar
// sesión". GET muestra el formulario; POST revisa usuario y contraseña y,
// si son correctos, entrega al panel una sesión firmada (ver _cms.js).
// =====================================================================

function escapar(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formulario(res, { usuario = '', error = '' } = {}) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(error ? 401 : 200).send(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex, nofollow"/>
<title>Iniciar sesión</title>
<style>
  :root { --tinta: #0b0b0c; --gris: #6b6f76; --borde: #d9dbe0; --acento: #16a34a; --error: #b42318; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f5f7;
         font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--tinta); }
  form { width: min(360px, calc(100vw - 32px)); background: #fff; border: 1px solid var(--borde);
         border-radius: 14px; padding: 28px; box-shadow: 0 10px 30px -18px rgba(0,0,0,.25); }
  h1 { margin: 0 0 4px; font-size: 1.25rem; }
  p.sub { margin: 0 0 20px; color: var(--gris); font-size: .92rem; }
  label { display: block; font-size: .85rem; font-weight: 600; margin: 14px 0 6px; }
  input { width: 100%; padding: 11px 12px; border: 1px solid var(--borde); border-radius: 9px; font: inherit; }
  input:focus { outline: 2px solid var(--acento); outline-offset: 1px; border-color: transparent; }
  button { width: 100%; margin-top: 22px; padding: 12px; border: 0; border-radius: 9px; background: var(--tinta);
           color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  .error { margin: 16px 0 0; color: var(--error); font-size: .9rem; }
</style>
</head>
<body>
<form method="post" action="/api/auth" autocomplete="on">
  <h1>Editor del sitio</h1>
  <p class="sub">Entra con el usuario y la contraseña que te dimos.</p>
  <label for="usuario">Usuario</label>
  <input id="usuario" name="usuario" autocomplete="username" autocapitalize="none" required value="${escapar(usuario)}" ${usuario ? '' : 'autofocus'}/>
  <label for="clave">Contraseña</label>
  <input id="clave" name="clave" type="password" autocomplete="current-password" required ${usuario ? 'autofocus' : ''}/>
  ${error ? `<p class="error" role="alert">${escapar(error)}</p>` : ''}
  <button type="submit">Entrar</button>
</form>
</body>
</html>`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return formulario(res);

  const { usuario = '', clave = '' } = req.body || {};
  if (!verificarClave(usuario, clave)) {
    // Una pausa fija encarece probar contraseñas a lo bruto.
    await new Promise(r => setTimeout(r, 1000));
    return formulario(res, { usuario, error: 'Usuario o contraseña incorrectos.' });
  }

  try {
    const token = crearSesion(String(usuario).trim().toLowerCase());
    entregarAlPanel(res, 'success', { token, provider: 'github' }, origenDe(req));
  } catch (err) {
    console.error('[auth]', err.message);
    entregarAlPanel(res, 'error', { message: 'El panel no está configurado. Avisa a quien administra tu sitio.' }, origenDe(req));
  }
}
