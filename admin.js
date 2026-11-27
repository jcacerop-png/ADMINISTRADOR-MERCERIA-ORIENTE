"use strict";
/* =========================================================
   Panel de administración: login, catálogo, plantillas y notas.
   Requiere config.js y comun.js (cargados antes).
   ========================================================= */

const CUENTAS = {
  "rodolfo019@merceria.com": "Rodolfo",
  "administrador029@merceria.com": "Administrador",
};
const MAX_FOTOS = 8;

const adm = {
  usuaria: null,
  productos: [],
  tipos: [],
  actividad: [],
  notas: [],
  cashea: [],
  cierres: [],          // meses cerrados de Cashea (cierres_mensuales)
  chip: "todos",
  estado: "todos",      // filtro rápido en Catálogo: todos, publicados, sin-foto, ocultos, agotados, destacados
  q: "",
  form: null,           // producto abierto en el formulario
  subiendoFoto: false,  // bloquea Guardar mientras termina de subir una foto
  plantilla: "maquina", // tipo que se edita en "Editar plantillas"
  tab: "inicio"         // pestaña abierta (para refrescar solo lo que se ve)
};

const varianteDispAdm = v => (v && typeof v.disponible === "boolean") ? v.disponible : (Number(v && v.stock) || 0) > 0;
const stockDe = p => {
  const vars = Array.isArray(p.variantes) ? p.variantes : [];
  if (!vars.length) return 1;
  return vars.reduce((a, v) => {
    const st = Number(v.stock);
    if (Number.isFinite(st) && st > 0) return a + st;
    return a + (varianteDispAdm(v) ? 1 : 0);
  }, 0);
};
const fotoDe = p => (Array.isArray(p.fotos) && p.fotos[0]) || "";
const plantillaDe = tipo => adm.tipos.find(t => t.codigo === tipo) || { campos: [], accesorios: [], usos: [] };
const lineasDe = t => String(t || "").split("\n").map(s => s.trim()).filter(Boolean);
const fechaHora = iso => new Date(iso).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const kpi = (titulo, valor, extra = "") => `<div class="card kpi" ${extra}><small>${titulo}</small><strong>${valor}</strong></div>`;
const variantesPorDefecto = (precioBase = "") => [{
  nombre: "Única",
  precio: precioBase !== "" && precioBase !== null && precioBase !== undefined ? precioBase : "",
  disponible: true,
  stock: 1,
}];

function textoPrecioProductoAdm(p) {
  const vars = Array.isArray(p.variantes) ? p.variantes : [];
  const precios = vars
    .map(v => (v && v.precio !== undefined && v.precio !== null && v.precio !== "") ? Number(v.precio) : Number(p.precio))
    .filter(n => Number.isFinite(n) && n >= 0);
  if (precios.length > 1) {
    const min = Math.min(...precios);
    const max = Math.max(...precios);
    if (Math.abs(max - min) >= 0.005) return `${usd(min)} – ${usd(max)}`;
  }
  return usd(precios[0] ?? p.precio);
}

/* ---------- Login y animaciones ---------- */
function actualizarRol() {
  const sel = $("#selCuenta");
  if (!sel) return;
  const dueno = sel.value === "rodolfo019@merceria.com";
  const rol = $("#rolCuenta");
  if (rol) rol.textContent = dueno ? "Dueño" : "Administrador";
}

function animarLogoLogin(enfocar = false) {
  const btn = $("#loginLogoBtn");
  if (!btn) return;
  btn.classList.remove("giro-activo");
  void btn.offsetWidth; // reinicia la animación CSS
  btn.classList.add("giro-activo");
  setTimeout(() => btn.classList.remove("giro-activo"), 900);
  if (enfocar) {
    const pass = $("#loginPassword");
    if (pass) pass.focus();
  }
}

function actualizarAnimacionPassword() {
  const pass = $("#loginPassword");
  const barra = $("#passEnergiaBarra");
  const puntos = $("#passPuntos");
  const box = $("#passBox");
  const logo = $("#loginLogoBtn");
  if (!pass) return;
  const n = pass.value.length;
  const pct = Math.min(100, Math.round((n / 12) * 100));
  if (barra) {
    barra.style.width = `${pct}%`;
    barra.classList.toggle("cargada", n >= 6);
  }
  if (puntos) {
    const cantidad = Math.min(n, 16);
    puntos.innerHTML = Array.from({ length: cantidad }, (_, i) =>
      `<span class="pass-punto" style="--i:${i}"></span>`
    ).join("");
  }
  if (box) box.classList.toggle("escribiendo", n > 0);
  if (logo) {
    logo.classList.toggle("escribiendo", n > 0);
    logo.style.setProperty("--angulo-tecla", `${(n * 30) % 360}deg`);
  }
}

function alternarVerPassword() {
  const pass = $("#loginPassword");
  const btn = $("#btnVerPass");
  if (!pass) return;
  const mostrar = pass.type === "password";
  pass.type = mostrar ? "text" : "password";
  if (btn) btn.classList.toggle("viendo", mostrar);
  pass.focus();
}

function mostrarLogin() {
  $("#app").hidden = true;
  $("#login").hidden = false;
  const portal = $("#loginPortal");
  if (portal) {
    portal.hidden = true;
    portal.classList.remove("activo");
  }
  const card = $("#loginCard");
  if (card) card.classList.remove("saliendo");
  const form = $("#loginForm");
  if (form && form.elements.password) {
    form.elements.password.value = "";
    form.elements.password.type = "password";
  }
  const btnVer = $("#btnVerPass");
  if (btnVer) btnVer.classList.remove("viendo");
  $("#loginError").hidden = true;
  actualizarRol();
  actualizarAnimacionPassword();
}

async function iniciarSesion(e) {
  e.preventDefault();
  const form = e.target;
  const email = form.elements.cuenta.value;
  const password = form.elements.password.value;
  const btn = $("#btnEntrar");
  const error = $("#loginError");
  let ok = false;

  btn.disabled = true;
  error.hidden = true;
  animarLogoLogin(false);
  try {
    const { error: err } = await sb.auth.signInWithPassword({ email, password });
    if (err) throw err;
    ok = true;
  } catch {
    error.textContent = "Contraseña incorrecta.";
    error.hidden = false;
    form.classList.remove("error-shake");
    void form.offsetWidth;
    form.classList.add("error-shake");
    setTimeout(() => form.classList.remove("error-shake"), 550);
  } finally {
    btn.disabled = false;
  }

  if (ok) {
    form.elements.password.value = "";
    actualizarAnimacionPassword();
    adm.usuaria = CUENTAS[email] || "Administrador";
    await entrarPanelConTransicion();
  }
}

async function entrarPanelConTransicion() {
  const portal = $("#loginPortal");
  const card = $("#loginCard");
  const saludo = $("#portalSaludo");
  if (saludo) saludo.textContent = `Bienvenido, ${adm.usuaria}`;
  if (card) card.classList.add("saliendo");
  if (portal) {
    portal.hidden = false;
    void portal.offsetWidth;
    portal.classList.add("activo");
  }

  $("#quien").textContent = `Sesión: ${adm.usuaria}`;
  suscribir();
  const promesaCarga = cargar();
  await new Promise(r => setTimeout(r, 950));

  $("#login").hidden = true;
  if (portal) {
    portal.classList.remove("activo");
    portal.hidden = true;
  }
  if (card) card.classList.remove("saliendo");
  const app = $("#app");
  app.hidden = false;
  app.classList.remove("entrada-panel");
  void app.offsetWidth;
  app.classList.add("entrada-panel");
  irA("inicio");
  await promesaCarga;
}

async function entrarPanel() {
  $("#login").hidden = true;
  $("#app").hidden = false;
  $("#quien").textContent = `Sesión: ${adm.usuaria}`;
  suscribir();
  irA("inicio");
  await cargar();
}

async function salir(aviso = "") {
  try {
    sb.removeAllChannels();
    await sb.auth.signOut();
  } catch (err) {
    console.error(err);
  }
  adm.usuaria = null;
  adm.form = null;
  cerrarModal();
  mostrarLogin();
  if (aviso) toast(aviso);
}

/* Verifica que haya una sesión JWT válida en Supabase antes de leer o guardar.
   Si el token está por vencer o expiró, intenta renovarlo con refreshSession().
   Si no hay sesión válida, redirige limpiamente al login en lugar de mostrar tablas vacías o error RLS. */
async function asegurarSesion() {
  if (!sb) return null;
  try {
    const { data, error } = await sb.auth.getSession();
    let session = !error && data ? data.session : null;
    const ahoraSeg = Math.floor(Date.now() / 1000);
    if (session && session.expires_at && session.expires_at - ahoraSeg < 90) {
      const ref = await sb.auth.refreshSession();
      if (!ref.error && ref.data && ref.data.session) session = ref.data.session;
    }
    if (!session) {
      const ref = await sb.auth.refreshSession();
      if (!ref.error && ref.data && ref.data.session) session = ref.data.session;
    }
    const email = session && session.user ? String(session.user.email || "").toLowerCase().trim() : "";
    if (!session || !CUENTAS[email]) {
      if (adm.usuaria) {
        await salir("Tu sesión expiró. Inicia sesión nuevamente para ver y guardar tus datos.");
      }
      return null;
    }
    adm.usuaria = CUENTAS[email];
    const quienEl = $("#quien");
    if (quienEl) quienEl.textContent = `Sesión: ${adm.usuaria}`;
    return session;
  } catch (err) {
    console.error("Error verificando sesión:", err);
    return null;
  }
}

function esErrorDeSesion(err) {
  if (!err) return false;
  const msg = String(err.message || err.error_description || "").toLowerCase();
  const code = String(err.code || "");
  return (
    code === "PGRST301" ||
    err.status === 401 ||
    msg.includes("jwt expired") ||
    msg.includes("invalid jwt") ||
    msg.includes("auth session missing") ||
    msg.includes("cuenta no autorizada")
  );
}

function suscribir() {
  sb.removeAllChannels();
  const refrescar = () => {
    if (typeof fm !== "undefined" && fm.subiendo) return;
    cargar();
  };
  sb.channel("panel-merceria")
    .on("postgres_changes", { event: "*", schema: "public", table: "productos" }, refrescar)
    .on("postgres_changes", { event: "*", schema: "public", table: "notas" }, refrescar)
    .on("postgres_changes", { event: "*", schema: "public", table: "actividad" }, refrescar)
    .on("postgres_changes", { event: "*", schema: "public", table: "tipos" }, refrescar)
    .subscribe();
}

/* ---------- Carga y pintado ---------- */
async function cargar() {
  if (!adm.usuaria) return;
  const sesion = await asegurarSesion();
  if (!sesion) return;
  try {
    const [p, t, a, n] = await Promise.all([
      sb.from("productos").select("*").order("nombre"),
      sb.from("tipos").select("*"),
      sb.from("actividad").select("*").order("creado_en", { ascending: false }).limit(40),
      sb.from("notas").select("*").order("creado_en", { ascending: false }).limit(200),
    ]);
    for (const r of [p, t, a, n]) if (r.error) throw r.error;
    adm.productos = p.data || [];
    adm.tipos = t.data || [];
    fijarCategorias(adm.tipos);
    adm.actividad = a.data || [];
    adm.notas = n.data || [];
    pintarInicio();
    pintarCatalogo();
    pintarNotas();
    alEntrarTab(adm.tab);
  } catch (err) {
    if (esErrorDeSesion(err)) {
      await salir("Tu sesión expiró. Vuelve a iniciar sesión.");
      return;
    }
    toast("No se pudieron cargar los datos: " + (err.message || "error"));
  }
}

// Cada pestaña nueva se refresca solo cuando se abre (o cuando llegan cambios en vivo)
function alEntrarTab(tab) {
  if (tab === "calculadora" && typeof pintarCalculadora === "function") pintarCalculadora();
  if (tab === "carrusel") {
    if (typeof refrescarCarrusel === "function") refrescarCarrusel();
    if (typeof refrescarHeroPie === "function") refrescarHeroPie();
  }
  if (tab.startsWith("cashea") && typeof refrescarCashea === "function") {
    if (typeof fijarTiendaCashea === "function") fijarTiendaCashea(tab);
    refrescarCashea();
  }
  if (tab === "cierre" && typeof refrescarCashea === "function") refrescarCashea();
}

// Las cuatro pestañas de Cashea comparten una sola sección (la tienda cambia con la pestaña)
const VISTA_DE_TAB = { "cashea-merceria": "cashea", "cashea-decocintas": "cashea", "cashea-caracas": "cashea" };

function irA(tab) {
  adm.tab = tab;
  const vista = VISTA_DE_TAB[tab] || tab;
  $$("[data-view]").forEach(v => (v.hidden = v.dataset.view !== vista));
  $$("[data-tab]").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  window.scrollTo(0, 0);
  alEntrarTab(tab);
}

function pintarInicio() {
  const publicados = adm.productos.filter(p => p.activo);
  const sinStock = publicados.filter(p => stockDe(p) === 0).length;
  const sinFoto = adm.productos.filter(p => !fotoDe(p)).length;
  const ocultos = adm.productos.length - publicados.length;

  $("#saludo").textContent = `Hola, ${adm.usuaria}`;
  $("#kpis").innerHTML = [
    kpi("Publicados", publicados.length, 'data-kpi-estado="publicados" title="Ver productos publicados" style="cursor:pointer"'),
    kpi("Sin existencias", sinStock, 'data-kpi-estado="agotados" title="Ver productos sin existencias" style="cursor:pointer"'),
    kpi("Sin foto", sinFoto, 'data-kpi-estado="sin-foto" title="Ver productos sin foto" style="cursor:pointer"'),
    kpi("Ocultos", ocultos, 'data-kpi-estado="ocultos" title="Ver productos ocultos" style="cursor:pointer"'),
  ].join("");

  const bajos = [];
  adm.productos.forEach(p => (Array.isArray(p.variantes) ? p.variantes : []).forEach(v => {
    if (Number(v.stock) <= 2) bajos.push({ p, v });
  }));
  $("#bajos").innerHTML = bajos.slice(0, 40).map(({ p, v }) => `
    <li class="linea">
      <div><b>${esc(p.nombre)}</b><small>${esc(v.nombre)}</small></div>
      <strong class="${Number(v.stock) <= 0 ? "neg" : ""}">${Number(v.stock) <= 0 ? "Agotado" : `${v.stock} ud.`}</strong>
    </li>`).join("")
    || `<li class="muted">Todo con buena existencia.</li>`;

  $("#feed").innerHTML = adm.actividad.map(a => `
    <li class="linea"><div><b>${esc(a.usuaria)}</b> ${esc(a.texto)}<small>${fechaHora(a.creado_en)}</small></div></li>`).join("")
    || `<li class="muted">Aún no hay actividad.</li>`;
}

function tarjetaAdm(p) {
  const s = stockDe(p);
  const foto = fotoDe(p);
  const vars = Array.isArray(p.variantes) ? p.variantes : [];
  const tieneVariantesMultiples = vars.length > 1 || (vars.length === 1 && vars[0].nombre && normaTexto(vars[0].nombre) !== "unica");
  const varsResumen = tieneVariantesMultiples
    ? `<div class="adm-vars-pills">${vars.slice(0, 6).map(v => {
        const disp = varianteDispAdm(v);
        const pr = (v.precio !== undefined && v.precio !== null && v.precio !== "") ? Number(v.precio) : Number(p.precio);
        return `<span class="adm-var-chip ${disp ? "ok" : "off"}" title="${esc(v.nombre)} · ${usd(pr)} · ${disp ? "Disponible" : "Agotado"}">${esc(v.nombre)} · <b>${usd(pr)}</b></span>`;
      }).join("")}${vars.length > 6 ? `<span class="adm-var-chip mas">+${vars.length - 6} más</span>` : ""}</div>`
    : "";
  return `
  <article class="card prod-adm ${p.activo ? "" : "oculto"}">
    <div class="foto">
      ${foto
        ? `<img src="${esc(foto)}" data-zoom="${esc(foto)}" alt="${esc(p.nombre)}" loading="lazy">`
        : `<label class="sin-foto sin-foto-btn btn-file" title="Subir foto rápida a este producto">
             <span>+ Subir foto</span>
             <input type="file" accept="image/*" data-foto-rapida="${esc(p.id)}" class="sr">
           </label>`}
    </div>
    <div class="cuerpo">
      <div class="adm-head-row">
        <span class="tipo">${esc(CATEGORIAS[p.tipo] || "")}${p.codigo ? ` · <b>${esc(p.codigo)}</b>` : ""}${p.destacado ? " · ★ destacado" : ""}</span>
        <button type="button" class="ios-toggle-btn sm" data-action="activo" data-id="${esc(p.id)}" role="switch" aria-checked="${!!p.activo}" title="${p.activo ? "Publicado en el catálogo (toca para ocultar)" : "Oculto (toca para publicar)"}">
          <span class="ios-toggle-lbl">${p.activo ? "Publicado" : "Oculto"}</span>
          <span class="ios-switch ${p.activo ? "on ok" : ""}" aria-hidden="true"><span class="ios-knob"></span></span>
        </button>
      </div>
      <h3>${esc(p.nombre)}</h3>
      ${varsResumen}
      <div class="fila-precio">
        <strong>${textoPrecioProductoAdm(p)}</strong>
        <span class="pill ${s > 0 ? "ok" : "agotado"}">${s > 0 ? `Disponible (${s} ud.)` : "Agotado"}</span>
      </div>
      <div class="acciones-card">
        <button class="btn sm" data-action="editar" data-id="${esc(p.id)}">Editar</button>
        <label class="btn sm ghost btn-file" style="cursor:pointer" title="Subir o cambiar foto principal">+ Foto<input type="file" accept="image/*" data-foto-rapida="${esc(p.id)}" class="sr"></label>
        <button class="btn sm ghost" data-action="duplicar" data-id="${esc(p.id)}">Duplicar</button>
        <button class="btn sm peligro" data-action="borrar" data-id="${esc(p.id)}">Eliminar</button>
      </div>
    </div>
  </article>`;
}

function pintarCatalogo() {
  const total = adm.productos.length;
  const nPub = adm.productos.filter(p => p.activo).length;
  const nSinFoto = adm.productos.filter(p => !fotoDe(p)).length;
  const nOcultos = total - nPub;
  const nAgotados = adm.productos.filter(p => stockDe(p) <= 0).length;
  const nDestacados = adm.productos.filter(p => p.destacado).length;

  const estadoCont = $("#estadoAdm");
  if (estadoCont) {
    const estados = [
      ["todos", `Todos (${total})`],
      ["publicados", `Publicados (${nPub})`],
      ["sin-foto", `Sin foto (${nSinFoto})`],
      ["ocultos", `Ocultos (${nOcultos})`],
      ["agotados", `Sin stock (${nAgotados})`],
      ["destacados", `★ Destacados (${nDestacados})`],
    ];
    estadoCont.innerHTML = estados
      .map(([k, l]) => `<button type="button" class="chip sm ${adm.estado === k ? "on" : ""}" data-estado-adm="${k}">${esc(l)}</button>`)
      .join("");
  }

  $("#chipsAdm").innerHTML = [["todos", "Todas las categorías"], ...Object.entries(CATEGORIAS)]
    .map(([k, l]) => `<button type="button" class="chip ${adm.chip === k ? "on" : ""}" data-chip="${k}">${esc(l)}</button>`)
    .join("");

  const q = normaTexto(adm.q);
  const cumpleEstado = p => {
    if (adm.estado === "publicados") return !!p.activo;
    if (adm.estado === "sin-foto") return !fotoDe(p);
    if (adm.estado === "ocultos") return !p.activo;
    if (adm.estado === "agotados") return stockDe(p) <= 0;
    if (adm.estado === "destacados") return !!p.destacado;
    return true;
  };
  const lista = adm.productos.filter(p =>
    (adm.chip === "todos" || p.tipo === adm.chip) &&
    cumpleEstado(p) &&
    (!q || normaTexto(`${p.nombre} ${p.codigo || ""} ${CATEGORIAS[p.tipo] || ""} ${p.descripcion || ""}`).includes(q)));

  const conteo = $("#conteoAdm");
  if (conteo) {
    conteo.textContent = `Mostrando ${lista.length} de ${total} producto(s)`;
  }

  $("#gridAdm").innerHTML = lista.map(tarjetaAdm).join("")
    || `<p class="muted">No hay productos con este filtro. Prueba cambiando la categoría o el estado.</p>`;
}

function pintarNotas() {
  const orden = [...adm.notas].sort((a, b) =>
    (Number(a.hecha) - Number(b.hecha)) || String(b.creado_en).localeCompare(String(a.creado_en)));
  $("#listaNotas").innerHTML = orden.map(n => `
    <li class="nota-item ${n.hecha ? "hecho" : ""}">
      <button class="check" data-action="nota-toggle" data-id="${esc(n.id)}" aria-label="${n.hecha ? "Marcar como pendiente" : "Marcar como hecha"}">${n.hecha ? "✔" : ""}</button>
      <span>${esc(n.texto)}<small>${esc(n.usuaria)} · ${fechaHora(n.creado_en)}</small></span>
      <button class="x" data-action="nota-borrar" data-id="${esc(n.id)}" aria-label="Eliminar nota">✕</button>
    </li>`).join("")
    || `<li class="muted">No hay notas. Escribe tu primer pendiente arriba.</li>`;
}

/* ---------- Producto: datos del formulario ---------- */
function formNuevo(tipo) {
  const t = plantillaDe(tipo);
  return {
    id: null,
    tipo,
    codigo: "",
    nombre: "",
    descripcion: "",
    precio: "",
    precio_mayor: "",
    costo: "",
    destacado: false,
    activo: true,
    fotos: [],
    caracteristicas: t.campos.map(c => ({ campo: c, valor: "" })),
    accesorios: [...t.accesorios],
    usos: [...t.usos],
    documentos: [],
    variantes: variantesPorDefecto(),
  };
}

function formDesde(p) {
  const varsRaw = Array.isArray(p.variantes) && p.variantes.length ? p.variantes : variantesPorDefecto(p.precio);
  return {
    id: p.id,
    tipo: p.tipo || "otro",
    nombre: p.nombre || "",
    descripcion: p.descripcion || "",
    precio: p.precio ?? "",
    codigo: p.codigo || "",
    precio_mayor: p.precio_mayor ?? "",
    costo: p.costo ?? "",
    destacado: !!p.destacado,
    activo: p.activo !== false,
    fotos: [...(p.fotos || [])],
    caracteristicas: (p.caracteristicas || []).map(c => ({ campo: c.campo || "", valor: c.valor || "" })),
    accesorios: [...(p.accesorios || [])],
    usos: [...(p.usos || [])],
    documentos: (p.documentos || []).map(d => ({ nombre: d.nombre || "", url: d.url || "" })),
    variantes: varsRaw.map(v => {
      const disp = typeof v.disponible === "boolean" ? v.disponible : (Number(v.stock) || 0) > 0;
      const st = Number(v.stock);
      return {
        nombre: v.nombre || "",
        precio: v.precio !== undefined && v.precio !== null && v.precio !== "" ? v.precio : (p.precio ?? ""),
        disponible: disp,
        stock: Number.isFinite(st) && st >= 0 ? st : (disp ? 1 : 0),
        codigo: v.codigo || "",
      };
    }),
  };
}

function abrirFormulario(p) {
  const tipoInicial = Object.keys(CATEGORIAS)[0] || "maquina";
  adm.form = p ? formDesde(p) : formNuevo(CATEGORIAS.maquina ? "maquina" : tipoInicial);
  dibujarFormulario();
  abrirModal();
}

function dibujarFormulario() {
  const f = adm.form;
  if (!f) return;
  const opcionesTipo = Object.entries(CATEGORIAS)
    .map(([k, l]) => `<option value="${k}" ${f.tipo === k ? "selected" : ""}>${esc(l)}</option>`).join("");
  const fotoPrincipal = f.fotos[0] || "";
  const fotosExtra = f.fotos.slice(1);

  $("#modal .sheet").innerHTML = `
  <form id="formProd" class="stack" novalidate>
    <div class="sheet-head">
      <h2>${f.id ? "Editar producto base y variantes" : "Nuevo producto base y variantes"}</h2>
      <button type="button" class="x" data-cerrar aria-label="Cerrar">✕</button>
    </div>

    <div class="foto-base-bloque">
      <p class="label">Foto principal del producto base</p>
      <p class="hint">Sube una sola foto principal representativa para el producto base (ej. “Argolla Niquelada” o “Cierre”). Todas sus medidas o colores compartirán esta tarjeta.</p>
      <div class="foto-base-card">
        ${fotoPrincipal ? `
          <div class="foto-base-preview">
            <img src="${esc(fotoPrincipal)}" data-zoom="${esc(fotoPrincipal)}" alt="Foto principal">
            <span class="pill ok foto-base-badge">Foto principal</span>
          </div>
          <div class="foto-base-acciones">
            <label class="btn sm btn-file" style="cursor:pointer">
              ↻ Reemplazar foto principal
              <input type="file" id="fotoPrincipalIn" accept="image/*" class="sr">
            </label>
            <button type="button" class="btn sm peligro" data-action="quitar-foto" data-i="0">Quitar foto</button>
            ${f.fotos.length < MAX_FOTOS ? `
              <label class="btn sm ghost btn-file" style="cursor:pointer">
                + Foto adicional (opcional)
                <input type="file" id="fotosIn" accept="image/*" multiple class="sr">
              </label>` : ""}
          </div>
        ` : `
          <label class="subir subir-principal btn-file">
            <span class="subir-ico">📷</span>
            <strong>+ Subir foto principal del producto</strong>
            <small class="muted">JPG, PNG o WebP · Se optimiza y guarda automáticamente</small>
            <input type="file" id="fotoPrincipalIn" accept="image/*" class="sr">
          </label>
        `}
      </div>
      ${fotosExtra.length ? `
        <div class="fotos-pf" style="margin-top:10px">
          ${fotosExtra.map((u, idx) => {
            const i = idx + 1;
            return `
            <div class="foto-pf">
              <img src="${esc(u)}" data-zoom="${esc(u)}" alt="Foto ${i + 1}">
              <div class="acc-foto">
                <button type="button" class="btn sm ghost" data-action="foto-principal" data-i="${i}">Hacer principal</button>
                <button type="button" class="btn sm peligro" data-action="quitar-foto" data-i="${i}">Quitar</button>
              </div>
            </div>`;
          }).join("")}
        </div>` : ""}
      <p class="hint" style="margin-top:6px">${adm.subiendoFoto ? "Subiendo foto, espera un momento…" : "La foto se sube y publica en cuanto la eliges."}</p>
    </div>

    <div class="grid-form">
      <label>Código base (opcional / único)<input data-b="codigo" maxlength="40" autocomplete="off" placeholder="Ej. ACC-M-001" value="${esc(f.codigo)}"></label>
      <label>Categoría<select data-b="tipo">${opcionesTipo}</select></label>
    </div>
    <label>Nombre del producto base<input data-b="nombre" maxlength="120" placeholder="Ej. Argolla Niquelada, Cierre, Trabilla…" value="${esc(f.nombre)}"></label>
    <label>Descripción<textarea data-b="descripcion" rows="2" maxlength="1000" placeholder="Descripción general del producto…">${esc(f.descripcion)}</textarea></label>

    <div class="grid-form tres">
      <label>Precio base / desde (USD)<input data-b="precio" type="text" inputmode="decimal" autocomplete="off" placeholder="0,07" value="${esc(escribirPrecio(f.precio))}"></label>
      <label>Precio al por mayor (USD) · solo panel<input data-b="precio_mayor" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(escribirPrecio(f.precio_mayor))}"></label>
      <label>Costo (USD) · solo panel<input data-b="costo" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(escribirPrecio(f.costo))}"></label>
    </div>

    <div class="tog-row">
      <label class="tog ios-tog">
        <input type="checkbox" class="sr" data-b="destacado" ${f.destacado ? "checked" : ""}>
        <span class="ios-switch ${f.destacado ? "on" : ""}" aria-hidden="true"><span class="ios-knob"></span></span>
        <span>★ Producto destacado</span>
      </label>
      <label class="tog ios-tog">
        <input type="checkbox" class="sr" data-b="activo" ${f.activo ? "checked" : ""}>
        <span class="ios-switch ${f.activo ? "on ok" : ""}" aria-hidden="true"><span class="ios-knob"></span></span>
        <span>Publicado en el catálogo</span>
      </label>
    </div>

    <fieldset class="bloque var-builder">
      <legend>Constructor de variantes (Medidas y Colores)</legend>
      <div class="var-builder-cab">
        <p class="hint" style="margin:0">Agrega múltiples medidas (ej. <b>1,5 cm</b>, <b>2,0 cm</b>, <b>3,0 cm</b>) o colores (ej. <b>Rojo</b>, <b>Negro</b>, <b>Blanco</b>) con su <b>precio individual en USD</b> y su interruptor <b>Disponible / Agotado</b>.</p>
        <div class="var-builder-acciones">
          <button type="button" class="btn sm ghost" data-action="ordenar-var" title="Ordenar automáticamente de la medida más pequeña a la más grande">⇅ Ordenar menor a mayor</button>
          <button type="button" class="btn sm" data-action="agregar-var">+ Agregar variante</button>
        </div>
      </div>

      <div class="var-lote-bar">
        <input id="varLoteInput" type="text" placeholder="Carga rápida separada por comas: ej. 1,5 cm, 2,0 cm, 2,5 cm, 3,0 cm o Rojo, Negro, Blanco" autocomplete="off">
        <button type="button" class="btn sm ghost" data-action="lote-var">+ Crear opciones</button>
      </div>

      <div class="var-encabezados" aria-hidden="true">
        <span>Orden</span>
        <span>Etiqueta (Medida o Color)</span>
        <span>Precio individual (USD)</span>
        <span>Stock</span>
        <span>Estado (Disponible / Agotado)</span>
        <span></span>
      </div>

      <div class="var-lista-filas">
        ${f.variantes.map((v, i) => {
          const disp = v.disponible !== false;
          return `
          <div class="fila-var-v2 ${disp ? "" : "var-agotada"}" data-var-row="${i}">
            <div class="var-orden-btns">
              <span class="var-num">#${i + 1}</span>
              <button type="button" class="btn-mini-ord" data-action="subir-var" data-i="${i}" ${i === 0 ? "disabled" : ""} title="Subir opción" aria-label="Subir">▲</button>
              <button type="button" class="btn-mini-ord" data-action="bajar-var" data-i="${i}" ${i === f.variantes.length - 1 ? "disabled" : ""} title="Bajar opción" aria-label="Bajar">▼</button>
            </div>
            <label class="var-col-lbl">
              <span class="var-movil-lbl">Medida o Color</span>
              <input data-arr="var" data-i="${i}" data-k="nombre" value="${esc(v.nombre)}" placeholder="Ej. 1,5 cm o Rojo" aria-label="Etiqueta de la variante">
            </label>
            <label class="var-col-lbl">
              <span class="var-movil-lbl">Precio USD ($)</span>
              <input data-arr="var" data-i="${i}" data-k="precio" type="text" inputmode="decimal" autocomplete="off" placeholder="${esc(escribirPrecio(f.precio) || "0,00")}" value="${esc(escribirPrecio(v.precio))}" aria-label="Precio individual en USD">
            </label>
            <label class="var-col-lbl var-col-stock">
              <span class="var-movil-lbl">Existencias</span>
              <input data-arr="var" data-i="${i}" data-k="stock" type="number" min="0" step="1" inputmode="numeric" value="${esc(v.stock)}" aria-label="Existencias">
            </label>
            <div class="var-col-disp">
              <label class="ios-toggle-wrap">
                <input type="checkbox" class="sr" data-arr="var" data-i="${i}" data-k="disponible" ${disp ? "checked" : ""}>
                <span class="ios-switch ${disp ? "on ok" : ""}" aria-hidden="true"><span class="ios-knob"></span></span>
                <span class="ios-toggle-txt ${disp ? "ok" : "agotado"}" data-var-disp-txt="${i}">${disp ? "Disponible" : "Agotado"}</span>
              </label>
            </div>
            <button type="button" class="x var-del-btn" data-action="quitar-var" data-i="${i}" title="Quitar variante" aria-label="Quitar">✕</button>
          </div>`;
        }).join("")}
      </div>
    </fieldset>

    <fieldset class="bloque">
      <legend>Características</legend>
      <p class="hint">Vienen de la plantilla de su categoría. Puedes cambiar el nombre, el valor, o agregar y quitar filas.</p>
      ${f.caracteristicas.map((c, i) => `
        <div class="fila-car">
          <input data-arr="car" data-i="${i}" data-k="campo" value="${esc(c.campo)}" aria-label="Nombre de la característica">
          <input data-arr="car" data-i="${i}" data-k="valor" value="${esc(c.valor)}" placeholder="Valor" aria-label="Valor">
          <button type="button" class="x" data-action="quitar-car" data-i="${i}" aria-label="Quitar">✕</button>
        </div>`).join("")}
      <div><button type="button" class="btn sm ghost" data-action="agregar-car">+ Característica</button></div>
    </fieldset>

    <fieldset class="bloque">
      <legend>Accesorios incluidos</legend>
      <p class="hint">Uno por línea.</p>
      <textarea data-b="accesorios" rows="3">${esc(f.accesorios.join("\n"))}</textarea>
    </fieldset>

    <fieldset class="bloque">
      <legend>Usos</legend>
      <p class="hint">Uno por línea.</p>
      <textarea data-b="usos" rows="2">${esc(f.usos.join("\n"))}</textarea>
    </fieldset>

    <fieldset class="bloque">
      <legend>Documentos para descargar</legend>
      <p class="hint">Enlace directo a un PDF (opcional). Debe empezar con https://</p>
      ${f.documentos.map((d, i) => `
        <div class="fila-doc">
          <input data-arr="doc" data-i="${i}" data-k="nombre" value="${esc(d.nombre)}" placeholder="Nombre del documento" aria-label="Nombre del documento">
          <input data-arr="doc" data-i="${i}" data-k="url" value="${esc(d.url)}" placeholder="https://..." aria-label="Enlace">
          <button type="button" class="x" data-action="quitar-doc" data-i="${i}" aria-label="Quitar">✕</button>
        </div>`).join("")}
      <div><button type="button" class="btn sm ghost" data-action="agregar-doc">+ Documento</button></div>
    </fieldset>

    <div class="acciones-sheet">
      <button type="button" class="btn ghost" data-cerrar>Cancelar</button>
      <button class="btn" type="submit" ${adm.subiendoFoto ? "disabled" : ""}>${adm.subiendoFoto ? "Subiendo foto…" : "Guardar producto"}</button>
    </div>
  </form>`;
}

async function subirFotos(files, reemplazarPrincipal = false) {
  const f = adm.form;
  const lista = [...(files || [])];
  if (!f || !lista.length) return;
  if (!reemplazarPrincipal) {
    const libres = MAX_FOTOS - f.fotos.length;
    if (libres <= 0) return toast(`Máximo ${MAX_FOTOS} fotos por producto`);
  }

  const teniaFotos = f.fotos.length > 0;
  adm.subiendoFoto = true;
  dibujarFormulario();
  let subidas = 0;

  try {
    const archivosProcesar = reemplazarPrincipal ? lista.slice(0, 1) : lista.slice(0, MAX_FOTOS - f.fotos.length);
    for (const file of archivosProcesar) {
      const valida = typeof esArchivoImagen === "function" ? esArchivoImagen(file) : (file.type || "").startsWith("image/");
      if (!valida) { toast("Solo se pueden subir imágenes (JPG, PNG o WebP)"); continue; }
      if (file.size > 20 * 1024 * 1024) { toast("Esa foto pesa más de 20 MB"); continue; }
      try {
        toast("Subiendo foto principal…");
        const blob = await comprimir(file, 1200);
        const uid = typeof uuidSeguro === "function" ? uuidSeguro() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const ruta = `productos/${uid}.jpg`;
        const { error } = await sb.storage.from("catalogo").upload(ruta, blob, {
          contentType: blob.type || "image/jpeg",
          cacheControl: "31536000",
          upsert: true,
        });
        if (error) throw error;
        const urlPub = sb.storage.from("catalogo").getPublicUrl(ruta).data.publicUrl;
        if (reemplazarPrincipal) {
          if (f.fotos.length > 0) f.fotos[0] = urlPub;
          else f.fotos.push(urlPub);
        } else {
          f.fotos.push(urlPub);
        }
        subidas++;
      } catch (err) {
        toast("No se pudo subir la foto: " + (err.message || "error"));
      }
    }

    if (subidas > 0) {
      if (!teniaFotos && f.fotos.length > 0) f.activo = true;
      if (f.id) {
        const { error: errUpd } = await sb.from("productos")
          .update({ fotos: f.fotos, activo: f.activo, actualizado_en: new Date().toISOString() })
          .eq("id", f.id);
        if (!errUpd) {
          toast("Foto principal subida y guardada ✔");
          await cargar();
        }
      } else {
        toast("Foto principal lista ✔");
      }
    }
  } finally {
    adm.subiendoFoto = false;
    dibujarFormulario();
  }
}

// Subida rápida de foto desde la tarjeta del producto en el Catálogo (1 clic)
async function subirFotoRapida(id, files) {
  const p = adm.productos.find(x => x.id === id);
  const lista = [...(files || [])];
  if (!p || !lista.length) return;
  const actuales = Array.isArray(p.fotos) ? [...p.fotos] : [];
  const libres = MAX_FOTOS - actuales.length;
  if (libres <= 0) return toast(`Este producto ya tiene el máximo de ${MAX_FOTOS} fotos`);

  const nuevas = [];
  for (const file of lista.slice(0, libres)) {
    const valida = typeof esArchivoImagen === "function" ? esArchivoImagen(file) : (file.type || "").startsWith("image/");
    if (!valida) { toast("Elige un archivo de imagen válido"); continue; }
    if (file.size > 20 * 1024 * 1024) { toast("Esa foto pesa más de 20 MB"); continue; }
    try {
      toast(`Subiendo foto para ${p.nombre}…`);
      const blob = await comprimir(file, 1200);
      const uid = typeof uuidSeguro === "function" ? uuidSeguro() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const ruta = `productos/${uid}.jpg`;
      const { error } = await sb.storage.from("catalogo").upload(ruta, blob, {
        contentType: blob.type || "image/jpeg",
        cacheControl: "31536000",
        upsert: true,
      });
      if (error) throw error;
      nuevas.push(sb.storage.from("catalogo").getPublicUrl(ruta).data.publicUrl);
    } catch (err) {
      toast("No se pudo subir la foto: " + (err.message || "error"));
    }
  }
  if (!nuevas.length) return;

  const { error } = await sb.from("productos")
    .update({ fotos: [...actuales, ...nuevas], activo: true, actualizado_en: new Date().toISOString() })
    .eq("id", p.id);
  if (error) return toast("No se pudo asociar la foto: " + error.message);
  toast(`Foto guardada y "${p.nombre}" publicado ✔`);
  await cargar();
}

function cambiarTipo(tipo) {
  const f = adm.form;
  if (!f) return;
  if (f.id) {
    // Producto existente: solo cambia el tipo, sin reemplazar lo que ya escribiste
    f.tipo = tipo;
    return dibujarFormulario();
  }
  // Producto nuevo: carga la plantilla de ese tipo
  const base = formNuevo(tipo);
  Object.assign(f, {
    tipo,
    caracteristicas: base.caracteristicas,
    accesorios: base.accesorios,
    usos: base.usos,
  });
  dibujarFormulario();
}

async function guardarProducto(e) {
  e.preventDefault();
  const f = adm.form;
  if (!f) return;
  if (adm.subiendoFoto) return toast("Espera a que termine de subir la foto…");
  const btn = $("#formProd [type=submit]");

  const nombre = String(f.nombre || "").trim();
  if (!nombre) return toast("Escribe el nombre del producto base");
  if (!CATEGORIAS[f.tipo]) return toast("Elige la categoría del producto");

  let precioBase = leerPrecio(f.precio);
  const costo = String(f.costo ?? "").trim() === "" ? 0 : leerPrecio(f.costo);
  if (costo === null) return toast("Revisa el costo (ejemplo: 5,00)");
  const textoMayor = String(f.precio_mayor ?? "").trim();
  const precioMayor = textoMayor === "" ? null : leerPrecio(textoMayor);
  if (textoMayor !== "" && precioMayor === null) return toast("Revisa el precio al por mayor (ejemplo: 9,00)");
  const codigo = String(f.codigo ?? "").trim().slice(0, 40) || null;

  // Normalizar variantes con precio individual y disponibilidad
  const variantesPreparadas = [];
  for (let idx = 0; idx < (f.variantes || []).length; idx++) {
    const v = f.variantes[idx];
    const nomVar = String(v.nombre || "").trim() || ((f.variantes.length === 1) ? "Única" : "");
    if (!nomVar) continue;
    const textoPr = String(v.precio ?? "").trim();
    const prVar = textoPr === "" ? precioBase : leerPrecio(textoPr);
    if (prVar === null) {
      return toast(`Revisa el precio en USD de la variante "${nomVar}" (ejemplo: 0,07)`);
    }
    const disp = v.disponible !== false;
    const stRaw = parseInt(v.stock, 10);
    const stockFinal = !disp ? 0 : (Number.isFinite(stRaw) && stRaw > 0 ? stRaw : 1);
    variantesPreparadas.push({
      nombre: nomVar.slice(0, 80),
      precio: prVar,
      disponible: disp,
      stock: stockFinal,
      codigo: v.codigo ? String(v.codigo).trim().slice(0, 40) : undefined,
      orden: variantesPreparadas.length + 1,
    });
  }

  if (!variantesPreparadas.length) {
    if (precioBase === null) return toast("Revisa el precio en dólares (ejemplo: 12,50)");
    variantesPreparadas.push({
      nombre: "Única",
      precio: precioBase,
      disponible: true,
      stock: 1,
      orden: 1,
    });
  }

  // Si el precio base quedó vacío, usa el precio de la primera variante disponible (o la primera variante)
  const primeraDisp = variantesPreparadas.find(v => v.disponible) || variantesPreparadas[0];
  if (precioBase === null) {
    precioBase = primeraDisp && Number.isFinite(primeraDisp.precio) ? primeraDisp.precio : null;
  }
  if (precioBase === null) return toast("Revisa el precio en dólares (ejemplo: 0,07)");

  // Rellenar cualquier variante que aún no tuviera precio con precioBase
  variantesPreparadas.forEach(v => {
    if (!Number.isFinite(v.precio)) v.precio = precioBase;
  });

  const documentos = f.documentos
    .map(d => ({ nombre: String(d.nombre || "").trim(), url: String(d.url || "").trim() }))
    .filter(d => d.nombre || d.url)
    .map(d => ({ nombre: d.nombre || "Descargar", url: d.url }));
  if (documentos.some(d => !/^https:\/\//i.test(d.url))) {
    return toast("Los documentos necesitan un enlace que empiece con https://");
  }

  const fila = {
    nombre: nombre.slice(0, 120),
    tipo: f.tipo,
    descripcion: String(f.descripcion || "").trim().slice(0, 1000),
    codigo,
    precio: precioBase,
    precio_mayor: precioMayor,
    costo,
    destacado: !!f.destacado,
    activo: !!f.activo,
    fotos: f.fotos,
    caracteristicas: f.caracteristicas
      .map(c => ({ campo: String(c.campo || "").trim(), valor: String(c.valor || "").trim() }))
      .filter(c => c.campo),
    accesorios: f.accesorios,
    usos: f.usos,
    documentos,
    variantes: variantesPreparadas,
    actualizado_en: new Date().toISOString(),
  };

  btn.disabled = true;
  const consulta = f.id
    ? sb.from("productos").update(fila).eq("id", f.id)
    : sb.from("productos").insert(fila);
  const { error } = await consulta;

  if (error) {
    toast(error.code === "23505" ? "Ya existe otro producto con ese código." : "No se pudo guardar: " + error.message);
    btn.disabled = false;
    return;
  }
  adm.form = null;
  cerrarModal();
  toast("Producto y variantes guardados ✔");
  await cargar();
}

async function alternarPublicado(id) {
  const p = adm.productos.find(x => x.id === id);
  if (!p) return;
  const { error } = await sb.from("productos")
    .update({ activo: !p.activo, actualizado_en: new Date().toISOString() })
    .eq("id", id);
  if (error) return toast("No se pudo cambiar: " + error.message);
  toast(p.activo ? "Producto oculto del catálogo" : "Producto publicado ✔");
  await cargar();
}

async function borrarProducto(id) {
  const p = adm.productos.find(x => x.id === id);
  if (!p || !confirm(`¿Eliminar “${p.nombre}”? No se puede deshacer.`)) return;
  const { error } = await sb.from("productos").delete().eq("id", id);
  if (error) return toast("No se pudo eliminar: " + error.message);
  toast("Producto eliminado");
  await cargar();
}

/* ---------- Duplicar producto ---------- */
// La copia queda oculta y sin existencias: se revisa, se le ponen existencias y se publica cuando se quiera
async function duplicarProducto(id) {
  const p = adm.productos.find(x => x.id === id);
  if (!p) return;
  const copia = {
    nombre: `${p.nombre} (copia)`.slice(0, 120),
    tipo: p.tipo,
    descripcion: p.descripcion || "",
    codigo: null,
    precio: p.precio,
    precio_mayor: p.precio_mayor ?? null,
    costo: p.costo,
    destacado: false,
    activo: false,
    fotos: [...(p.fotos || [])],
    caracteristicas: (p.caracteristicas || []).map(c => ({ campo: c.campo, valor: c.valor })),
    accesorios: [...(p.accesorios || [])],
    usos: [...(p.usos || [])],
    documentos: (p.documentos || []).map(d => ({ nombre: d.nombre, url: d.url })),
    variantes: (p.variantes || []).map((v, idx) => ({
      nombre: v.nombre,
      precio: v.precio ?? p.precio,
      disponible: true,
      stock: Number(v.stock) || 1,
      orden: idx + 1,
    })),
    actualizado_en: new Date().toISOString(),
  };
  const { error } = await sb.from("productos").insert(copia);
  if (error) return toast("No se pudo duplicar: " + error.message);
  toast("Copia creada (oculta). Edítala y publícala cuando quieras ✔");
  await cargar();
}

/* ---------- Unificador inteligente de Productos Base + Variantes ---------- */
function detectarGruposVariantes() {
  const mapa = new Map();
  // Agrupa productos activos (o con foto) que comparten el mismo nombre base y categoría y tienen medida/talla en su nombre
  for (const p of adm.productos) {
    if (!p.activo) continue;
    const { base, variante } = typeof extraerBaseYVariante === "function"
      ? extraerBaseYVariante(p.nombre)
      : { base: p.nombre, variante: "" };
    if (!variante) continue;
    const clave = `${p.tipo}::${normaTexto(base)}`;
    if (!mapa.has(clave)) {
      mapa.set(clave, { clave, base, tipo: p.tipo, items: [] });
    }
    mapa.get(clave).items.push({ p, etiqueta: variante });
  }
  const grupos = [];
  for (const g of mapa.values()) {
    if (g.items.length < 2) continue;
    const ordenados = [...g.items].sort((a, b) => compararVariantes(a.etiqueta, b.etiqueta));
    const principal = ordenados.find(x => fotoDe(x.p))?.p || ordenados[0].p;
    const variantes = ordenados.map((x, idx) => {
      const disp = stockDe(x.p) > 0;
      return {
        nombre: x.etiqueta,
        precio: Number(x.p.precio) || 0,
        disponible: disp,
        stock: Math.max(disp ? 1 : 0, stockDe(x.p)),
        codigo: x.p.codigo || "",
        orden: idx + 1,
      };
    });
    grupos.push({
      ...g,
      principal,
      ordenados,
      variantes,
    });
  }
  return grupos.sort((a, b) => a.base.localeCompare(b.base, "es"));
}

function abrirUnificadorVariantes() {
  const grupos = detectarGruposVariantes();
  $("#modal .sheet").innerHTML = `
  <div class="stack">
    <div class="sheet-head">
      <h2>⚡ Agrupar en Producto Base + Variantes</h2>
      <button type="button" class="x" data-cerrar aria-label="Cerrar">✕</button>
    </div>
    <p class="hint">Detectamos productos publicados por separado con distintas medidas o tallas (ej. Argolla Niquelada 1,5 cm, 2,0 cm, 2,5 cm…). Al unificarlos, el producto base conservará una sola foto principal y todas sus medidas ordenadas de menor a mayor con su precio individual, ocultando las tarjetas repetidas <b>sin borrar ningún registro de la base de datos</b>.</p>
    ${grupos.length ? `
      <div class="kpis">
        ${kpi("Productos base detectados", grupos.length)}
        ${kpi("Variantes totales a agrupar", grupos.reduce((a, g) => a + g.variantes.length, 0))}
      </div>
      <div class="unificar-lista">
        ${grupos.map(g => `
          <div class="card unificar-item">
            <div class="unificar-item-head">
              <div>
                <span class="tipo">${esc(CATEGORIAS[g.tipo] || g.tipo)}</span>
                <h4>${esc(g.base)}</h4>
              </div>
              <span class="pill ok">${g.variantes.length} medidas</span>
            </div>
            <div class="adm-vars-pills">
              ${g.variantes.map(v => `<span class="adm-var-chip ${v.disponible ? "ok" : "off"}">${esc(v.nombre)} · <b>${usd(v.precio)}</b></span>`).join("")}
            </div>
          </div>`).join("")}
      </div>
      <div class="acciones-sheet">
        <button type="button" class="btn ghost" data-cerrar>Cancelar</button>
        <button type="button" class="btn" data-action="confirmar-unificar">✔ Unificar ${grupos.length} productos base ahora</button>
      </div>
    ` : `
      <div class="card">
        <p class="muted">¡Todo está limpio! No se encontraron tarjetas repetidas con distintas medidas pendientes por agrupar. Puedes agregar o editar variantes desde el botón <b>Editar</b> de cualquier producto.</p>
      </div>
      <div class="acciones-sheet">
        <button type="button" class="btn ghost" data-cerrar>Cerrar</button>
      </div>
    `}
  </div>`;
  abrirModal();
}

async function confirmarUnificacionVariantes(btn) {
  const grupos = detectarGruposVariantes();
  if (!grupos.length) return cerrarModal();
  if (btn) btn.disabled = true;
  try {
    const ahora = new Date().toISOString();
    for (const g of grupos) {
      const primeraDisp = g.variantes.find(v => v.disponible) || g.variantes[0];
      const fotoPrincipal = fotoDe(g.principal);
      const { error: errBase } = await sb.from("productos").update({
        nombre: g.base,
        precio: primeraDisp ? primeraDisp.precio : g.principal.precio,
        fotos: fotoPrincipal ? [fotoPrincipal] : g.principal.fotos,
        variantes: g.variantes,
        activo: true,
        actualizado_en: ahora,
      }).eq("id", g.principal.id);
      if (errBase) throw errBase;

      const secundarios = g.ordenados.map(x => x.p.id).filter(id => id !== g.principal.id);
      if (secundarios.length) {
        const { error: errSec } = await sb.from("productos").update({
          activo: false,
          actualizado_en: ahora,
        }).in("id", secundarios);
        if (errSec) throw errSec;
      }
    }
    cerrarModal();
    toast(`${grupos.length} producto(s) base unificados con sus variantes ✔`);
    await cargar();
  } catch (err) {
    toast("No se pudo completar la unificación: " + (err.message || "error"));
    if (btn) btn.disabled = false;
  }
}

/* ---------- Exportar inventario a Excel ---------- */
// Usa "celda" y los formatos (FORMATO_USD, FORMATO_ENTERO) definidos en analitica.js
function exportarInventario() {
  if (typeof XLSX === "undefined") return toast("El generador de Excel no cargó. Revisa tu conexión.");
  if (!adm.productos.length) return toast("Aún no hay productos para exportar");

  const lista = [...adm.productos].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const PRIMERA = 5; // las cuatro primeras filas son título, fecha, espacio y encabezados
  const filas = [
    [celda("MERCERÍA ORIENTE · INVENTARIO")],
    [celda(`Generado: ${new Date().toLocaleString("es-VE")}`)],
    [],
    ["Producto", "Categoría", "Publicado", "Precio venta (USD)", "Costo (USD)", "Existencias", "Por variante", "Valor a costo (USD)", "Valor a precio (USD)"].map(t => celda(t)),
  ];

  lista.forEach((p, i) => {
    const fila = PRIMERA + i;
    const stock = stockDe(p);
    const precio = Number(p.precio) || 0;
    const costo = Number(p.costo) || 0;
    const porVariante = (Array.isArray(p.variantes) ? p.variantes : [])
      .map(v => `${v.nombre} (${usd(v.precio ?? precio)}): ${varianteDispAdm(v) ? (Number(v.stock) || 1) : "Agotado"}`).join(" · ");
    filas.push([
      celda(p.nombre),
      celda(CATEGORIAS[p.tipo] || ""),
      celda(p.activo ? "Sí" : "No (oculto)"),
      celda(precio, FORMATO_USD),
      celda(costo, FORMATO_USD),
      celda(stock, FORMATO_ENTERO),
      celda(porVariante),
      celda(costo * stock, FORMATO_USD, `E${fila}*F${fila}`),
      celda(precio * stock, FORMATO_USD, `D${fila}*F${fila}`),
    ]);
  });

  const ultima = PRIMERA + lista.length - 1;
  const totalStock = lista.reduce((a, p) => a + stockDe(p), 0);
  const totalCosto = lista.reduce((a, p) => a + (Number(p.costo) || 0) * stockDe(p), 0);
  const totalPrecio = lista.reduce((a, p) => a + (Number(p.precio) || 0) * stockDe(p), 0);
  filas.push([
    celda("TOTAL"), celda(""), celda(""), celda(""), celda(""),
    celda(totalStock, FORMATO_ENTERO, `SUM(F${PRIMERA}:F${ultima})`),
    celda(""),
    celda(totalCosto, FORMATO_USD, `SUM(H${PRIMERA}:H${ultima})`),
    celda(totalPrecio, FORMATO_USD, `SUM(I${PRIMERA}:I${ultima})`),
  ]);

  const libro = XLSX.utils.book_new();
  const hoja = XLSX.utils.aoa_to_sheet(filas);
  hoja["!cols"] = [{ wch: 40 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 42 }, { wch: 20 }, { wch: 20 }];
  hoja["!autofilter"] = { ref: `A4:I${ultima}` };
  XLSX.utils.book_append_sheet(libro, hoja, "Inventario");
  XLSX.writeFile(libro, `Inventario_${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast("Inventario exportado ✔");
}

/* ---------- Plantillas por tipo ---------- */
function dibujarPlantillas() {
  const t = plantillaDe(adm.plantilla);
  $("#modal .sheet").innerHTML = `
  <form id="formPlantillas" class="stack">
    <div class="sheet-head">
      <h2>Plantillas por tipo</h2>
      <button type="button" class="x" data-cerrar aria-label="Cerrar">✕</button>
    </div>
    <p class="hint">Al crear un producto de este tipo se cargan estos campos, accesorios y usos. Cada producto puede cambiarlos.</p>
    <label>Tipo
      <select id="plTipo">
        ${Object.entries(CATEGORIAS).map(([k, l]) => `<option value="${k}" ${k === adm.plantilla ? "selected" : ""}>${esc(l)}</option>`).join("")}
      </select>
    </label>
    <label>Campos de características (uno por línea)
      <textarea name="campos" rows="6">${esc(t.campos.join("\n"))}</textarea>
    </label>
    <label>Accesorios sugeridos (uno por línea)
      <textarea name="accesorios" rows="5">${esc(t.accesorios.join("\n"))}</textarea>
    </label>
    <label>Usos sugeridos (uno por línea)
      <textarea name="usos" rows="4">${esc(t.usos.join("\n"))}</textarea>
    </label>
    <div class="acciones-sheet">
      <button type="button" class="btn ghost" data-cerrar>Cancelar</button>
      <button class="btn" type="submit">Guardar plantilla</button>
    </div>
  </form>`;
}

async function guardarPlantilla(e) {
  e.preventDefault();
  const f = e.target;
  const fila = {
    codigo: adm.plantilla,
    campos: lineasDe(f.elements.campos.value),
    accesorios: lineasDe(f.elements.accesorios.value),
    usos: lineasDe(f.elements.usos.value),
  };
  const { error } = await sb.from("tipos").upsert(fila, { onConflict: "codigo" });
  if (error) return toast("No se pudo guardar la plantilla: " + error.message);
  cerrarModal();
  toast("Plantilla guardada ✔");
  await cargar();
}

/* ---------- Notas ---------- */
async function agregarNota(e) {
  e.preventDefault();
  const input = e.target.elements.texto;
  const texto = input.value.trim();
  if (!texto) return;
  const { error } = await sb.from("notas").insert({ texto });
  if (error) return toast("No se pudo guardar la nota");
  input.value = "";
  await cargar();
}

async function alternarNota(id) {
  const n = adm.notas.find(x => x.id === id);
  if (!n) return;
  const { error } = await sb.from("notas").update({ hecha: !n.hecha }).eq("id", id);
  if (error) return toast("No se pudo actualizar la nota");
  await cargar();
}

async function borrarNota(id) {
  const { error } = await sb.from("notas").delete().eq("id", id);
  if (error) return toast("No se pudo eliminar la nota");
  await cargar();
}

/* ---------- Acciones (botones) ---------- */
async function accion(nombre, el) {
  const id = el.dataset.id;
  const i = Number(el.dataset.i);
  const f = adm.form;

  switch (nombre) {
    case "salir": return salir();
    case "nuevo": return abrirFormulario(null);
    case "editar": return abrirFormulario(adm.productos.find(p => p.id === id));
    case "activo": return alternarPublicado(id);
    case "borrar": return borrarProducto(id);
    case "duplicar": return duplicarProducto(id);
    case "categorias": return abrirCategorias();
    case "exportar": return exportarInventario();
    case "unificar-variantes": return abrirUnificadorVariantes();
    case "confirmar-unificar": return confirmarUnificacionVariantes(el);
    case "plantillas":
      adm.plantilla = Object.keys(CATEGORIAS)[0] || "maquina";
      dibujarPlantillas();
      return abrirModal();
    case "nota-toggle": return alternarNota(id);
    case "nota-borrar": return borrarNota(id);
  }

  if (!f) return;
  switch (nombre) {
    case "agregar-car": f.caracteristicas.push({ campo: "", valor: "" }); return dibujarFormulario();
    case "quitar-car": f.caracteristicas.splice(i, 1); return dibujarFormulario();
    case "agregar-var":
      f.variantes.push({
        nombre: "",
        precio: f.precio ?? "",
        disponible: true,
        stock: 1,
      });
      return dibujarFormulario();
    case "quitar-var":
      f.variantes.splice(i, 1);
      if (!f.variantes.length) f.variantes = variantesPorDefecto(f.precio);
      return dibujarFormulario();
    case "subir-var":
      if (i > 0) {
        [f.variantes[i - 1], f.variantes[i]] = [f.variantes[i], f.variantes[i - 1]];
        dibujarFormulario();
      }
      return;
    case "bajar-var":
      if (i >= 0 && i < f.variantes.length - 1) {
        [f.variantes[i + 1], f.variantes[i]] = [f.variantes[i], f.variantes[i + 1]];
        dibujarFormulario();
      }
      return;
    case "ordenar-var":
      f.variantes = ordenarVariantesLista(f.variantes);
      toast("Variantes ordenadas de menor a mayor ✔");
      return dibujarFormulario();
    case "lote-var": {
      const inp = $("#varLoteInput");
      const raw = inp ? String(inp.value || "").trim() : "";
      if (!raw) return toast("Escribe las medidas o colores separados por coma");
      const etiquetas = raw.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
      if (!etiquetas.length) return;
      // Si la única fila actual es "Única" o está vacía, la reemplazamos
      if (f.variantes.length === 1 && (!f.variantes[0].nombre || normaTexto(f.variantes[0].nombre) === "unica")) {
        f.variantes = [];
      }
      const existentes = new Set(f.variantes.map(v => normaTexto(v.nombre)));
      etiquetas.forEach(et => {
        if (!existentes.has(normaTexto(et))) {
          existentes.add(normaTexto(et));
          f.variantes.push({
            nombre: et,
            precio: f.precio ?? "",
            disponible: true,
            stock: 1,
          });
        }
      });
      f.variantes = ordenarVariantesLista(f.variantes);
      toast(`${etiquetas.length} opción(es) agregadas y ordenadas ✔`);
      return dibujarFormulario();
    }
    case "agregar-doc": f.documentos.push({ nombre: "", url: "" }); return dibujarFormulario();
    case "quitar-doc": f.documentos.splice(i, 1); return dibujarFormulario();
    case "quitar-foto": f.fotos.splice(i, 1); return dibujarFormulario();
    case "foto-principal": {
      const [u] = f.fotos.splice(i, 1);
      f.fotos.unshift(u);
      return dibujarFormulario();
    }
  }
}

/* ---------- Eventos ---------- */
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.closest("#loginLogoBtn")) return animarLogoLogin(true);
  if (t.closest("#btnVerPass")) return alternarVerPassword();
  const inicioIr = t.closest("[data-inicio-ir]");
  if (inicioIr && inicioIr.dataset.inicioIr === "nueva-cashea") {
    irA("cashea-merceria");
    if (typeof abrirFormCashea === "function") abrirFormCashea(null);
    return;
  }
  const kpiEstado = t.closest("[data-kpi-estado]");
  if (kpiEstado) {
    adm.estado = kpiEstado.dataset.kpiEstado;
    pintarCatalogo();
    return irA("catalogo");
  }
  const estadoBtn = t.closest("[data-estado-adm]");
  if (estadoBtn) {
    adm.estado = estadoBtn.dataset.estadoAdm;
    return pintarCatalogo();
  }
  const tab = t.closest("[data-tab]");
  if (tab) return irA(tab.dataset.tab);
  const chip = t.closest("[data-chip]");
  if (chip) {
    adm.chip = chip.dataset.chip;
    return pintarCatalogo();
  }
  const btn = t.closest("[data-action]");
  if (btn) return accion(btn.dataset.action, btn);
});

// Escribir en el formulario: se guarda en memoria, sin volver a dibujar (no pierde el foco)
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "loginPassword") return actualizarAnimacionPassword();
  if (t.id === "buscarAdm") {
    adm.q = t.value;
    return pintarCatalogo();
  }
  const f = adm.form;
  if (!f || !t.closest("#formProd")) return;

  if (t.dataset.arr) {
    const idx = Number(t.dataset.i);
    const lista = { car: f.caracteristicas, doc: f.documentos, var: f.variantes }[t.dataset.arr];
    const fila = lista && lista[idx];
    if (!fila) return;
    if (t.dataset.arr === "var" && t.dataset.k === "disponible") return;
    fila[t.dataset.k] = t.value;
    if (t.dataset.arr === "var" && t.dataset.k === "stock") {
      const st = parseInt(t.value, 10) || 0;
      fila.disponible = st > 0;
      const rowEl = t.closest("[data-var-row]");
      if (rowEl) {
        rowEl.classList.toggle("var-agotada", !fila.disponible);
        const chk = rowEl.querySelector('input[data-k="disponible"]');
        const sw = rowEl.querySelector(".ios-switch");
        const txt = rowEl.querySelector(`[data-var-disp-txt="${idx}"]`);
        if (chk) chk.checked = fila.disponible;
        if (sw) {
          sw.classList.toggle("on", fila.disponible);
          sw.classList.toggle("ok", fila.disponible);
        }
        if (txt) {
          txt.textContent = fila.disponible ? "Disponible" : "Agotado";
          txt.className = `ios-toggle-txt ${fila.disponible ? "ok" : "agotado"}`;
        }
      }
    }
    return;
  }

  const b = t.dataset.b;
  if (b === "accesorios" || b === "usos") f[b] = lineasDe(t.value);
  else if (b && b !== "tipo" && b !== "destacado" && b !== "activo") f[b] = t.value;
});

document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "fotoPrincipalIn") {
    const archivos = [...(t.files || [])];
    t.value = "";
    return subirFotos(archivos, true);
  }
  if (t.id === "fotosIn") {
    const archivos = [...(t.files || [])];
    t.value = "";
    return subirFotos(archivos, false);
  }
  if (t.dataset && t.dataset.fotoRapida) {
    const id = t.dataset.fotoRapida;
    const archivos = [...(t.files || [])];
    t.value = "";
    return subirFotoRapida(id, archivos);
  }
  if (t.id === "selCuenta") {
    animarLogoLogin(false);
    return actualizarRol();
  }
  if (t.id === "plTipo") {
    adm.plantilla = t.value;
    return dibujarPlantillas();
  }
  const f = adm.form;
  if (!f || !t.closest("#formProd")) return;

  if (t.dataset.arr === "var" && t.dataset.k === "disponible") {
    const idx = Number(t.dataset.i);
    const fila = f.variantes && f.variantes[idx];
    if (!fila) return;
    fila.disponible = !!t.checked;
    if (fila.disponible && (parseInt(fila.stock, 10) || 0) <= 0) {
      fila.stock = 1;
    } else if (!fila.disponible) {
      fila.stock = 0;
    }
    const rowEl = t.closest("[data-var-row]");
    if (rowEl) {
      rowEl.classList.toggle("var-agotada", !fila.disponible);
      const stockIn = rowEl.querySelector('input[data-k="stock"]');
      const sw = rowEl.querySelector(".ios-switch");
      const txt = rowEl.querySelector(`[data-var-disp-txt="${idx}"]`);
      if (stockIn) stockIn.value = fila.stock;
      if (sw) {
        sw.classList.toggle("on", fila.disponible);
        sw.classList.toggle("ok", fila.disponible);
      }
      if (txt) {
        txt.textContent = fila.disponible ? "Disponible" : "Agotado";
        txt.className = `ios-toggle-txt ${fila.disponible ? "ok" : "agotado"}`;
      }
    }
    return;
  }

  if (!t.dataset.b) return;
  if (t.dataset.b === "tipo") return cambiarTipo(t.value);
  if (t.type === "checkbox") {
    f[t.dataset.b] = t.checked;
    const lbl = t.closest(".ios-tog");
    const sw = lbl && lbl.querySelector(".ios-switch");
    if (sw) {
      sw.classList.toggle("on", t.checked);
      if (t.dataset.b === "activo") sw.classList.toggle("ok", t.checked);
    }
  }
});

document.addEventListener("submit", (e) => {
  e.preventDefault();
  const id = e.target.id;
  if (id === "loginForm") return iniciarSesion(e);
  if (id === "formProd") return guardarProducto(e);
  if (id === "formPlantillas") return guardarPlantilla(e);
  if (id === "formNota") return agregarNota(e);
  if (id === "formCashea") return guardarCashea(e);
  if (id === "formComprobar") return guardarComprobarCashea(e);
});

/* ---------- Arranque ---------- */
async function iniciar() {
  if (!CONFIGURADO) {
    toast("Falta configurar Supabase en config.js");
    return;
  }
  sb.auth.onAuthStateChange((evento, session) => {
    if (evento === "SIGNED_OUT" && adm.usuaria) {
      adm.usuaria = null;
      adm.form = null;
      cerrarModal();
      mostrarLogin();
    } else if (evento === "TOKEN_REFRESHED" && session && session.user) {
      const email = String(session.user.email || "").toLowerCase().trim();
      if (CUENTAS[email]) adm.usuaria = CUENTAS[email];
    }
  });
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible" && adm.usuaria) {
      const sesion = await asegurarSesion();
      if (sesion && adm.tab.startsWith("cashea") && typeof refrescarCashea === "function") {
        refrescarCashea();
      }
    }
  });
  try {
    const { data } = await sb.auth.getSession();
    const email = data && data.session && data.session.user
      ? String(data.session.user.email || "").toLowerCase().trim()
      : "";
    if (email && CUENTAS[email]) {
      adm.usuaria = CUENTAS[email];
      await entrarPanel();
      return;
    }
  } catch { /* si falla, muestra el login */ }
  mostrarLogin();
}

iniciar();
