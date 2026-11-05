// Chequeo de conectividad a internet real (no solo al SDK local, que corre
// en 127.0.0.1 y responde igual con o sin internet). Se usa antes de ofrecer
// el login con Google — sin esto, sin internet el botón de Google se queda
// esperando hasta 3 minutos (ver main/auth/google-login-window.js) antes de
// avisar que falló, en vez de mostrar directo el login manual por código.
//
// "generate_204" son endpoints livianos de Google (devuelven 204 sin body,
// pensados justamente para chequeos de conectividad tipo captive-portal) —
// se prueban dos hosts distintos de Google por si uno está bloqueado/caído.
const CHECK_URLS = [
  "https://accounts.google.com/generate_204",
  "https://www.gstatic.com/generate_204",
];

const TIMEOUT_MS = 4000;

async function _reachable(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal, cache: "no-store" });
    return res.status >= 200 && res.status < 400;
  } catch (_err) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function checkInternet() {
  for (const url of CHECK_URLS) {
    if (await _reachable(url)) return true;
  }
  return false;
}

module.exports = { checkInternet };
