/* =========================================================================
   Vista previa del panel (botón del ojo en /admin)
   -------------------------------------------------------------------------
   Muestra la página real mientras se edita: toma la plantilla (index.html
   con sus marcadores data-cms) y la rellena con lo que hay en el formulario,
   con el mismo motor que usa el build. Lo que se ve aquí es lo que se
   publica.

   Además liga formulario y vista previa en los dos sentidos:
     - el campo que se está editando se resalta en la página;
     - un clic en un elemento de la página abre y enfoca su campo.
   El motor marca cada elemento con data-ruta="hero.titulo"; del lado del
   formulario la ruta se lee de los id que pone Decap (hero-field-6 →
   titulo-field-7) y de la posición de cada elemento en las listas.

   El build (scripts/build.mjs) copia las plantillas y el motor a /admin/.

   Plantilla de bloques: además carga el HTML de cada bloque
   (admin/bloques.json) y los datos publicados (admin/datos/*.json). Una
   página se ve con el menú y pie guardados; "Sitio" (menú, marca, pie) se
   ve sobre la página de inicio guardada, y sus rutas llevan "sitio.".
   Un bloque apagado ("Oculto") no se ve, igual que en el sitio; en el
   formulario sigue completo.
   ========================================================================= */
const { aplicarContenido, enlazar = x => x } = await import('/admin/contenido.js');

// Una plantilla por página editable (inicio → index.html, etc.). El build
// las copia a /admin/plantilla-<nombre>.html y lista los nombres en sitio.js.
const plantillas = {};
function html(nombre) {
  plantillas[nombre] ??= fetch(`/admin/plantilla-${nombre}.html`)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); });
  return plantillas[nombre];
}
function plantilla(nombre) {
  return html(nombre).then(texto => {
    const cuerpo = texto.slice(texto.indexOf('>', texto.indexOf('<body')) + 1, texto.lastIndexOf('</body>'));
    // Los scripts no corren en la vista previa; se quitan para no ensuciarla.
    return cuerpo.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  });
}

// La vista previa vive dentro de /admin/: las rutas relativas del sitio
// (imagenes/foto.jpg) se vuelven absolutas (/imagenes/foto.jpg).
const RELATIVA = /(\s(?:src|href|poster)=")(?![a-z][\w+.-]*:|\/|#|")([^"]*")/gi;
const absoluta = texto => texto.replace(RELATIVA, '$1/$2');

const SITIO = window.SITIO || {};
const bloques = SITIO.bloques ? await fetch('/admin/bloques.json').then(r => r.json()).catch(() => ({})) : {};
const guardados = {};
const guardado = nombre => (guardados[nombre] ??= fetch(`/admin/datos/${nombre}.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({})));

const CMS = window.CMS;
// Los estilos de la vista previa son los de la página misma: sus <link
// rel="stylesheet"> y sus <style>. Un sitio puede agregar ajustes sólo para
// la vista previa en admin/vista-previa.css (p. ej. una cabecera fija que
// en el panel estorba).
const primera = (SITIO.paginas || [])[0];
if (primera) {
  const cabeza = await html(primera).then(t => t.slice(0, t.search(/<body[\s>]/i)), () => '');
  for (const [etiqueta] of cabeza.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel=["']?stylesheet/i.test(etiqueta)) continue;
    const href = (etiqueta.match(/\bhref=["']([^"']+)/i) || [])[1];
    if (href) CMS.registerPreviewStyle(new URL(href, location.origin + '/').href);
  }
  for (const [, css] of cabeza.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    CMS.registerPreviewStyle(css, { raw: true });
  }
}
if (SITIO.estilosVista) CMS.registerPreviewStyle('/admin/vista-previa.css');
// El resaltado no se pinta sobre el elemento (un contorno en un texto de
// varias líneas sale escalonado, y un contenedor con overflow lo recorta):
// es un recuadro aparte, del tamaño total del elemento, encima de todo.
// Sólo borde y halo: un fondo taparía el de botones y bloques oscuros.
CMS.registerPreviewStyle(`
  html, body { overflow-x: clip; }
  [data-ruta] { cursor: pointer; }
  .cms-vista-sitio [data-ruta]:not([data-ruta^="sitio."]), .cms-vista-pagina [data-ruta^="sitio."] { cursor: auto; }
  .cms-marco { position: absolute; z-index: 2147483647; pointer-events: none; box-sizing: border-box;
               border-radius: 6px; transition: top .12s, left .12s, width .12s, height .12s; }
  .cms-marco--activo { border: 2px solid #2f6fed; box-shadow: 0 0 0 4px rgba(47, 111, 237, .2); }
  .cms-marco--encima { border: 2px dashed rgba(47, 111, 237, .6); }
`, { raw: true });

/* ---------- Formulario: de campo a ruta y de ruta a campo ---------- */

const ID_CAMPO = /^(.+)-field-\d+$/;
const esItem = el => /ListItem/.test(el.className || '');
const esNodo = el => ID_CAMPO.test(el.id || '') || esItem(el);
const formulario = () => document.querySelector('[class*="ControlPaneContainer"]');

// Nodo de campo o de lista más cercano por encima de `el` (sin incluirlo).
function nodoPadre(el, tope) {
  for (let p = el.parentElement; p && p !== tope; p = p.parentElement) if (esNodo(p)) return p;
  return null;
}

function rutaDeCampo(el) {
  const raiz = formulario();
  const partes = [];
  for (let n = el; n && n !== raiz; n = n.parentElement) {
    if (ID_CAMPO.test(n.id || '')) partes.unshift(n.id.match(ID_CAMPO)[1]);
    else if (esItem(n)) partes.unshift(String([...n.parentElement.children].filter(esItem).indexOf(n)));
  }
  return partes;
}

// Ruta en el JSON: en listas de textos sueltos (Qué incluye) Decap nombra al
// campo interno ("punto"), pero en el JSON el elemento es el texto mismo.
function normalizar(partes, datos) {
  let v = datos;
  for (let i = 0; i < partes.length; i++) {
    if (v == null || typeof v !== 'object') return partes.slice(0, i).join('.');
    v = v[partes[i]];
  }
  return v === undefined ? partes.slice(0, -1).join('.') : partes.join('.');
}

// Hijos directos (en términos de campos) de un nodo del formulario.
function hijos(nodo, raiz) {
  return [...nodo.querySelectorAll('[id*="-field-"], [class*="ListItem"]')]
    .filter(el => esNodo(el) && (nodoPadre(el, raiz) || raiz) === nodo);
}

function abrir(nodo, raiz) {
  const boton = [...nodo.querySelectorAll('button[data-testid="expand-button"]')]
    .find(b => nodoPadre(b, raiz) === nodo);
  if (boton && boton.getAttribute('aria-label') === 'Expand') boton.click();
}

// Rutas de la vista previa → rutas del formulario abierto. En "Sitio" el
// formulario es sitio.json (las rutas de la página llevan "sitio."); en una
// página, lo de "sitio." no está en este formulario.
// El prefijo es el de la vista previa abierta (cada una lo deja en su
// documento): Decap puede volver a pintar la de otra entrada un momento.
const prefijoActual = () => (docVista && docVista.__prefijo) || '';
// ¿Se edita en el formulario abierto? (En una página, el menú y el pie no;
// en "Sitio", los bloques de la página no.)
const editableAqui = ruta => {
  const prefijo = prefijoActual();
  return prefijo ? ruta.startsWith(prefijo) : !(SITIO.sitio && ruta.startsWith('sitio.'));
};
// Elemento editable (en este formulario) más cercano.
const editableDe = el => {
  const e = el && el.closest('[data-ruta]');
  return e && editableAqui(e.getAttribute('data-ruta')) ? e : null;
};
async function irACampo(ruta) {
  const raiz = formulario();
  if (!raiz) return;
  const prefijo = prefijoActual();
  if (prefijo) {
    if (!ruta.startsWith(prefijo)) return;
    ruta = ruta.slice(prefijo.length);
  } else if (ruta.startsWith('sitio.') && SITIO.sitio) return;
  let nodo = raiz;
  for (const parte of ruta.split('.')) {
    abrir(nodo, raiz);
    await new Promise(r => requestAnimationFrame(r));
    const candidatos = hijos(nodo, raiz);
    const siguiente = /^\d+$/.test(parte)
      ? candidatos.filter(esItem)[Number(parte)]
      : candidatos.find(el => (el.id.match(ID_CAMPO) || [])[1] === parte);
    if (!siguiente) break;
    nodo = siguiente;
  }
  abrir(nodo, raiz);
  await new Promise(r => requestAnimationFrame(r));
  const control = nodo.matches('input, textarea') ? nodo : nodo.querySelector('input, textarea, [contenteditable="true"]');
  (control || nodo).scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (control) control.focus({ preventScroll: true });
}

/* ---------- Vista previa: resaltar el campo activo ---------- */

let rutaActiva = null;
let docVista = null;
let bajoMouse = null;
const MARGEN = 6;

// Coloca (o esconde) un recuadro sobre el área completa de `el`.
function enmarcar(tipo, el) {
  if (!docVista) return;
  let marco = docVista.querySelector(`.cms-marco--${tipo}`);
  if (!marco) {
    marco = docVista.createElement('div');
    marco.className = `cms-marco cms-marco--${tipo}`;
    marco.setAttribute('aria-hidden', 'true');
    docVista.body.appendChild(marco);
  }
  const r = el && el.isConnected ? el.getBoundingClientRect() : null;
  if (!r || !r.width || !r.height) { marco.hidden = true; return; }
  const win = docVista.defaultView;
  // Sin salirse por los lados: un elemento a todo lo ancho (un título, un
  // bloque) daría un recuadro más ancho que la página, y la vista previa
  // se podría recorrer hacia los lados al arrastrar.
  const ancho = docVista.documentElement.clientWidth;
  const izq = Math.max(r.left - MARGEN, 2), der = Math.min(r.right + MARGEN, ancho - 2);
  marco.style.top = `${r.top + win.scrollY - MARGEN}px`;
  marco.style.left = `${izq + win.scrollX}px`;
  marco.style.width = `${Math.max(der - izq, 0)}px`;
  marco.style.height = `${r.height + MARGEN * 2}px`;
  marco.hidden = false;
}

function reenmarcar() {
  const activo = docVista && docVista.querySelector('.cms-activo');
  enmarcar('activo', activo);
  enmarcar('encima', bajoMouse && bajoMouse !== activo ? bajoMouse : null);
}

function resaltar(desplazar) {
  if (!docVista) return;
  docVista.querySelectorAll('.cms-activo').forEach(el => el.classList.remove('cms-activo'));
  if (!rutaActiva) return reenmarcar();
  // El elemento exacto; si no hay, el más cercano que lo contenga
  // (p. ej. al enfocar una pregunta completa de la lista).
  let objetivo = null;
  for (let r = rutaActiva; r && !objetivo; r = r.includes('.') ? r.slice(0, r.lastIndexOf('.')) : '') {
    objetivo = docVista.querySelector(`[data-ruta="${CSS.escape(r)}"]`);
  }
  if (!objetivo) return reenmarcar();
  objetivo.classList.add('cms-activo');
  reenmarcar();
  if (desplazar) objetivo.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

let datosActuales = {};
document.addEventListener('focusin', e => {
  const raiz = formulario();
  if (!raiz || !raiz.contains(e.target)) return;
  const ruta = prefijoActual() + normalizar(rutaDeCampo(e.target), datosActuales);
  if (ruta === rutaActiva) return;
  rutaActiva = ruta;
  resaltar(true);
});

// Como en el formulario: un clic fuera de los campos quita el resaltado.
// (Al pasar de un campo a otro, relatedTarget es el campo nuevo y focusin
// ya se encarga.)
document.addEventListener('focusout', e => {
  const raiz = formulario();
  if (!raiz || !raiz.contains(e.target)) return;
  if (e.relatedTarget && raiz.contains(e.relatedTarget)) return;
  quitarResaltado();
});

function quitarResaltado() {
  if (rutaActiva === null) return;
  rutaActiva = null;
  resaltar(false);
}

/* ---------- Plantilla de vista previa ---------- */

// `pagina`: la plantilla que se muestra. Para "Sitio" es la de inicio, con
// sus bloques guardados y el sitio del formulario.
const vista = (nombre, pagina = nombre) => window.createClass({
  getInitialState() { return { plantilla: null, error: null }; },
  componentDidMount() {
    Promise.all([plantilla(pagina), SITIO.sitio ? guardado(nombre === 'sitio' ? pagina : 'sitio') : {}])
      .then(([p, otros]) => this.setState({ plantilla: p, otros }))
      .catch(() => this.setState({ error: 'No se pudo cargar la vista previa.' }));
  },
  componentDidUpdate() {
    if (!this.raiz) return;
    const doc = this.raiz.ownerDocument;
    doc.__prefijo = this.prefijo;
    if (SITIO.sitio) {
      doc.body.classList.toggle('cms-vista-sitio', !!this.prefijo);
      doc.body.classList.toggle('cms-vista-pagina', !this.prefijo);
    }
    if (doc !== docVista) {
      docVista = doc;
      doc.addEventListener('click', e => {
        // En la vista previa los enlaces no navegan: un clic edita.
        if (e.target.closest('a')) e.preventDefault();
        const el = editableDe(e.target);
        if (el) {
          // Se resalta de inmediato (los campos de imagen no reciben foco).
          rutaActiva = el.getAttribute('data-ruta');
          resaltar(false);
          irACampo(rutaActiva);
        } else {
          // Clic en una parte no editable: se quita el resaltado y se suelta
          // el campo del formulario, como al hacer clic fuera en el editor.
          quitarResaltado();
          const activo = document.activeElement;
          if (activo && formulario()?.contains(activo)) activo.blur();
        }
      });
      doc.addEventListener('mouseover', e => { bajoMouse = editableDe(e.target); reenmarcar(); });
      doc.addEventListener('mouseleave', () => { bajoMouse = null; reenmarcar(); });
      // Si cambia el tamaño (ventana, fuentes, imágenes que terminan de
      // cargar, un acordeón que se abre), los recuadros se recolocan.
      doc.defaultView.addEventListener('resize', reenmarcar);
      doc.addEventListener('toggle', () => setTimeout(reenmarcar, 400), true);
      new doc.defaultView.ResizeObserver(reenmarcar).observe(doc.body);
    }
    bajoMouse = null;
    resaltar(false);
  },
  render() {
    const h = window.h;
    if (this.state.error) return h('p', { style: { padding: '2rem' } }, this.state.error);
    if (!this.state.plantilla) return h('p', { style: { padding: '2rem' } }, 'Cargando vista previa…');
    datosActuales = this.props.entry.get('data').toJS();
    const esSitio = nombre === 'sitio';
    this.prefijo = esSitio ? 'sitio.' : '';
    // Los enlaces del menú y del pie se resuelven igual que en el build
    // (una opción que apunta a una página lleva a /pagina).
    const datos = esSitio
      ? { ...this.state.otros, sitio: enlazar(datosActuales) }
      : SITIO.sitio ? { ...datosActuales, sitio: enlazar(this.state.otros) } : datosActuales;
    const { html } = aplicarContenido(this.state.plantilla, datos, { marcar: true, bloques });
    return h('div', { ref: el => { this.raiz = el; }, dangerouslySetInnerHTML: { __html: absoluta(html) } });
  },
});

for (const nombre of SITIO.paginas || []) {
  CMS.registerPreviewTemplate(nombre, vista(nombre));
}
// Páginas nuevas (colección "paginas" del panel): mismo molde que inicio.
if (SITIO.bloques && (SITIO.paginas || []).includes('inicio')) {
  CMS.registerPreviewTemplate('paginas', vista('paginas', 'inicio'));
}
if (SITIO.sitio && (SITIO.paginas || []).length) {
  CMS.registerPreviewTemplate('sitio', vista('sitio', SITIO.paginas.includes('inicio') ? 'inicio' : SITIO.paginas[0]));
}
