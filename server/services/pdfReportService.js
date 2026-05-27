// server/services/pdfReportService.js
// Generates PDF buffers from report HTML.

async function generatePdfFromHtml(html = "", options = {}) {
  if (!String(html || "").trim()) {
    const err = new Error("PDF HTML content is empty.");
    err.status = 400;
    throw err;
  }

  let puppeteer;
  try {
    puppeteer = require("puppeteer");
  } catch (err) {
    const e = new Error("PDF generator is not installed. Run: npm install");
    e.status = 500;
    e.details = { reasonCode: "PUPPETEER_NOT_INSTALLED" };
    throw e;
  }

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--allow-file-access-from-files"]
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });

    await page.evaluate(async () => {
      const images = Array.from(document.images || []);
      await Promise.all(images.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve;
          setTimeout(resolve, 1500);
        });
      }));
      if (document.fonts?.ready) await document.fonts.ready;
    });

    return await page.pdf({
      format: options.format || "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: options.margin || { top: "8mm", right: "8mm", bottom: "8mm", left: "8mm" }
    });
  } finally {
    await browser.close();
  }
}

module.exports = { generatePdfFromHtml };
