/* =========================================================================
   Contenido editable: rellena el HTML con los textos de contenido/*.json
   -------------------------------------------------------------------------
   El HTML sigue siendo la plantilla (diseño, clases, íconos). Los textos
   que el cliente puede cambiar desde /admin (Decap CMS) viven en un JSON y
   se marcan en el HTML con atributos:

     data-cms="hero.titulo"         reemplaza el contenido del elemento
     data-cms-href="plan.enlace"    reemplaza el atributo href (también
                                    -src, -alt, -content)
     data-cms-list="faq.preguntas"  repite su primer hijo marcado con
                                    data-cms-item, una vez por elemento
     data-cms=".pregunta"           dentro de una lista: clave del elemento
                                    ("." es el elemento mismo)
     data-cms="{.meses} meses"      texto armado con valores entre llaves
     "lista.-1.precio"              un índice negativo cuenta desde el final
                                    (-1 es el último elemento)
     data-cms-index                 número del elemento en la lista (01, 02…)
     data-cms-optional              si el valor está vacío, el elemento
                                    desaparece
     data-cms-href="tel:+52{negocio.telefono|digitos}"
                                    atributo armado con uno o más valores
                                    entre llaves; |digitos deja sólo los
                                    números ("55 1234 5678" → 5512345678)
                                    (también -id, -style, -value y -label;
                                    un id vacío se quita)
     data-cms-data-precio=".precio" pone el atributo data-precio (cualquier
                                    data-*; lo crea si no está)
     data-cms-selected="#ultimo"    atributo sin valor (selected, checked,
                                    open, hidden): se pone si se cumple la
                                    condición y se quita si no
     data-cms-if=".foto"            el elemento sólo aparece si el valor no
                                    está vacío (o es true); "!.foto" al revés;
                                    ".icono=flor" / ".icono!=flor" compara;
                                    dentro de una lista, "#primero" y
                                    "#ultimo" según la posición
     data-cms-class="destacado:.destacado"
                                    agrega la clase si el valor no está vacío
                                    (varias separadas por coma)
     data-cms-bloques="bloques"     página armada con bloques: por cada
                                    elemento de la lista pone el bloque de su
                                    tipo (opciones.bloques[tipo], un HTML con
                                    claves relativas: ".titulo"). Un bloque
                                    con "oculto": true no se publica ni se
                                    ve en la vista previa (en el formulario
                                    del panel sigue completo)
     "@sitio.negocio.telefono"      en cualquier clave: se lee desde la raíz de
                                    los datos (p. ej. un bloque que muestra el
                                    teléfono que se escribe en Sitio)

   Los textos admiten un marcado mínimo, para no pedirle HTML al cliente:
     ==texto==      resaltado (<span class="hl">)
     **texto**      negritas
     [texto](url)   enlace
     ^1^            llamada a nota (<sup class="note">)
     salto de línea <br>

   A prueba de fallos: si falta una clave en el JSON, el texto original del
   HTML se queda como está y sólo se avisa en el log del build.

   Para la maqueta (consola → Descargar maqueta), { maqueta: true } rellena
   el contenido pero conserva las marcas data-cms, y encierra cada bloque
   entre <!-- ▼ bloque: tipo --> y <!-- ▲ bloque: tipo -->.

   Para la vista previa del panel, { marcar: true } deja en cada elemento
   editable un data-ruta con su ruta completa en el JSON (hero.titulo,
   faq.preguntas.3.respuesta…), para ligarlo con su campo del formulario.
   ========================================================================= */

const ATRIBUTOS = ['href', 'src', 'alt', 'content', 'id', 'style', 'value', 'label'];
const BOOLEANOS = ['selected', 'checked', 'open', 'hidden'];

// Etiquetas y comentarios. Los comentarios se saltan: el HTML guarda
// secciones desactivadas dentro de <!-- --> que no deben contarse.
const TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const VACIAS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function escaparTexto(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapar(s) {
  return escaparTexto(s).replace(/"/g, '&quot;');
}

export function marcado(texto) {
  return escaparTexto(texto)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, url) => {
      if (/^\s*(?:javascript|data|vbscript):/i.test(url)) url = '#';
      url = url.replace(/"/g, '&quot;');
      return /^https?:\/\//.test(url) ? `<a href="${url}" target="_blank" rel="noopener">${t}</a>` : `<a href="${url}">${t}</a>`;
    })
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/==(.+?)==/g, '<span class="hl">$1</span>')
    .replace(/\^(\w+)\^/g, '<sup class="note">$1</sup>')
    .replace(/\r?\n/g, '<br>');
}

let raiz = {};
function leer(ctx, clave) {
  if (clave.startsWith('@')) return leer(raiz, clave.slice(1));
  if (clave === '.') return ctx;
  let v = ctx;
  for (const parte of clave.replace(/^\./, '').split('.')) {
    if (v == null) return undefined;
    v = Array.isArray(v) && /^-\d+$/.test(parte) ? v[v.length + Number(parte)] : v[parte];
  }
  return v;
}

// La misma clave con los índices negativos ya resueltos ("l.-1" → "l.2"),
// para que la vista previa la ligue con su campo.
function concretar(ctx, clave) {
  if (!/\.-\d/.test(clave)) return clave;
  const arroba = clave.startsWith('@');
  let v = arroba ? raiz : ctx;
  const partes = (arroba ? clave.slice(1) : clave).split('.');
  const hechas = partes.map((parte, i) => {
    if (i === 0 && parte === '') return parte;
    if (Array.isArray(v) && /^-\d+$/.test(parte)) parte = String(v.length + Number(parte));
    v = v == null ? undefined : v[parte];
    return parte;
  });
  return (arroba ? '@' : '') + hechas.join('.');
}

// Valor de un atributo: una clave ("plan.enlace") o una plantilla con claves
// entre llaves ("mailto:{negocio.correo}"). null si falta alguna clave.
const LLAVE = /\{([^{}|]+)(\|digitos)?\}/g;
// `valido` revisa cada valor que entra (en style, que sea un valor simple).
function valorDeAtributo(ctx, clave, valido = () => true) {
  if (!clave.includes('{')) { const x = leer(ctx, clave); return x == null || !valido(String(x)) ? null : x; }
  let falta = false;
  const v = clave.replace(LLAVE, (_, k, digitos) => {
    const x = leer(ctx, k.trim());
    if (x == null || !valido(String(x))) { falta = true; return ''; }
    return digitos ? String(x).replace(/\D/g, '') : String(x);
  });
  return falta ? null : v;
}
// Clave con la que se edita un atributo (la primera, si es plantilla).
const claveDeAtributo = clave => (clave.includes('{') ? (clave.match(/\{([^{}|]+)/) || [])[1]?.trim() ?? clave : clave);

function atributo(etiqueta, nombre) {
  const m = etiqueta.match(new RegExp(`\\s${nombre}(?:="([^"]*)")?(?=[\\s/>])`));
  return m ? (m[1] ?? '') : null;
}

// Siguiente etiqueta de apertura (fuera de comentarios) que cumpla `prueba`.
function buscar(html, desde, prueba) {
  TOKEN.lastIndex = desde;
  let m;
  while ((m = TOKEN.exec(html))) {
    if (m[2] && !m[1] && prueba(m[0])) {
      return { inicio: m.index, finApertura: TOKEN.lastIndex, nombre: m[2].toLowerCase(), apertura: m[0] };
    }
  }
  return null;
}

// Posición de la etiqueta de cierre que corresponde a `el`.
function cierre(html, el) {
  if (VACIAS.has(el.nombre) || el.apertura.endsWith('/>')) return null;
  TOKEN.lastIndex = el.finApertura;
  let nivel = 1, m;
  while ((m = TOKEN.exec(html))) {
    if (!m[2] || m[2].toLowerCase() !== el.nombre) continue;
    nivel += m[1] ? -1 : 1;
    if (nivel === 0) return { inicio: m.index, fin: TOKEN.lastIndex };
  }
  throw new Error(`<${el.nombre}> sin cierre en la posición ${el.inicio}`);
}

function limpiarApertura(etiqueta) {
  // En la maqueta las marcas se conservan: se renombran mientras se arma
  // la página (para no volver a procesarlas) y al final recuperan su nombre.
  if (maqueta) return etiqueta.replace(/(\s)data-cms(?=[-="\s/>])/g, '$1data-cmz');
  return etiqueta.replace(/\s+data-cms(?:-[\w-]+)?(?:="[^"]*")?(?=[\s/>])/g, '');
}

// Apertura de una lista ya resuelta: se quitan su data-cms-list y su
// data-cms-if; si le quedan otras marcas (un data-cms-data-total…), se
// conservan para que el paso de atributos las resuelva.
function soltarLista(etiqueta) {
  const marcas = /\s+data-cms-(?:list|if)(?:="[^"]*")?(?=[\s/>])/g;
  if (!/\sdata-cms/.test(etiqueta.replace(marcas, ''))) return limpiarApertura(etiqueta);
  return maqueta ? etiqueta.replace(/(\s)data-cms-(list|if)(?=[="\s/>])/g, '$1data-cmz-$2') : etiqueta.replace(marcas, '');
}

const avisos = [];
let marcar = false;
let maqueta = false;
let bloques = {};

// Un valor "cuenta" si no está vacío: ni null, ni "", ni false, ni [].
function verdadero(v) {
  return v != null && v !== '' && v !== false && !(Array.isArray(v) && !v.length);
}
function condicion(ctx, clave, lugar = {}) {
  // Posición dentro de la lista: "#primero", "#ultimo" (y "!#ultimo").
  const posicion = clave.match(/^(!?)#(primero|ultimo)$/);
  if (posicion) {
    const { indice, total } = lugar;
    const es = indice != null && (posicion[2] === 'primero' ? indice === 0 : indice === total - 1);
    return posicion[1] ? !es : es;
  }
  // Comparación: ".icono=flor", ".icono!=flor".
  const cmp = clave.match(/^([^=!]+)(!?=)(.*)$/);
  if (cmp) {
    const igual = String(leer(ctx, cmp[1].trim()) ?? '') === cmp[3].trim();
    return cmp[2] === '=' ? igual : !igual;
  }
  const no = clave.startsWith('!');
  const v = verdadero(leer(ctx, no ? clave.slice(1) : clave));
  return no ? !v : v;
}

// En un style sólo pasan valores simples (colores, medidas): nada de url(),
// comillas ni punto y coma que abran otra declaración.
const ESTILO_SEGURO = /^[#\w\s.,%()+-]*$/;

// Quita un elemento completo, con la sangría que lo precedía.
function quitar(html, el, c) {
  const salto = el.inicio > 0 ? html.lastIndexOf('\n', el.inicio - 1) : -1;
  const desde = salto >= 0 && /^\s*$/.test(html.slice(salto + 1, el.inicio)) ? salto : el.inicio;
  return { html: html.slice(0, desde) + html.slice(c ? c.fin : el.finApertura), pos: desde };
}

// Ruta completa de una clave: las que empiezan con "." son relativas al
// elemento de la lista en curso (base).
function rutaDe(clave, base, ctx) {
  if (ctx !== undefined) clave = concretar(ctx, clave);
  if (clave.startsWith('@')) return clave.slice(1);
  if (!clave.startsWith('.')) return clave;
  return clave === '.' ? base : `${base}${clave}`;
}

function conRuta(apertura, ruta) {
  if (!marcar || !ruta) return apertura;
  return apertura.replace(/\s*\/?>$/, m => ` data-ruta="${escapar(ruta)}"${m}`);
}

// Pone un atributo con su valor: lo reemplaza si ya está, si no lo agrega.
function ponerAtributo(apertura, nombre, valor) {
  const re = new RegExp(`(\\s${nombre}=")[^"]*(")`);
  if (re.test(apertura)) return apertura.replace(re, (_, antes, despues) => antes + escapar(valor) + despues);
  return apertura.replace(/\s*\/?>$/, m => ` ${nombre}="${escapar(valor)}"${m}`);
}

function renderizar(html, ctx, indice, base = '', total) {
  const lugar = { indice, total };
  // 0) Bloques: cada elemento de la lista con el HTML de su tipo.
  let pos = 0, el;
  while ((el = buscar(html, pos, t => atributo(t, 'data-cms-bloques') !== null))) {
    const clave = atributo(el.apertura, 'data-cms-bloques');
    const c = cierre(html, el);
    const items = leer(ctx, clave);
    const ruta = rutaDe(clave, base);
    let nuevo = '';
    if (!Array.isArray(items)) avisos.push(`falta la lista de bloques "${clave}"`);
    else {
      nuevo = items.map((item, i) => {
        const tpl = bloques[item && item.tipo];
        if (!tpl) { avisos.push(`bloque "${item && item.tipo}" desconocido en ${ruta}.${i}`); return ''; }
        // Bloque apagado: no se publica ni se ve en la vista previa, pero su
        // contenido sigue guardado (y en el formulario del panel).
        const oculto = item.oculto === true;
        if (oculto && !maqueta) return '';
        const hecho = renderizar(tpl.trim(), item, i, `${ruta}.${i}`, items.length);
        const nota = oculto ? ' (oculto)' : '';
        return maqueta ? `\n<!-- ▼ bloque: ${item.tipo}${nota} -->\n${hecho}\n<!-- ▲ bloque: ${item.tipo} -->` : '\n' + hecho;
      }).filter(Boolean).join('\n') + '\n';
    }
    const apertura = limpiarApertura(el.apertura);
    html = html.slice(0, el.inicio) + apertura + nuevo + html.slice(c.inicio);
    pos = el.inicio + apertura.length + nuevo.length;
  }

  // 1) Listas, de la más externa hacia adentro (cada una se resuelve completa).
  pos = 0;
  while ((el = buscar(html, pos, t => atributo(t, 'data-cms-list') !== null))) {
    const clave = atributo(el.apertura, 'data-cms-list');
    const c = cierre(html, el);
    // Una lista con data-cms-if se resuelve aquí (después ya no quedaría la marca).
    const si = atributo(el.apertura, 'data-cms-if');
    if (si !== null && !condicion(ctx, si, lugar)) { ({ html, pos } = quitar(html, el, c)); continue; }
    const items = leer(ctx, clave);
    const interior = html.slice(el.finApertura, c.inicio);
    const tpl = buscar(interior, 0, t => atributo(t, 'data-cms-item') !== null);
    let nuevo = interior;
    if (!Array.isArray(items)) avisos.push(`falta la lista "${clave}"`);
    else if (!tpl) avisos.push(`la lista "${clave}" no tiene data-cms-item`);
    else {
      const plantilla = interior.slice(tpl.inicio, cierre(interior, tpl).fin);
      // Sangría del primer elemento, para que el HTML publicado siga legible.
      const sangria = interior.slice(0, tpl.inicio);
      const k = interior.lastIndexOf('\n');
      const cola = k >= 0 ? interior.slice(k) : '';
      const ruta = rutaDe(clave, base);
      nuevo = items.map((item, i) => sangria + renderizar(plantilla, item, i, `${ruta}.${i}`, items.length)).join('') + cola;
    }
    const apertura = soltarLista(el.apertura);
    html = html.slice(0, el.inicio) + apertura + nuevo + html.slice(c.inicio);
    pos = el.inicio + apertura.length + nuevo.length;
  }

  // 2) Textos y atributos.
  pos = 0;
  while ((el = buscar(html, pos, t => /\sdata-cms/.test(t)))) {
    let apertura = el.apertura;
    const si = atributo(apertura, 'data-cms-if');
    if (si !== null && !condicion(ctx, si, lugar)) {
      ({ html, pos } = quitar(html, el, cierre(html, el)));
      continue;
    }
    for (const a of ATRIBUTOS) {
      const clave = atributo(apertura, `data-cms-${a}`);
      if (clave === null) continue;
      const v = valorDeAtributo(ctx, clave, a === 'style' ? x => ESTILO_SEGURO.test(x) : undefined);
      if (v == null) { avisos.push(`falta o no es válido "${clave}"`); continue; }
      if (a === 'id' && v === '') { apertura = apertura.replace(/\sid="[^"]*"/, ''); continue; }
      apertura = apertura.replace(new RegExp(`(\\s${a}=")[^"]*(")`), (_, antes, despues) => antes + escapar(v) + despues);
    }
    for (const [, nombre, clave] of [...apertura.matchAll(/\sdata-cms-data-([\w-]+)="([^"]*)"/g)]) {
      const v = valorDeAtributo(ctx, clave);
      if (v == null) { avisos.push(`falta "${clave}"`); continue; }
      apertura = ponerAtributo(apertura, `data-${nombre}`, v);
    }
    for (const b of BOOLEANOS) {
      const clave = atributo(apertura, `data-cms-${b}`);
      if (clave === null) continue;
      const tiene = new RegExp(`\\s${b}(?:="[^"]*")?(?=[\\s/>])`);
      apertura = apertura.replace(tiene, '');
      if (condicion(ctx, clave, lugar)) apertura = apertura.replace(/\s*\/?>$/, m => ` ${b}${m}`);
    }
    const clases = atributo(apertura, 'data-cms-class');
    if (clases !== null) {
      const agregar = clases.split(',').map(x => x.trim().split(':')).filter(([n, k]) => n && k && condicion(ctx, k.trim(), lugar)).map(([n]) => n.trim());
      if (agregar.length) {
        apertura = /\sclass="/.test(apertura)
          ? apertura.replace(/(\sclass=")([^"]*)(")/, (_, a, v, b) => `${a}${v ? v + ' ' : ''}${agregar.join(' ')}${b}`)
          : apertura.replace(/\s*\/?>$/, m => ` class="${agregar.join(' ')}"${m}`);
      }
    }

    const clave = atributo(apertura, 'data-cms');
    const esItem = atributo(apertura, 'data-cms-item') !== null;
    // Sin texto editable, la ruta es la del atributo (enlace, imagen…).
    const deAtributo = ['href', 'src', 'alt', 'content'].map(a => atributo(apertura, `data-cms-${a}`)).find(x => x !== null);
    const ruta = clave !== null ? rutaDe(claveDeAtributo(clave), base, ctx) : esItem ? base : deAtributo != null ? rutaDe(claveDeAtributo(deAtributo), base, ctx) : null;
    const conIndice = atributo(apertura, 'data-cms-index') !== null;
    const opcional = atributo(apertura, 'data-cms-optional') !== null;
    let contenido = null;
    if (conIndice) contenido = String((indice ?? 0) + 1).padStart(2, '0');
    else if (clave !== null) {
      const v = clave.includes('{') ? valorDeAtributo(ctx, clave) : leer(ctx, clave);
      if (v == null) avisos.push(`falta "${clave}"`);
      else contenido = marcado(v);
    }

    const c = cierre(html, el);
    if (opcional && contenido === '') {
      ({ html, pos } = quitar(html, el, c));
      continue;
    }
    apertura = conRuta(limpiarApertura(apertura), ruta);
    if (c && contenido !== null) {
      html = html.slice(0, el.inicio) + apertura + contenido + html.slice(c.inicio);
    } else {
      html = html.slice(0, el.inicio) + apertura + html.slice(el.finApertura);
    }
    pos = el.inicio + apertura.length;
  }
  return html;
}

export function aplicarContenido(html, datos, opciones = {}) {
  avisos.length = 0;
  marcar = !!opciones.marcar;
  maqueta = !!opciones.maqueta;
  bloques = opciones.bloques || {};
  raiz = datos || {};
  let salida = renderizar(html, datos);
  if (maqueta) salida = salida.replace(/(\s)data-cmz(?=[-="\s/>])/g, '$1data-cms');
  return { html: salida, avisos: [...avisos] };
}

/* ---------- Enlaces del sitio (menú, botón de la cabecera, pie) ----------
   Cada enlace de sitio.json puede apuntar a una página del sitio ("pagina":
   su nombre, elegido de una lista en el panel) o a una dirección escrita
   ("enlace": #ancla, /algo, https://…). Deja en cada uno su "url" final.
   Con `paginas` (los nombres de las páginas que existen), un enlace a una
   página que ya no está se quita: borrar una página no deja enlaces rotos.
   Sin `paginas` (vista previa, donde puede haber páginas recién creadas),
   no se quita nada.
   Con `ocultas` (anclas de bloques apagados de inicio, ver anclasOcultas),
   un enlace a #esa-ancla también se quita mientras el bloque esté apagado. */
export function enlazar(sitio, paginas, ocultas = []) {
  if (!sitio || typeof sitio !== 'object') return sitio;
  const existe = p => !paginas || paginas.includes(p);
  const url = e => (e && e.pagina ? `/${e.pagina}` : (e && e.enlace) || '#');
  const apagado = e => !(e && e.pagina) && ocultas.includes(String(url(e)).replace(/^\/?#/, ''));
  const vale = e => (!(e && e.pagina) || existe(e.pagina)) && !apagado(e);
  const lista = l => (Array.isArray(l) ? l.filter(vale).map(e => ({ ...e, url: url(e) })) : l);
  const copia = { ...sitio, menu: lista(sitio.menu) };
  if (sitio.boton) copia.boton = !vale(sitio.boton) ? { ...sitio.boton, texto: '' } : { ...sitio.boton, url: url(sitio.boton) };
  if (sitio.pie) copia.pie = { ...sitio.pie, enlaces: lista(sitio.pie.enlaces) };
  return copia;
}

// Anclas de los bloques apagados de una página (sin las que también tiene
// un bloque visible): el menú no debe llevar a una sección que no se publica.
export function anclasOcultas(datos) {
  const lista = datos && Array.isArray(datos.bloques) ? datos.bloques : [];
  const de = oculto => new Set(lista.filter(b => b && b.ancla && (b.oculto === true) === oculto).map(b => String(b.ancla)));
  const visibles = de(false);
  return [...de(true)].filter(a => !visibles.has(a));
}
