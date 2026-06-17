// renderer/textSanitizerPatch.js
// Cleans old mojibake symbols that came from earlier Windows/UTF-8 copy-paste issues.
// Example: "a¢" visible as separator becomes " - ".
(function () {
  const REPLACEMENTS = [
    [/\u00c2\u00a9/g, "Copyright"],
    [/\u00c2/g, ""],
    [/\u00e2\u20ac\u00a2/g, " - "],
    [/\u00e2\u20ac\u201d/g, " - "],
    [/\u00e2\u20ac\u201c/g, " - "],
    [/\u00e2\u20ac\u0153/g, '"'],
    [/\u00e2\u20ac\u009d/g, '"'],
    [/\u00e2\u20ac\u02dc/g, "'"],
    [/\u00e2\u20ac\u2122/g, "'"],
    [/\u00e2\u0153\u2026/g, ""],
    [/\u00f0\u0178[^\s<]*/g, ""],
    [/\u0393\u00c7\u00f6/g, "-"],
    [/G\uFFFD\uFFFD/g, "-"],
    [/\uFFFD+/g, ""]
  ];

  function cleanText(value) {
    let text = String(value ?? "");
    for (const [pattern, replacement] of REPLACEMENTS) text = text.replace(pattern, replacement);
    text = text.replace(/\s+-\s+/g, " - ").replace(/\s{2,}/g, " ");
    return text;
  }

  function cleanNode(node) {
    if (!node) return;

    if (node.nodeType === Node.TEXT_NODE) {
      const fixed = cleanText(node.nodeValue);
      if (fixed !== node.nodeValue) node.nodeValue = fixed;
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node;
    if (["SCRIPT", "STYLE", "TEXTAREA"].includes(el.tagName)) return;

    if (el instanceof HTMLInputElement && ["button", "submit", "reset"].includes(el.type)) {
      const fixed = cleanText(el.value);
      if (fixed !== el.value) el.value = fixed;
    }

    if (el instanceof HTMLOptionElement) {
      const fixed = cleanText(el.textContent);
      if (fixed !== el.textContent) el.textContent = fixed;
    }

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(textNode) {
        const parent = textNode.parentElement;
        return parent && ["SCRIPT", "STYLE", "TEXTAREA"].includes(parent.tagName)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      }
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(cleanNode);
  }

  function cleanDocument() {
    if (document.body) cleanNode(document.body);
  }

  function observe() {
    cleanDocument();
    if (!document.body || window.SPWT_TEXT_SANITIZER_OBSERVER) return;

    let pending = false;
    const observer = new MutationObserver((mutations) => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        for (const mutation of mutations) {
          if (mutation.type === "characterData") cleanNode(mutation.target);
          mutation.addedNodes.forEach(cleanNode);
          if (mutation.target instanceof HTMLSelectElement) cleanNode(mutation.target);
        }
      });
    });

    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    window.SPWT_TEXT_SANITIZER_OBSERVER = observer;
  }

  window.SPWT = window.SPWT || {};
  window.SPWT.cleanText = cleanText;
  window.SPWT.cleanDocumentText = cleanDocument;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observe, { once: true });
  else observe();

  window.addEventListener("load", () => setTimeout(cleanDocument, 250));
})();
