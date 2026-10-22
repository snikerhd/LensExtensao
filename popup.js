/* ============================================================================
 * popup.js — v5.2.0
 * O popup continua a pedir o link da imagem (como sempre). Melhorias v5:
 *  [NOVO] Botão «Colar» lê a imagem diretamente da área de transferência.
 *  [FIX]  Links sem http(s):// são corrigidos automaticamente.
 *  [FIX]  storage gravado com `await` ANTES de abrir a aba — zero corridas.
 *  Enter no campo do link = Extrair (mantido).
 * ==========================================================================*/

const DEFAULT_QUERY =
  "Consegues meter nome - quantidade arma- municao acessorios- quantidade na imagem se aparecer acessorios mete so o numero petrocal se tiver numero em cima ignora e so 1";
const SITE_URL = "https://offsetrp-calculadora.vercel.app";

const $ = (id) => document.getElementById(id);
const status = $("status");
const urlInput = $("url");
const queryInput = $("query");

function showStatus(kind, html) {
  status.className = "status visible " + kind;
  status.innerHTML = html;
}

/* corrige links colados sem protocolo ("i.gyazo.com/….png" → "https://…") */
function normalizeUrl(raw) {
  let u = String(raw || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

/* carrega a query guardada (ou a predefinida) e o último link usado */
browser.storage.local
  .get(["lensQuery", "lastImageUrl"])
  .then((s) => {
    queryInput.value = s.lensQuery || DEFAULT_QUERY;
    if (s.lastImageUrl) urlInput.value = s.lastImageUrl;
  });

/* [NOVO] botão Colar — lê a área de transferência para o campo do link */
$("paste").addEventListener("click", async () => {
  try {
    const clip = (await navigator.clipboard.readText()).trim();
    if (clip) {
      urlInput.value = normalizeUrl(clip);
      showStatus("loading", "Link colado da área de transferência.");
      urlInput.focus();
    } else {
      showStatus("error", "A área de transferência está vazia.");
    }
  } catch (e) {
    showStatus("error", "Sem acesso à área de transferência — cola com Ctrl+V.");
    urlInput.focus();
  }
});

$("resetQuery").addEventListener("click", () => {
  queryInput.value = DEFAULT_QUERY;
  browser.storage.local.set({ lensQuery: DEFAULT_QUERY });
  showStatus("loading", "Query reposta para a predefinição.");
});

$("extract").addEventListener("click", async () => {
  const url = normalizeUrl(urlInput.value);
  const query = queryInput.value.trim() || DEFAULT_QUERY;

  if (!url) {
    showStatus("error", "Cola primeiro o link da imagem.");
    urlInput.focus();
    return;
  }
  if (!/^https?:\/\/[^/\s]+\.[a-z]{2,}/i.test(url)) {
    showStatus("error", "Esse link não parece válido (ex.: https://i.gyazo.com/….png).");
    urlInput.focus();
    return;
  }

  const isGoogleSearch =
    /^https?:\/\/(www\.)?google\.[a-z.]+\/search/i.test(url);
  const isLens = /^https?:\/\/lens\.google\.[a-z.]+/i.test(url);
  const openUrl =
    isGoogleSearch || isLens
      ? url
      : "https://lens.google.com/uploadbyurl?hl=pt-PT&url=" +
        encodeURIComponent(url);

  /* guarda tudo ANTES de abrir a aba (o popup fecha-se logo a seguir) */
  try {
    await browser.storage.local.set({
      lensQuery: query,
      lastImageUrl: url,
      lensPending: { at: Date.now(), url: url, query: query } /* sinal rico, 15 min */
    });
  } catch (e) {
    console.warn("[Popup] storage falhou:", e);
  }

  showStatus(
    "success",
    "A abrir o Lens… 1) a imagem carrega → 2) a query é anexada " +
      "automaticamente → 3) os itens do AI Overview vão diretos para a calculadora."
  );

  try {
    await browser.tabs.create({ url: openUrl, active: true });
  } catch (e) {
    showStatus("error", "Não consegui abrir o separador: " + e.message);
  }
});

$("openSite").addEventListener("click", () => {
  browser.tabs.create({ url: SITE_URL, active: true });
});

$("openLens").addEventListener("click", () => {
  browser.tabs.create({ url: "https://lens.google.com/", active: true });
});

/* Enter no campo do link = Extrair */
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("extract").click();
});
