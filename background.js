/* ============================================================================
 * background.js — v5.2.0
 * v5.2.0: sem mudanças funcionais — a submissão automática (botão de lupa
 * identificado pelo SVG Material + retentativa) vive em lens-extract.js.
 * Orquestrador da extensão (Firefox MV2).
 * ----------------------------------------------------------------------------
 * CORREÇÕES v5 (vs. v4.0.0):
 *  [FIX 1] O "sinal" lensPending deixou de ser só um timestamp com TTL de
 *          3 minutos: agora é um objecto {at, url, query} válido durante
 *          15 minutos — deixou de caducar quando o utilizador demora na
 *          página de consentimento. → "às vezes falhava a pesquisa"
 *  [FIX 2] O pending é gravado com `await` ANTES de abrir a aba do Lens —
 *          o content script nunca apanha uma corrida vazia.
 *  [FIX 3] A calculadora JÁ NÃO abre num separador novo em cada extração:
 *          reutiliza/recarrega a aba existente (evita duplicados e perdas).
 *  [FIX 4] A injeção fica à escuta do evento onUpdated "complete" da aba
 *          em vez de disparar mensagens às cegas — o texto chega sempre.
 *  [FIX 5] Em falha, a calculadora abre na mesma (antes ficava tudo parado
 *          e não abria o site) e, se houver itens parciais, vão também.
 *  [FIX 6] O texto extraído é SEMPRE copiado para a área de transferência
 *          como rede de segurança (podes colar à mão se tudo falhar).
 * ==========================================================================*/

const SITE_URL = "https://offsetrp-calculadora.vercel.app";
const DEFAULT_QUERY =
  "Consegues meter nome - quantidade arma- municao acessorios- quantidade na imagem se aparecer acessorios mete so o numero petrocal se tiver numero em cima ignora e so 1";

/* ------------------------------------------------------------- helpers --- */

function notify(title, message) {
  try {
    browser.notifications.create({
      type: "basic",
      iconUrl: browser.runtime.getURL("icon.svg"),
      title: title,
      message: message
    });
  } catch (e) {
    console.warn("[BG] notify falhou:", e);
  }
}

/* Rede de segurança: copia o texto para a área de transferência. */
async function copyToClipboard(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    /* fallthrough */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

/* Grava o sinal "veio da extensão" — objecto rico, TTL 15 min. [FIX 1] */
async function setPending(imageOrLensUrl) {
  let s = {};
  try {
    s = await browser.storage.local.get("lensQuery");
  } catch (e) {}
  const query = (s.lensQuery || DEFAULT_QUERY).trim();
  try {
    await browser.storage.local.set({
      lensPending: { at: Date.now(), url: imageOrLensUrl, query: query }
    });
  } catch (e) {
    console.warn("[BG] não consegui gravar lensPending:", e);
  }
}

async function openLensSearch(imageOrLensUrl) {
  const isGoogleSearch =
    /^https?:\/\/(www\.)?google\.[a-z.]+\/search/i.test(imageOrLensUrl);
  const isLens = /^https?:\/\/lens\.google\.[a-z.]+/i.test(imageOrLensUrl);

  const openUrl =
    isGoogleSearch || isLens
      ? imageOrLensUrl
      : "https://lens.google.com/uploadbyurl?hl=pt-PT&url=" +
        encodeURIComponent(imageOrLensUrl);

  await setPending(imageOrLensUrl); /* [FIX 2] antes de abrir a aba */
  try {
    await browser.tabs.create({ url: openUrl, active: true });
  } catch (e) {
    notify("Lens Extractor", "Não consegui abrir o separador do Lens: " + e.message);
  }
}

/*
 * Abre (ou reutiliza [FIX 3]) a calculadora e entrega o texto:
 *   1. storage.local.lastExtraction → fonte da verdade (o site-inject levanta)
 *   2. clipboard → rede de segurança [FIX 6]
 *   3. mensagens com retry depois do "complete" da aba [FIX 4]
 */
async function deliverToSite(text, opts) {
  opts = opts || {};
  const payload = {
    text: text || "",
    at: Date.now(),
    consumed: false,
    partial: !!opts.partial
  };
  try {
    await browser.storage.local.set({ lastExtraction: payload });
  } catch (e) {}
  if (text) copyToClipboard(text); /* fire-and-forget */

  let tabId = null;
  try {
    const tabs = await browser.tabs.query({ url: SITE_URL + "/*" });
    if (tabs && tabs.length) {
      tabId = tabs[0].id;
      await browser.tabs.update(tabId, { url: SITE_URL, active: true });
    } else {
      const t = await browser.tabs.create({ url: SITE_URL, active: true });
      tabId = t.id;
    }
  } catch (e) {
    console.warn("[BG] não consegui abrir a calculadora:", e);
    notify("Lens Extractor", "Texto copiado — não consegui abrir a calculadora.");
    return;
  }

  /* envia mensagens com retry assim que a aba termina de carregar */
  function armMessaging() {
    if (!text) return;
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts++;
      try {
        await browser.tabs.sendMessage(tabId, {
          type: "INJECT_OCR_TEXT",
          text: text
        });
        clearInterval(timer);
        console.log("[BG] texto entregue à calculadora (tentativa " + attempts + ")");
      } catch (e) {
        if (attempts >= 12) {
          clearInterval(timer);
          console.warn("[BG] sem resposta do site-inject — o fallback via storage trata disto.");
        }
      }
    }, 900);
  }

  let done = false;
  const onUpdated = (id, info) => {
    if (id === tabId && info.status === "complete" && !done) {
      done = true;
      browser.tabs.onUpdated.removeListener(onUpdated);
      setTimeout(armMessaging, 500);
    }
  };
  browser.tabs.onUpdated.addListener(onUpdated);
  /* rede de segurança: se o evento nunca chegar, dispara na mesma */
  setTimeout(() => {
    if (!done) {
      done = true;
      browser.tabs.onUpdated.removeListener(onUpdated);
      armMessaging();
    }
  }, 8000);
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
      "A abrir o Google Lens… a query é anexada automaticamente e os itens vão diretos para a calculadora."
    );
  }
});

/* ------------------------------------------------------------- mensagens --- */

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "LENS_SEARCH_IMAGE" && msg.url) {
    if (msg.query) {
      browser.storage.local.set({ lensQuery: msg.query }).catch(() => {});
    }
    openLensSearch(msg.url);
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "LENS_TEXT_EXTRACTED" && msg.text) {
    const n =
      msg.count || msg.text.split("\n").filter((l) => l.trim()).length;
    console.log("[BG] extração OK:", n, "itens → a entregar na calculadora");
    notify(
      "Itens extraídos (" + n + ")",
      "A abrir a calculadora e a colar o texto…"
    );
    deliverToSite(msg.text, { partial: false });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "LENS_TEXT_FAILED") {
    const partial = (msg.text || "").trim();
    console.warn("[BG] extração falhou; parciais:", partial ? msg.count : 0);
    if (partial) {
      notify(
        "Extração incompleta (" + (msg.count || "?") + " itens)",
        "O AI Overview demorou — enviei o que apanhei. Confere o texto na calculadora."
      );
      deliverToSite(partial, { partial: true });
    } else {
      /* [FIX 5] mesmo sem nada, abre a calculadora em vez de ficar calado */
      notify(
        "Lens Extractor",
        "O AI Overview não apareceu (às vezes o Google não o mostra). A calculadora vai abrir — cola lá o texto à mão."
      );
      deliverToSite("", { partial: false });
    }
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
