// popup.js — lançador. Abre o Lens; a extracção e entrega são feitas pelo
// content script + background, sem depender deste popup (que fecha ao abrir aba).
const status = document.getElementById("status");
const btn = document.getElementById("extract");

btn.addEventListener("click", async () => {
  const url = document.getElementById("url").value.trim();
  if (!url) {
    status.className = "status visible error";
    status.textContent = "Cola o link da imagem primeiro.";
    return;
  }

  // Detectar se o URL já é uma pesquisa do Lens (google.com/search com udm=24
  // ou source=lns) e abrir a URL diretamente. Se não for, usa o uploadbyurl
  // como antes. Fix: sem isto, a extensão always abre uploadbyurl e o content
  // script nunca extrai (só extrai de google.com/search).
  const isLensSearchUrl = /google\.com\/search/.test(url) || /lens\.google\.com/.test(url);
  let openUrl = url;
  if (!isLensSearchUrl) {
    openUrl = `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(url)}`;
  }

  status.className = "status visible loading";
  status.textContent = isLensSearchUrl
    ? "A abrir a pesquisa no Lens... aguarda o AI Overview."
    : "A abrir o Lens... aguarda o AI Overview. A calculadora abre sozinha quando os itens forem lidos.";
  await browser.tabs.create({ url: openUrl, active: true });
  // O popup vai fechar sozinho ao perder o foco — é normal.
});

document.getElementById("openSite").addEventListener("click", () => {
  browser.tabs.create({ url: "https://offsetrp-calculadora.vercel.app" });
});
