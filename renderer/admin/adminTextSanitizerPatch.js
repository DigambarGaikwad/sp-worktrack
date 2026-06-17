// renderer/admin/adminTextSanitizerPatch.js
// Cleans mojibake characters in Admin dynamic sections without changing DB data.

(function () {
  const BAD_TEXT_RE = /(?:Ã|Â|â|�)/;
  const ROOT_SELECTOR = "#adminPanel, #tabPlannedAbsent, #tabPin";
  let scanTimer = null;

  const REPLACEMENTS = [
    [/â€¢/g, " - "],
    [/â†’/g, " to "],
    [/â€”/g, " - "],
    [/â€“/g, " - "],
    [/â€¦/g, "..."],
    [/âœ…/g, "saved"],
    [/âœ“/g, "saved"],
    [/Â©/g, "Copyright"],
    [/Â®/g, ""],
    [/Â /g, " "],
    [/ï»¿/g, ""],
    [/�/g, "-"]
  ];

  function cleanText(value) {
    let text = String(value ?? "");
    if (!BAD_TEXT_RE.test(text)) return text;
    for (const [pattern, replacement] of REPLACEMENTS) text = text.replace(pattern, replacement);
    return text.replace(/\s+-\s+-\s+/g, " - ").replace(/\s{2,}/g, " ").trim();
  }

  function cleanTextNode(node) {
    const next = cleanText(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  }

  function cleanOption(option) {
    const nextText = cleanText(option.textContent);
    if (nextText !== option.textContent) option.textContent = nextText;
    const nextLabel = cleanText(option.label || "");
    if (nextLabel && nextLabel !== option.label) option.label = nextLabel;
  }

  function cleanInputs(root) {
    root.querySelectorAll?.("option").forEach(cleanOption);
    root.querySelectorAll?.("input, textarea").forEach((el) => {
      if (typeof el.value === "string" && BAD_TEXT_RE.test(el.value)) el.value = cleanText(el.value);
      if (typeof el.placeholder === "string" && BAD_TEXT_RE.test(el.placeholder)) el.placeholder = cleanText(el.placeholder);
    });
  }

  function cleanRoot(root) {
    if (!root) return;
    cleanInputs(root);

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || ["SCRIPT", "STYLE", "TEXTAREA"].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
        return BAD_TEXT_RE.test(node.nodeValue || "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(cleanTextNode);
  }

  function scheduleClean() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => cleanRoot(document.querySelector(ROOT_SELECTOR) || document.body), 60);
  }

  function init() {
    cleanRoot(document.querySelector(ROOT_SELECTOR) || document.body);
    const observer = new MutationObserver(scheduleClean);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener("click", scheduleClean, true);
    document.addEventListener("change", scheduleClean, true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.SPWT_CLEAN_ADMIN_TEXT = cleanText;
})();
