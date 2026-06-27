// server/services/pdfReportService.js
// Generates PDF buffers from report HTML without Puppeteer/Chrome cache dependency.

const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_PRINT_STYLE = `
  <style id="spwt-pdf-print-defaults">
    @page { size: A4; margin: 8mm; }
    html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  </style>
`;

function clean(value) {
  return String(value ?? "").trim();
}

function ensureHtml(html = "") {
  const value = String(html || "").trim();
  if (!value) {
    const err = new Error("PDF HTML content is empty.");
    err.status = 400;
    throw err;
  }

  if (/id=["']spwt-pdf-print-defaults["']/i.test(value)) return value;
  if (/<\/head>/i.test(value)) return value.replace(/<\/head>/i, `${DEFAULT_PRINT_STYLE}</head>`);

  return `<!doctype html><html><head><meta charset="utf-8">${DEFAULT_PRINT_STYLE}</head><body>${value}</body></html>`;
}

function electronRuntime() {
  if (!process.versions?.electron) return null;

  try {
    const electron = require("electron");
    if (!electron || typeof electron === "string") return null;
    if (!electron.app || !electron.BrowserWindow) return null;
    return electron;
  } catch (_) {
    return null;
  }
}

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}
}

async function waitForPageReady(win) {
  try {
    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const finish = () => requestAnimationFrame(() => requestAnimationFrame(resolve));
        const images = Array.from(document.images || []);
        const imageWait = Promise.all(images.map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((done) => {
            img.onload = done;
            img.onerror = done;
            setTimeout(done, 1500);
          });
        }));
        const fontWait = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
        Promise.all([imageWait, fontWait]).then(finish).catch(finish);
      })
    `, true);
  } catch (_) {}
}

function makeTempHtmlFile(html) {
  const dir = path.join(os.tmpdir(), "sp-worktrack-pdf");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `report-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.html`);
  fs.writeFileSync(file, html, "utf8");
  return file;
}

async function generatePdfWithElectron(html, options = {}) {
  const electron = electronRuntime();
  if (!electron) return null;

  const { app, BrowserWindow } = electron;
  if (!app.isReady()) await app.whenReady();

  let win = null;
  let tempFile = "";

  try {
    tempFile = makeTempHtmlFile(html);
    win = new BrowserWindow({
      show: false,
      width: 1240,
      height: 1754,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: false
      }
    });

    await win.loadFile(tempFile);
    await waitForPageReady(win);

    return await win.webContents.printToPDF({
      pageSize: options.format || "A4",
      printBackground: true,
      preferCSSPageSize: true,
      landscape: !!options.landscape
    });
  } finally {
    if (win && !win.isDestroyed()) win.close();
    safeUnlink(tempFile);
  }
}

function htmlToPlainText(html = "") {
  return clean(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n"));
}

function generatePdfWithJsPdf(html) {
  const { jsPDF } = require("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 36;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const usableWidth = pageWidth - margin * 2;
  const lineHeight = 13;
  let y = margin;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  const text = htmlToPlainText(html) || "SP WorkTrack Report";
  const lines = doc.splitTextToSize(text, usableWidth);

  for (const line of lines) {
    if (y > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += lineHeight;
  }

  return Buffer.from(doc.output("arraybuffer"));
}

async function generatePdfFromHtml(html = "", options = {}) {
  const preparedHtml = ensureHtml(html);

  const electronPdf = await generatePdfWithElectron(preparedHtml, options);
  if (electronPdf) return electronPdf;

  return generatePdfWithJsPdf(preparedHtml);
}

module.exports = { generatePdfFromHtml };
