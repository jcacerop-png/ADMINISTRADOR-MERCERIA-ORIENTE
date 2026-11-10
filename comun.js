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

/* ---------- Reducir fotos del celular antes de subirlas ---------- */
function comprimir(file, max = 1000) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => (b ? resolve(b) : reject(new Error("No se pudo procesar la foto"))), "image/jpeg", 0.86);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Imagen no válida"));
    };
    img.src = url;
  });
}

/* ---------- Eventos comunes ---------- */
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-tema]")) return alternarTema();
  if (e.target.closest("[data-cerrar]") || e.target.id === "modal") return cerrarModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#modal").hidden) cerrarModal();
});

aplicarTema(localStorage.getItem("mo_tema") === "claro" ? "claro" : "oscuro");
