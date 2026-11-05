/* ============================================================================
 * background.js — v5.6.0
 * Base: v5.4.2 aprovada no AMO (envia o texto imediatamente, com retry).
 * v5.6.0: após entregar a mensagem direta, marca o storage como consumido
 *         para o fallback não voltar a injetar o mesmo texto (duplicação).
 * v5.5.0: migra a query antiga para a nova, que obriga a listar todas as
 *         pilhas sem juntar/somar/deduplicar e a manter quantidades em milhões.
 * ==========================================================================*/

const SITE_URL = "https://offsetrp-calculadora.vercel.app";
const OLD_DEFAULT_QUERY = `Analisa a imagem deste inventário e extrai todos os itens num formato de lista simples ("Nome: Quantidade"), seguindo rigorosamente estas regras de formatação:

1. Itens normais: Mostra o nome do item e a quantidade (ex: "Bifana: x3").
2. Armas: Mostra o nome da arma, o número de munições e a quantidade de acessórios acoplados (ex: "Machine Pistol: 117 munições | 1 acessório"). Se houver acessórios, coloca apenas a quantidade numérica deles.
3. Petrol Can (Galão de Combustível): Ignora qualquer número grande que apareça no topo do ícone. A quantidade deve ser sempre fixada em "x1".
4. Caixas vazias: Não listes os espaços vazios do inventário.

Mantém a resposta curta, direta e apenas com a lista formatada.`;
const DEFAULT_QUERY = `Analisa a imagem deste inventário e extrai TODOS os itens visíveis, um por linha, no formato "Nome: xQuantidade", seguindo rigorosamente estas regras:

1. Itens normais: nome do item e quantidade (ex: "Bifana: x3"). Copia cada pilha tal como aparece — se houver várias pilhas do mesmo item (ex: vários "Dinheiro"), lista TODAS, sem juntar, somar ou eliminar duplicados.
2. Quantidades completas: mantém o número inteiro, mesmo que seja em milhões (ex: "Dinheiro: x100000000"). Não uses separadores de milhares.
3. Armas: nome da arma, número de munições e quantidade de acessórios acoplados (ex: "Machine Pistol: 117 munições | 1 acessório"). Para acessórios, usa apenas a quantidade numérica.
4. Petrol Can (Galão de Combustível): ignora qualquer número grande no topo do ícone; a quantidade é sempre "x1".
5. Caixas vazias: não listes os espaços vazios do inventário.
6. Ignora etiquetas de interface (ex: "Loot Table Config", "Better Loot", "Config"), números de nível por cima dos itens e texto cortado com "...". Não traduzas os nomes.

Responde apenas com a lista formatada.`;

function notify(title, message) {
  try {
    browser.notifications.create({
      type: "basic",
      iconUrl: browser.runtime.getURL("icon.svg"),
      title: title,
      message: message
    });
  } catch (e) {}
}

async function copyToClipboard(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {}
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
  } catch (e) {}
}

async function openLensSearch(imageOrLensUrl) {
  const isGoogleSearch = /^https?:\/\/(www\.)?google\.[a-z.]+\/search/i.test(imageOrLensUrl);
  const isLens = /^https?:\/\/lens\.google\.[a-z.]+/i.test(imageOrLensUrl);

  const openUrl = isGoogleSearch || isLens
      ? imageOrLensUrl
      : "https://lens.google.com/uploadbyurl?hl=pt-PT&url=" + encodeURIComponent(imageOrLensUrl);

  await setPending(imageOrLensUrl);
  try {
    await browser.tabs.create({ url: openUrl, active: true });
  } catch (e) {
    notify("Lens Extractor", "Não consegui abrir o separador do Lens: " + e.message);
  }
}

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
  if (text) copyToClipboard(text);

  let tabId = null;
  try {
    const tabs = await browser.tabs.query({ url: SITE_URL + "/*" });
    if (tabs && tabs.length) {
      tabId = tabs[0].id;
      await browser.tabs.update(tabId, { active: true });
    } else {
      const t = await browser.tabs.create({ url: SITE_URL, active: true });
      tabId = t.id;
    }
  } catch (e) {
    notify("Lens Extractor", "Texto copiado — não consegui abrir a calculadora.");
    return;
  }

  // [FIX] Dispara imediatamente. O retry (a cada 900ms) garante que chega lá.
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
        // Mensagem entregue: marca o storage como consumido para o fallback
        // não voltar a injetar o mesmo texto (duplicava o parser no site).
        try {
          await browser.storage.local.set({ lastExtraction: { ...payload, consumed: true } });
        } catch (e) {}
        console.log("[BG] texto entregue à calculadora (tentativa " + attempts + ")");
      } catch (e) {
        if (attempts >= 12) {
          clearInterval(timer);
          console.warn("[BG] sem resposta do site-inject — o fallback via storage trata disto.");
        }
      }
    }, 900);
  }

  armMessaging();
}

function setupContextMenu() {
  try {
    browser.contextMenus.removeAll().then(() => {
      browser.contextMenus.create({
        id: "offset-lens-extract",
        title: "Extrair itens com Lens (Offset RP)",
        contexts: ["image"]
      });
    });
  } catch (e) {}
}

/* Migra quem ainda tem a query antiga (5.4.x) guardada para a nova. Quem
 * personalizou a query fica com a sua. */
async function migrateQuery() {
  try {
    const s = await browser.storage.local.get("lensQuery");
    const q = (s.lensQuery || "").trim();
    if (!q || q === OLD_DEFAULT_QUERY.trim()) {
      await browser.storage.local.set({ lensQuery: DEFAULT_QUERY });
    }
  } catch (e) {}
}

browser.runtime.onInstalled.addListener(() => {
  setupContextMenu();
  migrateQuery();
});
browser.runtime.onStartup.addListener(() => {
  setupContextMenu();
  migrateQuery();
});
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
    const n = msg.count || msg.text.split("\n").filter((l) => l.trim()).length;
    notify("Itens extraídos (" + n + ")", "A abrir a calculadora e a colar o texto…");
    deliverToSite(msg.text, { partial: false });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "LENS_TEXT_FAILED") {
    const partial = (msg.text || "").trim();
    if (partial) {
      notify("Extração incompleta", "Enviei o que apanhei. Confere o texto.");
      deliverToSite(partial, { partial: true });
    } else {
      notify("Lens Extractor", "O AI Overview não apareceu. A calculadora vai abrir.");
      deliverToSite("", { partial: false });
    }
    sendResponse({ ok: true });
    return true;
  }

  return false;
});