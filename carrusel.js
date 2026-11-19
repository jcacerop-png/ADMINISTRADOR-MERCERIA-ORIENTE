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
    <article class="car-item ${f.activo ? "" : "off"}" data-id="${esc(f.id)}" draggable="true" title="Arrastra para cambiar el orden">
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
    const valida = typeof esArchivoImagen === "function" ? esArchivoImagen(file) : (file.type || "").startsWith("image/");
    if (!valida) { toast("Solo se pueden subir imágenes"); continue; }
    if (file.size > 20 * 1024 * 1024) { toast("Esa foto pesa más de 20 MB"); continue; }
    try {
      toast("Subiendo foto…");
      const blob = await comprimir(file, 1920);
      const uid = typeof uuidSeguro === "function" ? uuidSeguro() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const ruta = `carrusel/${uid}.jpg`;
      const { error: errSubida } = await sb.storage.from("catalogo").upload(ruta, blob, {
        contentType: blob.type || "image/jpeg",
        cacheControl: "31536000",
        upsert: true,
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

// Guarda el orden nuevo: cada foto recibe su número de lugar (1, 2, 3…), así no quedan empates
async function reordenarCarrusel(ids) {
  const nueva = ids.map(id => car.lista.find(f => f.id === id)).filter(Boolean);
  if (nueva.length !== car.lista.length) return refrescarCarrusel();
  const resultados = await Promise.all(
    nueva.map((f, k) => sb.from("carrusel").update({ orden: k + 1 }).eq("id", f.id))
  );
  if (resultados.some(r => r.error)) return toast("No se pudo cambiar el orden");
  await refrescarCarrusel();
}

// Flechas ▲ ▼ (para el celular)
async function moverFoto(id, d) {
  const i = car.lista.findIndex(f => f.id === id);
  const j = i + d;
  if (i < 0 || j < 0 || j >= car.lista.length) return;
  const ids = car.lista.map(f => f.id);
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return reordenarCarrusel(ids);
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

/* ---------- Imagen Hero Full-Bleed del pie de página (configuracion_catalogo) ---------- */
const heroPie = { url: "", actualizadoEn: "", actualizadoPor: "", subiendo: false };

async function refrescarHeroPie() {
  if (!sb) return;
  const estado = $("#heroPieEstado");
  try {
    const { data, error } = await sb
      .from("configuracion_catalogo")
      .select("*")
      .eq("clave", "hero_pie_url")
      .maybeSingle();
    if (error) throw error;
    heroPie.url = (data && data.valor) ? String(data.valor) : "";
    heroPie.actualizadoEn = (data && data.actualizado_en) ? data.actualizado_en : "";
    heroPie.actualizadoPor = (data && data.actualizado_por) ? data.actualizado_por : "";
    pintarHeroPie();
  } catch (err) {
    heroPie.url = "";
    pintarHeroPie(err.message || "Corre supabase-v17-correcciones.sql en Supabase para activar esta sección.");
  }
}

function pintarHeroPie(avisoError = "") {
  const vista = $("#heroPieVista");
  const estado = $("#heroPieEstado");
  const btnQuitar = $("#btnHeroPieQuitar");
  const lblSubir = $("#lblHeroPieSubir");
  if (!vista || !estado) return;

  if (btnQuitar) btnQuitar.hidden = !heroPie.url;
  if (lblSubir) lblSubir.textContent = heroPie.url ? "↻ Reemplazar imagen Hero" : "+ Subir imagen Hero";

  if (avisoError) {
    estado.textContent = "Aviso: " + avisoError;
  } else if (heroPie.url) {
    const infoFecha = heroPie.actualizadoEn ? ` · actualizada ${fechaHora(heroPie.actualizadoEn)}` : "";
    const infoPor = heroPie.actualizadoPor ? ` por ${heroPie.actualizadoPor}` : "";
    estado.textContent = `Imagen activa en el pie del catálogo público${infoPor}${infoFecha}.`;
  } else {
    estado.textContent = "Aún no hay imagen personalizada. El catálogo público muestra actualmente su diseño oscuro elegante de respaldo.";
  }

  vista.innerHTML = heroPie.url
    ? `<div class="hero-pie-demo" style="background-image:url('${esc(heroPie.url)}')">
        <div class="hero-pie-demo-velo"></div>
        <div class="hero-pie-demo-contenido">
          <span class="eyebrow">Vista previa · Hero Full-Bleed</span>
          <h4>Mercería Oriente</h4>
          <p class="small">Todo para coser, bordar y crear · Atención personalizada por WhatsApp</p>
        </div>
      </div>`
    : `<div class="hero-pie-demo sin-imagen">
        <div class="hero-pie-demo-velo"></div>
        <div class="hero-pie-demo-contenido">
          <span class="eyebrow">Vista previa · Respaldo elegante</span>
          <h4>Mercería Oriente</h4>
          <p class="small">Sube una foto horizontal (recomendado 1920×800 px) para personalizar el pie del catálogo.</p>
        </div>
      </div>`;
}

async function subirHeroPie(file) {
  if (!file || heroPie.subiendo) return;
  const valida = typeof esArchivoImagen === "function" ? esArchivoImagen(file) : (file.type || "").startsWith("image/");
  if (!valida) return toast("El archivo elegido no es una imagen válida.");
  if (file.size > 20 * 1024 * 1024) return toast("Esa imagen pesa más de 20 MB.");
  if (typeof asegurarSesion === "function") {
    const sesion = await asegurarSesion();
    if (!sesion) return;
  }

  heroPie.subiendo = true;
  const estado = $("#heroPieEstado");
  if (estado) estado.textContent = "Optimizando y subiendo imagen Hero…";
  try {
    const blob = await comprimir(file, 1920);
    const uid = typeof uuidSeguro === "function" ? uuidSeguro() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const ruta = `hero-pie/${uid}.jpg`;
    let urlPublica = "";

    const { error: errBucket } = await sb.storage.from("personalizacion").upload(ruta, blob, {
      contentType: blob.type || "image/jpeg",
      cacheControl: "31536000",
      upsert: false,
    });
    if (errBucket) {
      // Respaldo en bucket público 'catalogo' si 'personalizacion' aún no fue creado
      const rutaResp = `personalizacion/${uid}.jpg`;
      const { error: errCat } = await sb.storage.from("catalogo").upload(rutaResp, blob, {
        contentType: blob.type || "image/jpeg",
        cacheControl: "31536000",
        upsert: false,
      });
      if (errCat) throw errBucket;
      urlPublica = sb.storage.from("catalogo").getPublicUrl(rutaResp).data.publicUrl;
    } else {
      urlPublica = sb.storage.from("personalizacion").getPublicUrl(ruta).data.publicUrl;
    }

    const anterior = heroPie.url;
    const { error: errBD } = await sb
      .from("configuracion_catalogo")
      .upsert({ clave: "hero_pie_url", valor: urlPublica }, { onConflict: "clave" });
    if (errBD) throw errBD;

    if (anterior) borrarArchivoHeroAnterior(anterior).catch(() => {});
    toast("Imagen Hero del pie de página actualizada ✔");
    await refrescarHeroPie();
  } catch (err) {
    if (typeof esErrorDeSesion === "function" && esErrorDeSesion(err)) {
      if (typeof salir === "function") await salir("Tu sesión expiró. Vuelve a iniciar sesión.");
      return;
    }
    toast("No se pudo guardar la imagen Hero: " + (err.message || "error"));
    await refrescarHeroPie();
  } finally {
    heroPie.subiendo = false;
  }
}

async function borrarArchivoHeroAnterior(url) {
  if (!url) return;
  if (url.includes("/personalizacion/")) {
    const ruta = url.split("/personalizacion/")[1] || "";
    if (ruta) await sb.storage.from("personalizacion").remove([decodeURIComponent(ruta)]);
  } else if (url.includes("/catalogo/")) {
    const ruta = url.split("/catalogo/")[1] || "";
    if (ruta) await sb.storage.from("catalogo").remove([decodeURIComponent(ruta)]);
  }
}

async function quitarHeroPie() {
  if (!heroPie.url) return;
  if (!confirm("¿Quitar la imagen personalizada del pie de página? El catálogo mostrará el fondo oscuro elegante por defecto.")) return;
  if (typeof asegurarSesion === "function") {
    const sesion = await asegurarSesion();
    if (!sesion) return;
  }
  try {
    const anterior = heroPie.url;
    const { error } = await sb
      .from("configuracion_catalogo")
      .upsert({ clave: "hero_pie_url", valor: null }, { onConflict: "clave" });
    if (error) throw error;
    await borrarArchivoHeroAnterior(anterior).catch(() => {});
    toast("Imagen del pie de página quitada.");
    await refrescarHeroPie();
  } catch (err) {
    toast("No se pudo quitar la imagen: " + (err.message || "error"));
  }
}

/* ---------- Eventos ---------- */
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.closest("#btnHeroPieQuitar")) return quitarHeroPie();
  let n;
  if ((n = t.closest("[data-cmover]"))) return moverFoto(n.dataset.cmover, Number(n.dataset.d));
  if ((n = t.closest("[data-cactivo]"))) return alternarFoto(n.dataset.cactivo);
  if ((n = t.closest("[data-cborrar]"))) return quitarFoto(n.dataset.cborrar);
});

document.addEventListener("change", (e) => {
  if (e.target.id === "heroPieIn") {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (file) subirHeroPie(file);
    return;
  }
  if (e.target.id !== "carIn") return;
  const files = [...(e.target.files || [])];
  e.target.value = "";
  if (files.length) subirFotosCarrusel(files);
});

// Arrastrar una foto a otro lugar (en la computadora)
habilitarArrastre($("#carGrid"), { item: ".car-item", alSoltar: reordenarCarrusel });
