/* ============================================================================
 * background.js — v4.0.0
 * Orquestrador da extensão:
 *   · menu de contexto: clique direito numa imagem → "Extrair itens com Lens"
 *   · recebe o texto extraído (lens-extract.js), guarda-o em storage e abre a
 *     calculadora, injectando o texto com retries (site-inject.js)
 * ==========================================================================*/

const SITE_URL = "https://offsetrp-calculadora.vercel.app";
const DEFAULT_QUERY =
  "Consegues meter nome - quantidade arma- municao acessorios- quantidade na imagem se aparecer acessorios mete so o numero petrocal se tiver numero em cima ignora e so 1";

/* ------------------------------------------------------------- helpers --- */

function notify(title, message) {
  try {
    browser.notifications.create({
      type: "basic",
      iconUrl: "icon.svg",
      title: title,
      message: message
    });
  } catch (e) {
    console.warn("[BG] notify falhou:", e);
  }
}

function openLensSearch(imageOrLensUrl) {
  const isLensSearchUrl =
    /^https?:\/\/(www\.)?google\.com\/search/i.test(imageOrLensUrl) ||
    /^https?:\/\/lens\.google\.com\//i.test(imageOrLensUrl);

  const openUrl = isLensSearchUrl
    ? imageOrLensUrl
    : "https://lens.google.com/uploadbyurl?hl=pt-PT&url=" +
      encodeURIComponent(imageOrLensUrl);

  // sinal fresco → diz ao content script que esta sessão veio da extensão
  browser.storage.local
    .set({ lensPending: Date.now() })
    .catch(() => {})
    .then(() => browser.tabs.create({ url: openUrl, active: true }));
}

// Abre a calculadora e injecta o texto (com retries enquanto a página carrega).
async function deliverToSite(text) {
  // Persistir para o content script poder levantar mesmo que os retries falhem
  try {
    await browser.storage.local.set({
      lastExtraction: { text: text, at: Date.now(), consumed: false }
    });
  } catch (e) {}

  const tab = await browser.tabs.create({ url: SITE_URL, active: true });
  let attempts = 0;
  const maxAttempts = 15;

  const tryInject = async () => {
    attempts++;
    try {
      await browser.tabs.sendMessage(tab.id, { type: "INJECT_OCR_TEXT", text: text });
      console.log("[BG] texto injectado na calculadora (tentativa " + attempts + ")");
    } catch (e) {
      if (attempts < maxAttempts) setTimeout(tryInject, 1000);
      else
        console.warn(
          "[BG] não consegui enviar mensagem — o site-inject vai levantar via storage."
        );
    }
  };
  setTimeout(tryInject, 1500);
}

/* ------------------------------------------------------ menu de contexto --- */

function setupContextMenu() {
  try {
    browser.contextMenus.removeAll().then(() => {
      browser.contextMenus.create({
        id: "offset-lens-extract",
        title: "Extrair itens com Lens (Offset RP)",
        contexts: ["image"]
      });
    });
  } catch (e) {
    console.warn("[BG] contextMenus:", e);
  }
}

browser.runtime.onInstalled.addListener(() => {
  setupContextMenu();
  // garante a query predefinida na primeira instalação/atualização
  browser.storage.local.get("lensQuery").then((s) => {
    if (!s.lensQuery) browser.storage.local.set({ lensQuery: DEFAULT_QUERY });
  });
});
browser.runtime.onStartup.addListener(setupContextMenu);
setupContextMenu();

browser.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "offset-lens-extract" && info.srcUrl) {
    openLensSearch(info.srcUrl);
    notify(
      "Lens Extractor",
      "A abrir o Google Lens… depois a query é anexada e os itens vão diretos para a calculadora."
    );
  }
});

/* ------------------------------------------------------------- mensagens --- */

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "LENS_SEARCH_IMAGE" && msg.url) {
    // aberto a partir do popup (ou de outro sítio) — reutiliza o mesmo fluxo
    openLensSearch(msg.url);
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "LENS_TEXT_EXTRACTED" && msg.text) {
    const n = msg.count || msg.text.split("\n").filter(Boolean).length;
    console.log("[BG] extração OK:", n, "itens → a entregar na calculadora");
    notify("Itens extraídos (" + n + ")", "A abrir a calculadora e a colar o texto…");
    deliverToSite(msg.text);
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "LENS_TEXT_FAILED") {
    console.warn("[BG] extração falhou");
    notify(
      "Lens Extractor",
      "O AI Overview não apareceu ou não tinha itens em 'nome - quantidade'. Tenta outra imagem ou cola o texto manualmente."
    );
    sendResponse({ ok: true });
  }

  return false;
});
