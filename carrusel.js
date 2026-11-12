"use strict";
/* =========================================================
   Carrusel de fotos: es el fondo de la entrada y el banner
   del catálogo público. Máximo 10 fotos, en el orden que
   elijas. Cada cambio avisa al catálogo en vivo (trigger).
   Requiere config.js, comun.js y admin.js.
   ========================================================= */

const MAX_CARRUSEL = 10;
const car = { lista: [] };

async function refrescarCarrusel() {
  if (!sb) return;
  const { data, error } = await sb.from("carrusel").select("*").order("orden", { ascending: true });
  if (error) return toast("No se pudo cargar el carrusel: " + error.message);
  car.lista = data || [];
  pintarCarrusel();
}

function pintarCarrusel() {
  const visibles = car.lista.filter(f => f.activo).length;
  $("#carCuenta").textContent = `${car.lista.length} de ${MAX_CARRUSEL} fotos · ${visibles} visible(s)`;
  $("#carIn").disabled = car.lista.length >= MAX_CARRUSEL;

  $("#carGrid").innerHTML = car.lista.map((f, i) => `
    <article class="car-item ${f.activo ? "" : "off"}">
      <img src="${esc(f.url)}" alt="Foto ${i + 1}" data-zoom="${esc(f.url)}">
      <div class="car-acc">
        <span class="pill ${f.activo ? "ok" : "agotado"}">${f.activo ? "Visible" : "Oculta"}</span>
        <span class="muted small">Lugar ${i + 1}</span>
      </div>
      <div class="car-acc">
        <button type="button" class="btn sm ghost" data-cmover="${esc(f.id)}" data-d="-1" ${i === 0 ? "disabled" : ""} aria-label="Subir">▲</button>
        <button type="button" class="btn sm ghost" data-cmover="${esc(f.id)}" data-d="1" ${i === car.lista.length - 1 ? "disabled" : ""} aria-label="Bajar">▼</button>
        <button type="button" class="btn sm ghost" data-cactivo="${esc(f.id)}">${f.activo ? "Ocultar" : "Mostrar"}</button>
        <button type="button" class="btn sm peligro" data-cborrar="${esc(f.id)}">Quitar</button>
      </div>
    </article>`).join("")
    || `<p class="muted">Aún no hay fotos. Sube hasta ${MAX_CARRUSEL}: se verán de fondo en la entrada y en el banner del catálogo.</p>`;
}

async function subirFotosCarrusel(files) {
  const lista = [...files];
  const libres = MAX_CARRUSEL - car.lista.length;
  if (!lista.length) return;
  if (libres <= 0) return toast(`Ya hay ${MAX_CARRUSEL} fotos. Quita una para subir otra.`);

  let orden = car.lista.reduce((m, f) => Math.max(m, Number(f.orden) || 0), 0);
  let subidas = 0;
  for (const file of lista.slice(0, libres)) {
    if (!file.type.startsWith("image/")) { toast("Solo se pueden subir imágenes"); continue; }
    if (file.size > 20 * 1024 * 1024) { toast("Esa foto pesa más de 20 MB"); continue; }
    try {
      toast("Subiendo foto…");
      const blob = await comprimir(file, 1920);
      const ruta = `carrusel/${crypto.randomUUID()}.jpg`;
      const { error: errSubida } = await sb.storage.from("catalogo").upload(ruta, blob, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
      });
      if (errSubida) throw errSubida;
      const url = sb.storage.from("catalogo").getPublicUrl(ruta).data.publicUrl;
      orden += 1;
      const { error: errFila } = await sb.from("carrusel").insert({ url, orden, activo: true });
      if (errFila) throw errFila;
      subidas += 1;
    } catch (err) {
      toast("No se pudo subir la foto: " + (err.message || "error"));
    }
  }
  await refrescarCarrusel();
  if (subidas) toast(`${subidas} foto(s) agregadas ✔`);
}

async function moverFoto(id, d) {
  const i = car.lista.findIndex(f => f.id === id);
  const j = i + d;
  if (i < 0 || j < 0 || j >= car.lista.length) return;
  const nueva = [...car.lista];
  const [pieza] = nueva.splice(i, 1);
  nueva.splice(j, 0, pieza);
  // Renumera todo el carrusel según el nuevo orden (así no quedan empates)
  const resultados = await Promise.all(
    nueva.map((f, k) => sb.from("carrusel").update({ orden: k + 1 }).eq("id", f.id))
  );
  if (resultados.some(r => r.error)) return toast("No se pudo cambiar el orden");
  await refrescarCarrusel();
}

async function alternarFoto(id) {
  const f = car.lista.find(x => x.id === id);
  if (!f) return;
  const { error } = await sb.from("carrusel").update({ activo: !f.activo }).eq("id", id);
  if (error) return toast("No se pudo cambiar: " + error.message);
  toast(f.activo ? "Foto oculta en el catálogo" : "Foto visible en el catálogo ✔");
  await refrescarCarrusel();
}

async function quitarFoto(id) {
  const f = car.lista.find(x => x.id === id);
  if (!f || !confirm("¿Quitar esta foto del carrusel? No se puede deshacer.")) return;
  const { error } = await sb.from("carrusel").delete().eq("id", id);
  if (error) return toast("No se pudo quitar: " + error.message);
  // Borra también el archivo de la foto para no dejar basura en el almacenamiento
  const ruta = (f.url.split("/catalogo/")[1] || "");
  if (ruta) await sb.storage.from("catalogo").remove([decodeURIComponent(ruta)]);
  toast("Foto quitada");
  await refrescarCarrusel();
}

/* ---------- Eventos ---------- */
document.addEventListener("click", (e) => {
  const t = e.target;
  let n;
  if ((n = t.closest("[data-cmover]"))) return moverFoto(n.dataset.cmover, Number(n.dataset.d));
  if ((n = t.closest("[data-cactivo]"))) return alternarFoto(n.dataset.cactivo);
  if ((n = t.closest("[data-cborrar]"))) return quitarFoto(n.dataset.cborrar);
});

document.addEventListener("change", (e) => {
  if (e.target.id !== "carIn") return;
  const files = [...(e.target.files || [])];
  e.target.value = "";
  if (files.length) subirFotosCarrusel(files);
});
