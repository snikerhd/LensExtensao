/* ============================================================================
 * popup.js — v5.5.0
 * v5.5.0: Query estruturada atualizada (todas as pilhas, quantidades em
 *         milhões) + migração automática da query antiga.
 * ==========================================================================*/

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
const SITE_URL = "https://offsetrp-calculadora.vercel.app";

const $ = (id) => document.getElementById(id);
const status = $("status");
const urlInput = $("url");
const queryInput = $("query");

function showStatus(kind, message) {
  status.className = "status visible " + kind;
  status.textContent = message;
}

function normalizeUrl(raw) {
  let u = String(raw || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

browser.storage.local
  .get(["lensQuery", "lastImageUrl"])
  .then((s) => {
    let q = s.lensQuery;
    if (!q || q.trim() === OLD_DEFAULT_QUERY.trim()) {
      q = DEFAULT_QUERY;
      browser.storage.local.set({ lensQuery: q });
    }
    queryInput.value = q;
    if (s.lastImageUrl) urlInput.value = s.lastImageUrl;
  });

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

  try {
    await browser.storage.local.set({
      lensQuery: query,
      lastImageUrl: url,
      lensPending: { at: Date.now(), url: url, query: query }
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
    showStatus("error", "Não consegui abrir o separador: " + (e && e.message ? e.message : "erro desconhecido"));
  }
});

$("openSite").addEventListener("click", () => {
  browser.tabs.create({ url: SITE_URL, active: true });
});

$("openLens").addEventListener("click", () => {
  browser.tabs.create({ url: "https://lens.google.com/", active: true });
});

urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("extract").click();
});