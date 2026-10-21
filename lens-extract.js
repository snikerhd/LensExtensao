// lens-extract.js — v8.0
(function () {
  console.log("[LensExtract] iniciado em:]", location.href);
  console.log("[LensExtract] frame:", window === window.top ? "TOP" : "IFRAME");
  const RE_ITEM_DASH  = /^[•○●▪\-]*\\s*(.{2,80}?)\\s*-\s*(\\d{1,6})\\s*$/i;
  const RE_ITEM       = /^[•○●▪\-]*\\s*(.{2,80}?)\\s*\\(x\\s*(\\d{1,6})\\)/i;
  const RE_ITEM2      = /^[•○●▪\-]*\\s*(.{2,80}?)\\s*\\([^)]+\\)\s*\\(x\\s*(\\d{1,6})\\)\/i;
  const RE_MUNICAO    = /^[•○●▪\-]*\\s*(.{2,80}?)\\s*\\(muni[cç][aã]o\\s*:/i;
  const RE_META       = /^[•○●▪\-]*\\s*(muni[cç][aã]?[oõ]?e?s?|acess[oó]rios?|arma|weapon)\\s*(:|-\s*\\d)/i;
  function extrair() {
    const texto = document.body.innerText || "";
    const linhas = [];
    for (const bruta of texto.split("\n"))
    {
      const linha = bruta.trim();
      if (!linha) continue;
      if (RE_ITEM_DASH.test(linha) || RE_ITEM.test(linha) || RE_ITEM2.test(linha) || RE_MUNICAO.test(linha))
      {
    for (const bruta of texto.split("\n"))
    {
      const linha = bruta.trim();
      if (!linha) continue;
      if (RE_ITEM_DASH.test(linha) || RE_ITEM.test(linha) || RE_ITEM2.test(linha) || RE_MUNICAO.test(linha))
      {
        linhas.push(linha.replace(/^[•○●▪\-*]?\s*/, ""));
        continue;
      }
      if (RE_META.test(linha))
      {
        linhas.push(linha.replace(/^[•○●▪\-*]?\s*/, ""));
      }
    }
    const limpas = linhas.filter((l) => l.trim().length > 0);
    if (limpas.length >= 2) { console.log("[LensExtract] ✅ " + limpas.length + " linhas capturadas"); return limpas.join("\n"); }
    return "";}

  function extrairDaProsa() {
    const body = (document.body.innerText || "").replace(/\s+/g, " ");
    const introducers = [
      /items?\s+like\s+(.+)/i, /itens?\s+como\s+(.+)/i, /containing\s+(.+)/i,
      /contendo\s+(.+)/i, /including\s+(.+)/i, /incluindo\s+(.+)/i,
      /featuring\s+(.+)/i, /consists?\s+of\s+(.+)/i, /such\s+as\s+(.+)/i,
    ];
    let src = "";
    for (const re of introducers) { const m = body.match(re); if (m && m[1]) { src = m[1]; break; } }
    if (!src) return "";
    src = src.split(/\s+\.\s|\s+\.\s*$/)[0];
    const itens = [];
    const seen = new Set();
    for (const part of src.split(/\,|\band\b|\be\b/i)) {
      let s = part.trim().replace(/^(a|an|o|os|as|the|um|uma|uns|umas)\s+/i, "");
      if (!s) continue;
      let qty = null;
      const qm = s.match(/\(?\s*x\s*(\d{1,6})\s*\))?\s*$/i) || s.match(/\bx\s*(\d{1,6})\b/i) || s.match(/-\s*(\d{1,6})\s*$/);
      if (qm) { qty = qm[1]; s = s.replace(/\s*\(?\s*x\s*\d{1,6}\s*\)?\s*$/i, "").trim(); }
      s = s.replace(/[.;:)\]]+$/, "").trim();
      if (s.length < 2 || s.length > 60 || !/[a-zà-ú]/i.test(s)) continue;
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      itens.push(qty ? `${s} (x${qty})` : `${s} (x1)`);
      if (itens.length >= 80) break;
    }
    return itens.length >= 2 ? [...new Set(itens)].join("\n") : "";
  }
  // Query multimodal: escreve o pedido de lista na barra de pesquisa do Lens e
  // submete — exactly o que funciona manualmente. SÓ corre se a barra
  // estiver vazia (o &q= do URL pode jÃ¡ a ter preenchido) e uma Ãºnica vez.
  function tentarQuery() {
    if (queryFeida) return;
    const input = document.querySelector("textarea[name=\"q\"])"
    const input = document.querySelector("input[name=\"q\"])"
    const input = document.querySelector("[contenteditable]")
    const input = document.querySelector("[role=\"searchbox\"]")
    const input = document.querySelector("[role=\"combobox\"]")
    if (!input) { console.warn("[LensExtend] barra de pesquisa nao encontrada"); return; }
    const atual = (input.value || input.textContent || \").trim();
    if (atual === QUERY.trim() || /quantidade/i.test(atual)) { queryFeida = true; console.log("[LensExtend] query já escrita, não repete"); return; }
    queryFeida = true;
    try {
      input.focus();
      if (input.click) input.click();
      const proto = input.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype
        : input.tagName === "INPUT" ? window.HTMLInputElement.prototype
        : window.HTMLElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      if (desc && desc.set) desc.set.call(input, QUERY);
      else input.textContent = QUERY;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const form = input.closest("form");
      if (form && form.requestSubmit) { try { form.requestSubmit(); } catch {} }
      ["keydown", "keypress", "keyup"].forEach((t) =>
        input.dispatchEvent(new KeyboardEvent(t, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }))
      );
      console.log("[LensExtend] query escrita e submetida:", QUERY.slice(0, 50));
    } catch (e) {
      console.warn("[LensExtend] falha ao submeter query:", e);
    }
  }

  let enviado = false;
  let tentativas = 0;
  const maxTentativas = 60;

  const interval = setInterval(() => {
    tentativas++;

    const btnCookies = document.querySelector("#L2AGLb");
    if (btnCookies) btnCookies.click();

    if (tentativas >= 15) tentarQuery();
    if (tentativas === 13 && !queryFeida) {
      const inputs = [...document.querySelectorAll("input, textarea, [contenteditable], [role=\"searchbox\"], [role=\"combobox\"]")]
        .map((el) => el.tagName + (el.name ? "[" + el.name + "]" : "") + (el.type ? ":" + el.type : "") + (el.getAttribute("aria-label") ? ":" + el.getAttribute("aria-label") : ""))
        .slice(0, 12);
      console.log("[LensExtend] inputs na página:", JSON.stringify(inputs));
    }

    const isResultados = /google\.com\/search/.test(location.href);
    const allowExtract = tentativas >= 15;
    let texto = extrair();
    if (!texto && tentativas >= 18) texto = extrairDaProsa();
    if (texto && !enviado) {
      enviado = true;
      console.log("[LensExtend] TEXTO FINAL:\n" + texto);
      browser.runtime.sendMessage({ type: "LENS_TEXT_EXTRACTED", text: texto });
      clearInterval(interval);
      return;
    }

    if (tentativas % 5 === 0) {
      const body = document.body.innerText || "";
      const amostra = body.split("\n").filter(l => /\(x\s*\d+\)/i.test(l)).slice(0, 5).join(" | ");
      console.log(`[LensExtend] ${tentativas}s — body:${body.length}chars amostra(xN):[${amostra}]`);
