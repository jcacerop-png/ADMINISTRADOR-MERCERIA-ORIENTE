"use strict";
/* =========================================================
   Utilidades compartidas por el catálogo y el panel.
   Requiere config.js (cargado antes).
   ========================================================= */

const CONFIGURADO = !CONFIG.SUPABASE_URL.includes("PEGA_AQUI");

// Sin persistSession: cada vez que se abre o recarga la página hay que volver a iniciar sesión
const sb = CONFIGURADO
  ? window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, detectSessionInUrl: false },
    })
  : null;

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const usd = n => "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Precios: el teclado numérico del iPhone solo tiene coma, así que se acepta coma o punto.
   leerPrecio devuelve un número con 2 decimales, o null si el texto no es un precio válido. */
const leerPrecio = v => {
  const s = String(v ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};
const escribirPrecio = v => (v === "" || v === null || v === undefined ? "" : String(v).replace(".", ","));

function toast(msg) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 3000);
}

function abrirModal() {
  $("#modal").hidden = false;
  document.body.classList.add("lock");
}

function cerrarModal() {
  $("#modal").hidden = true;
  $("#modal .sheet").innerHTML = "";
  document.body.classList.remove("lock");
}

/* ---------- Tema claro / oscuro (recordado en el navegador) ---------- */
function aplicarTema(tema) {
  document.documentElement.dataset.theme = tema;
  try { localStorage.setItem("mo_tema", tema); } catch { /* navegador sin almacenamiento */ }
  $$("[data-tema]").forEach(b => {
    b.textContent = tema === "oscuro" ? "☀ Tema claro" : "🌙 Tema oscuro";
  });
}

function alternarTema() {
  aplicarTema(document.documentElement.dataset.theme === "oscuro" ? "claro" : "oscuro");
}

/* ---------- Validar y reducir fotos antes de subirlas ---------- */
const EXTENSIONES_IMAGEN = /\.(png|jpe?g|jfif|webp|gif|bmp|avif|svg|heic|heif)$/i;

function esArchivoImagen(file) {
  if (!file) return false;
  const tipo = String(file.type || "").toLowerCase();
  const nombre = String(file.name || "");
  return tipo.startsWith("image/") || EXTENSIONES_IMAGEN.test(nombre);
}

function uuidSeguro() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function dibujarEnCanvas(fuente, w, h, max) {
  const s = Math.min(1, max / Math.max(w, h, 1));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("No se pudo iniciar el procesador de imagen");
  // Fondo blanco para que los PNG o WebP con transparencia no queden con fondo negro al pasar a JPEG
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(fuente, 0, 0, c.width, c.height);
  return new Promise((resolve, reject) => {
    c.toBlob(b => {
      c.width = 0;
      c.height = 0;
      if (b) resolve(b);
      else reject(new Error("No se pudo procesar la foto"));
    }, "image/jpeg", 0.86);
  });
}

async function comprimir(file, max = 1000) {
  if (!file) throw new Error("No se seleccionó ninguna imagen");
  // 1) Intento principal con Image + ObjectURL
  try {
    return await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        URL.revokeObjectURL(url);
        if (!w || !h) return reject(new Error("Dimensiones de imagen no válidas"));
        dibujarEnCanvas(img, w, h, max).then(resolve, reject);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("No se pudo decodificar la imagen"));
      };
      img.src = url;
    });
  } catch (err1) {
    // 2) Segundo intento con createImageBitmap (soporta más variantes en navegadores modernos)
    if (typeof createImageBitmap === "function") {
      try {
        const bmp = await createImageBitmap(file);
        const blob = await dibujarEnCanvas(bmp, bmp.width, bmp.height, max);
        if (typeof bmp.close === "function") bmp.close();
        return blob;
      } catch { /* continúa al respaldo */ }
    }
    // 3) Respaldo: si ya es un archivo de imagen válido, copia sus bytes en memoria para no fallar la subida
    if (esArchivoImagen(file) && file.size > 0 && file.size <= 25 * 1024 * 1024) {
      const buffer = await file.arrayBuffer();
      return new Blob([buffer], { type: file.type && file.type.startsWith("image/") ? file.type : "image/jpeg" });
    }
    throw new Error(err1 && err1.message ? err1.message : "Imagen no válida");
  }
}

/* ---------- Visor de foto grande: tocar la foto para acercarla ---------- */
function crearVisor() {
  const v = document.createElement("div");
  v.id = "visor";
  v.className = "visor";
  v.hidden = true;
  v.innerHTML = `
    <button class="visor-x" type="button" aria-label="Cerrar foto">✕</button>
    <div class="visor-marco"><img alt=""></div>
    <p class="visor-ayuda">Toca la foto para acercarla · Esc para cerrar</p>`;
  document.body.appendChild(v);
  v.addEventListener("click", e => {
    if (e.target.closest(".visor-x")) return cerrarZoom();
    if (e.target.tagName === "IMG") return v.classList.toggle("cerca");
    if (!v.classList.contains("cerca")) cerrarZoom();
  });
  return v;
}

function abrirZoom(src, texto = "") {
  const v = $("#visor") || crearVisor();
  const img = $("img", v);
  img.src = src;
  img.alt = texto;
  v.classList.remove("cerca");
  v.hidden = false;
  document.body.classList.add("lock");
}

function cerrarZoom() {
  const v = $("#visor");
  if (!v || v.hidden) return;
  v.hidden = true;
  v.classList.remove("cerca");
  $("img", v).removeAttribute("src");
  const modal = $("#modal");
  if (!modal || modal.hidden) document.body.classList.remove("lock");
}

/* ---------- Eventos comunes ---------- */
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-tema]")) return alternarTema();
  const zoom = e.target.closest("[data-zoom]");
  if (zoom) return abrirZoom(zoom.dataset.zoom, zoom.getAttribute("alt") || "");
  if (e.target.closest("[data-cerrar]") || e.target.id === "modal") return cerrarModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const v = $("#visor");
  if (v && !v.hidden) return cerrarZoom();
  if (!$("#modal").hidden) cerrarModal();
});

aplicarTema(localStorage.getItem("mo_tema") === "claro" ? "claro" : "oscuro");

/* =========================================================
   Categorías de productos. Se cargan desde la base de datos
   (tabla tipos): el panel las ve todas y el catálogo público
   solo las visibles. fijarCategorias() las deja en orden.
   ========================================================= */
let CATEGORIAS = {};

// Recibe filas { codigo, nombre, orden } y deja CATEGORIAS en ese mismo orden
function fijarCategorias(filas) {
  const ordenadas = [...(filas || [])].sort((a, b) =>
    (Number(a.orden) || 0) - (Number(b.orden) || 0)
    || String(a.nombre || a.codigo).localeCompare(String(b.nombre || b.codigo), "es"));
  CATEGORIAS = {};
  ordenadas.forEach(f => { CATEGORIAS[f.codigo] = f.nombre || f.codigo; });
}

// Texto sin tildes ni mayúsculas, para buscar y comparar
const normaTexto = s => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/* Reordenar con el mouse (arrastrar y soltar). En el celular se usan las flechas ▲ ▼.
   contenedor: elemento que tiene las filas · item: selector de cada fila (con data-id)
   agarre: selector de la parte que se arrastra (si no se indica, arrastra la fila completa)
   alSoltar(ids): recibe los ids en su nuevo orden, solo si el orden cambió */
function habilitarArrastre(contenedor, { item, agarre = null, alSoltar }) {
  let arrastrando = null;
  let ordenInicial = [];
  const ids = () => [...contenedor.querySelectorAll(item)].map(f => f.dataset.id);

  contenedor.addEventListener("dragstart", (e) => {
    const origen = agarre ? e.target.closest(agarre) : e.target;
    const fila = origen && origen.closest(item);
    if (!fila || !contenedor.contains(fila)) return e.preventDefault();
    arrastrando = fila;
    ordenInicial = ids();
    fila.classList.add("arrastrando");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", fila.dataset.id || "");
  });

  contenedor.addEventListener("dragover", (e) => {
    if (!arrastrando) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const destino = e.target.closest(item);
    if (!destino || destino === arrastrando || !contenedor.contains(destino)) return;
    const lista = destino.parentNode;
    if (lista !== arrastrando.parentNode) return; // solo se reordena dentro de su misma lista
    const r = destino.getBoundingClientRect();
    const despues = e.clientY > r.top + r.height / 2;
    lista.insertBefore(arrastrando, despues ? destino.nextSibling : destino);
  });

  contenedor.addEventListener("drop", (e) => {
    if (arrastrando) e.preventDefault();
  });

  contenedor.addEventListener("dragend", () => {
    if (!arrastrando) return;
    arrastrando.classList.remove("arrastrando");
    arrastrando = null;
    const nuevoOrden = ids();
    if (nuevoOrden.join("|") !== ordenInicial.join("|")) alSoltar(nuevoOrden);
  });
}
