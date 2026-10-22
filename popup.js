/* ============================================================================
 * popup.js — v4.0.0
 * Lançador: guarda a query (storage.local), marca a sessão como pendente e
 * abre o Lens. A extração e a entrega são feitas por lens-extract.js +
 * background.js — o popup pode fechar-se sem estragar nada.
 * ==========================================================================*/

const DEFAULT_QUERY =
  "Consegues meter nome - quantidade arma- municao acessorios- quantidade na imagem se aparecer acessorios mete so o numero petrocal se tiver numero em cima ignora e so 1";

const $ = (id) => document.getElementById(id);
const status = $("status");
const urlInput = $("url");
const queryInput = $("query");

function showStatus(kind, html) {
  status.className = "status visible " + kind;
  status.innerHTML = html;
}

// carrega a query guardada (ou a predefinida) e o último link usado
browser.storage.local.get(["lensQuery", "lastImageUrl"]).then((s) => {
  queryInput.value = s.lensQuery || DEFAULT_QUERY;
  if (s.lastImageUrl) urlInput.value = s.lastImageUrl;
});

$("resetQuery").addEventListener("click", () => {
  queryInput.value = DEFAULT_QUERY;
  browser.storage.local.set({ lensQuery: DEFAULT_QUERY });
  showStatus("loading", "Query reposta para a predefinição.");
});

$("extract").addEventListener("click", async () => {
  const url = urlInput.value.trim();
  const query = queryInput.value.trim() || DEFAULT_QUERY;

  if (!url) {
    showStatus("error", "Cola primeiro o link da imagem.");
    urlInput.focus();
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    showStatus("error", "Esse link não parece válido — tem de começar por http(s)://");
    urlInput.focus();
    return;
  }

  const isLensSearchUrl =
    /google\.com\/search/i.test(url) || /lens\.google\.com\//i.test(url);

  const openUrl = isLensSearchUrl
    ? url
    : "https://lens.google.com/uploadbyurl?hl=pt-PT&url=" + encodeURIComponent(url);

  // guarda tudo ANTES de abrir a aba (o popup fecha-se logo a seguir)
  try {
    await browser.storage.local.set({
      lensQuery: query,
      lastImageUrl: url,
      lensPending: Date.now()
    });
  } catch (e) {
    console.warn("[Popup] storage falhou:", e);
  }

  showStatus(
    "success",
    "A abrir o Lens…<br>1) a imagem carrega &nbsp;→ 2) a query é anexada automaticamente " +
      "(igual a escreveres na caixa) &nbsp;→ 3) os itens do AI Overview vão diretos para a calculadora."
  );

  try {
    await browser.tabs.create({ url: openUrl, active: true });
  } catch (e) {
    showStatus("error", "Não consegui abrir o separador: " + e.message);
  }
});

$("openSite").addEventListener("click", () => {
  browser.tabs.create({ url: "https://offsetrp-calculadora.vercel.app", active: true });
});

$("openLens").addEventListener("click", () => {
  browser.tabs.create({ url: "https://lens.google.com/", active: true });
});

// Enter no campo do link = Extrair
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("extract").click();
});
