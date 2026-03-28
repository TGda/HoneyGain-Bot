// bot.js - Versión v1.8.0
const puppeteer = require("puppeteer");
const http = require("http");
const https = require("https");

function getCurrentTimestamp() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = now.toLocaleDateString('en-US', { month: 'short' });
  const year = String(now.getFullYear()).slice(-2);
  const timeStr = now.toLocaleTimeString('es-ES', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  return `[${day}${month}${year} ${timeStr}]`;
}

function parseCountdownText(countdownText) {
  const regex = /(\d+)\s*hours?\s*(\d+)\s*min\s*(\d+)\s*sec/;
  const match = countdownText.match(regex);
  if (match && match.length === 4) {
    return {
      hours: parseInt(match[1], 10),
      minutes: parseInt(match[2], 10),
      seconds: parseInt(match[3], 10)
    };
  }
  console.warn(`${getCurrentTimestamp()} ⚠️ No se pudo parsear el temporizador: "${countdownText}". Usando 0 segundos.`);
  return { hours: 0, minutes: 0, seconds: 0 };
}

function timeToMilliseconds(timeObj) {
  return (timeObj.hours * 3600 + timeObj.minutes * 60 + timeObj.seconds) * 1000;
}

function getFutureTime(milliseconds) {
  const now = new Date();
  const future = new Date(now.getTime() + milliseconds);
  const dateStr = future.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = future.toLocaleTimeString('es-ES', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return { dateStr, timeStr };
}

async function sendNotification(message, balance) {
  const notificationUrl = process.env.NOTIFICATION;
  if (!notificationUrl) {
    console.log(`${getCurrentTimestamp()} ℹ️ Variable NOTIFICATION no definida. Omitiendo notificación.`);
    return;
  }
  console.log(`${getCurrentTimestamp()} 📢 Enviando notificación a: ${notificationUrl}`);
  return new Promise((resolve) => {
    const payload = { message, balance };
    const postData = JSON.stringify(payload);
    let url;
    try {
      url = new URL(notificationUrl);
    } catch (err) {
      console.error(`${getCurrentTimestamp()} ⚠️ Error al parsear URL de notificación: ${err.message}`);
      resolve();
      return;
    }
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const req = httpModule.request(options, (res) => {
      console.log(`${getCurrentTimestamp()} ✅ Notificación enviada. Código: ${res.statusCode}`);
      resolve();
    });
    req.on('error', (e) => {
      console.error(`${getCurrentTimestamp()} ⚠️ Error al enviar notificación: ${e.message}`);
      resolve();
    });
    req.write(postData);
    req.end();
  });
}

async function performLogin(page) {
  for (let attempt = 1; attempt < 4; ++attempt) {
    try {
      const email = process.env.EMAIL;
      const password = process.env.PASSWORD;
      console.log(`${getCurrentTimestamp()} ✍️ Escribiendo credenciales (intento ${attempt})...`);
      await page.type("#email", email, { delay: 50 });
      await page.type("#password", password, { delay: 50 });
      console.log(`${getCurrentTimestamp()} 🔑 Enviando login...`);
      await page.click(".sc-kLhKbu.dEXYZj.hg-login-with-email");
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 });
      return true;
    } catch (error) {
      if (attempt === 3) throw new Error(`Login fallido tras ${attempt} intentos.`);
      console.log(`${getCurrentTimestamp()} ⚠️ Intento ${attempt} fallido. Reintentando en 30 segundos...`);
      await new Promise((resolve) => setTimeout(resolve, 30000));
    }
  }
}

async function findBalanceContainer(page) {
  const baseSelector = '#root > div.sc-cSzYSJ.hZVuLe > div.sc-gEtfcr.jNBTJR > div > main > div > div > div:nth-child(NTH) > div > div > div > div';
  const possibleNths = [1, 2, 3, 4, 5];
  for (const n of possibleNths) {
    const selector = baseSelector.replace('NTH', n.toString());
    try {
      await page.waitForSelector(selector, { timeout: 5000 });
      const container = await page.$(selector);
      const text = await page.evaluate(el => el.textContent, container);
      if (text && text.toLowerCase().includes('current balance')) {
        console.log(`${getCurrentTimestamp()} ✅ Contenedor de balance encontrado con nth-child(${n}).`);
        return selector;
      }
    } catch (e) { /* continue */ }
  }
  console.log(`${getCurrentTimestamp()} ⚠️ No se encontró contenedor de balance.`);
  return null;
}

async function extractBalanceFromContainer(page, containerElement) {
  if (!containerElement) return null;
  try {
    const fullText = await page.evaluate(el => el.textContent, containerElement);
    const balanceLabelIndex = fullText.toLowerCase().indexOf('current balance');
    if (balanceLabelIndex === -1) return null;
    const textAfterLabel = fullText.substring(balanceLabelIndex + 'current balance'.length).trim();
    const match = textAfterLabel.match(/^\s*([\d.,]+\d)/);
    if (match && match[1]) {
      const val = match[1];
      if (val.includes(',') || val.includes('.') || parseInt(val.replace(/[,.]/g, ''), 10) > 999) {
        return val;
      }
    }
  } catch (e) {
    console.log(`${getCurrentTimestamp()} ⚠️ Error al extraer balance: ${e.message}`);
  }
  return null;
}

async function getBalanceSafely(page) {
  const sel = await findBalanceContainer(page);
  if (!sel) {
    console.log(`${getCurrentTimestamp()} ⚠️ No se pudo obtener el balance.`);
    return null;
  }
  const container = await page.$(sel);
  const balance = await extractBalanceFromContainer(page, container);
  if (balance) console.log(`${getCurrentTimestamp()} 💰 Balance actual: ${balance}`);
  return balance;
}
// ============================================================
// DETECTAR ESTADO DEL POT — solo elementos VISIBLES
// ============================================================
async function detectPotState(page) {
  console.log(`${getCurrentTimestamp()} 🔍 Detectando estado del Lucky Pot (solo elementos visibles)...`);

  const result = await page.evaluate(() => {
    function isVisible(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      return true;
    }

    // 1. Buscar countdown VISIBLE
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      if (!isVisible(el)) continue;
      const text = el.textContent || '';
      const lower = text.toLowerCase();
      if (lower.includes('next pot available in') || lower.includes('time left to collect')) {
        const timeMatch = text.match(/(\d+)\s*hours?\s*(\d+)\s*min\s*(\d+)\s*sec/i);
        if (timeMatch) {
          return {
            state: 'cooldown',
            hours: parseInt(timeMatch[1], 10),
            minutes: parseInt(timeMatch[2], 10),
            seconds: parseInt(timeMatch[3], 10),
            text: timeMatch[0]
          };
        }
      }
    }

    // 2. Buscar botón VISIBLE
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (!isVisible(btn)) continue;
      const text = btn.textContent?.trim().toLowerCase() || '';
      if (text.includes('open lucky pot') || text === 'claim') {
        return { state: 'claimable', buttonText: btn.textContent?.trim() };
      }
    }

    return { state: 'unknown' };
  });

  if (result.state === 'cooldown') {
    const totalMs = (result.hours * 3600 + result.minutes * 60 + result.seconds) * 1000;
    const waitTimeMs = totalMs + 300000;
    const { dateStr, timeStr } = getFutureTime(waitTimeMs);
    console.log(`${getCurrentTimestamp()} ⏰ Countdown visible: ${result.text}`);
    console.log(`${getCurrentTimestamp()} ⏰ Próximo intento: ${dateStr} a las ${timeStr} (+5 min margen)`);
    return { state: 'cooldown', waitTimeMs };
  }

  if (result.state === 'claimable') {
    console.log(`${getCurrentTimestamp()} ✅ Pot disponible. Botón visible: "${result.buttonText}"`);
    return { state: 'claimable' };
  }

  console.log(`${getCurrentTimestamp()} ⚠️ Estado desconocido (ni botón ni countdown visibles).`);
  return { state: 'unknown' };
}

// ============================================================
// LEER COUNTDOWN DEL DOM tras claim exitoso
// ============================================================
async function readCountdownFromDOM(page) {
  console.log(`${getCurrentTimestamp()} 🔍 Leyendo countdown del DOM tras reclamo...`);

  const result = await page.evaluate(() => {
    function isVisible(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      return true;
    }
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      if (!isVisible(el)) continue;
      const text = el.textContent || '';
      const lower = text.toLowerCase();
      if (lower.includes('next pot available in') || lower.includes('time left to collect')) {
        const timeMatch = text.match(/(\d+)\s*hours?\s*(\d+)\s*min\s*(\d+)\s*sec/i);
        if (timeMatch) {
          return {
            found: true,
            hours: parseInt(timeMatch[1], 10),
            minutes: parseInt(timeMatch[2], 10),
            seconds: parseInt(timeMatch[3], 10),
            text: timeMatch[0]
          };
        }
      }
    }
    return { found: false };
  });

  if (result.found) {
    const totalMs = (result.hours * 3600 + result.minutes * 60 + result.seconds) * 1000;
    const waitTimeMs = totalMs + 300000;
    const { dateStr, timeStr } = getFutureTime(waitTimeMs);
    console.log(`${getCurrentTimestamp()} ⏰ Countdown leído: ${result.text}`);
    console.log(`${getCurrentTimestamp()} ⏰ Próxima ejecución: ${dateStr} a las ${timeStr} (+5 min margen)`);
    return waitTimeMs;
  }

  console.log(`${getCurrentTimestamp()} ⚠️ No se encontró countdown visible tras reclamo. Usando fallback 24h.`);
  return 24 * 60 * 60 * 1000;
}

// ============================================================
// CLAIM: click, espera confirmación, verifica balance
// ============================================================
async function claimPot(page, balanceAtStart) {
  console.log(`${getCurrentTimestamp()} 👆 Reclamando Lucky Pot...`);

  const clicked = await page.evaluate(() => {
    function isVisible(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      return true;
    }
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (!isVisible(btn)) continue;
      const text = btn.textContent?.trim().toLowerCase() || '';
      if (text.includes('open lucky pot') || text === 'claim') {
        btn.click();
        return true;
      }
    }
    return false;
  });

  if (!clicked) {
    console.log(`${getCurrentTimestamp()} ⚠️ No se pudo hacer click en el botón de claim.`);
    return { success: false };
  }

  console.log(`${getCurrentTimestamp()} ⏳ Esperando confirmación del reclamo...`);
  await page.waitForTimeout(5000);

  // Verificar si aparece "Congratulations" en el modal
  const confirmed = await page.evaluate(() => {
    const body = document.body.textContent?.toLowerCase() || '';
    return body.includes('congratulations') || body.includes('credits added');
  });

  if (confirmed) {
    console.log(`${getCurrentTimestamp()} 🎉 Confirmación detectada en el modal.`);
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent?.trim().toLowerCase() === 'ok') {
          btn.click();
          return;
        }
      }
    });
    await page.waitForTimeout(3000);
  } else {
    console.log(`${getCurrentTimestamp()} ⚠️ No se detectó confirmación en el modal. Continuando...`);
  }

  await page.waitForTimeout(3000);

  const balanceAfter = await getBalanceSafely(page);
  if (!balanceAfter) {
    console.log(`${getCurrentTimestamp()} ⚠️ No se pudo leer el balance después del reclamo.`);
    return { success: false };
  }

  const before = parseFloat(balanceAtStart.replace(/,/g, ''));
  const after = parseFloat(balanceAfter.replace(/,/g, ''));
  const diff = (after - before).toFixed(2);
  console.log(`${getCurrentTimestamp()} 📊 Antes: ${balanceAtStart} | Después: ${balanceAfter} | Diferencia: +${diff}`);

  if (after > before) {
    console.log(`${getCurrentTimestamp()} 🎉 ÉXITO: Premio reclamado. +${diff} créditos.`);
    await sendNotification(`Premio Honeygain reclamado. +${diff} créditos.`, balanceAfter);
    return { success: true, balanceAfter };
  } else {
    console.log(`${getCurrentTimestamp()} ⚠️ El balance no aumentó tras el reclamo.`);
    return { success: false };
  }
}
// ============================================================
// LOGIN + NAVEGACIÓN AL DASHBOARD
// ============================================================
async function launchAndLogin() {
  const browser = await puppeteer.launch({
    headless: 'old',
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-translate",
      "--disable-sync",
      "--no-first-run",
      "--mute-audio",
      "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
    ]
  });
  const page = await browser.newPage();
  await page.goto("https://dashboard.honeygain.com/login", { waitUntil: "networkidle2", timeout: 60000 });
  try {
    await page.waitForSelector(".sc-kLhKbu.cRDTkV", { timeout: 10000 });
    await page.click(".sc-kLhKbu.cRDTkV");
  } catch (e) {}
  await page.waitForSelector('#email', { timeout: 15000 });
  await page.waitForSelector('#password', { timeout: 15000 });
  if (!(await performLogin(page))) throw new Error("Login fallido");
  return { browser, page };
}

// ============================================================
// CICLO PRINCIPAL
// ============================================================
async function runCycle() {
  let browser = null;
  let page = null;

  try {
    console.log(`${getCurrentTimestamp()} 🚀 Iniciando ciclo...`);

    if (!process.env.EMAIL || !process.env.PASSWORD) {
      throw new Error("Variables EMAIL y PASSWORD requeridas.");
    }

    ({ browser, page } = await launchAndLogin());

    // 1. BALANCE INICIAL
    console.log(`${getCurrentTimestamp()} 🔍 Obteniendo balance inicial...`);
    const balanceAtStart = await getBalanceSafely(page);
    if (!balanceAtStart) throw new Error("No se pudo obtener el balance inicial.");

    // 2. DETECTAR ESTADO (solo elementos visibles)
    const potState = await detectPotState(page);

    // 3. COOLDOWN → cerrar y programar
    if (potState.state === 'cooldown') {
      console.log(`${getCurrentTimestamp()} 🕒 Pot en cooldown. Cerrando sesión.`);
      await browser.close();
      setTimeout(runCycle, potState.waitTimeMs);
      return;
    }

    // 4. DISPONIBLE → reclamar
    if (potState.state === 'claimable') {
      const claimResult = await claimPot(page, balanceAtStart);

      if (claimResult.success) {
        // Leer countdown del mismo DOM, sin segundo login
        const waitTimeMs = await readCountdownFromDOM(page);
        await browser.close();
        const { dateStr, timeStr } = getFutureTime(waitTimeMs);
        console.log(`${getCurrentTimestamp()} ⏰ Próxima ejecución: ${dateStr} a las ${timeStr}`);
        setTimeout(runCycle, waitTimeMs);
        return;
      }

      // Reclamo sin éxito
      console.log(`${getCurrentTimestamp()} ⚠️ Reclamo sin éxito. Reintentando en 5 minutos...`);
      await browser.close();
      setTimeout(runCycle, 5 * 60 * 1000);
      return;
    }

    // 5. ESTADO DESCONOCIDO → esperar 1h
    console.log(`${getCurrentTimestamp()} ⚠️ Estado desconocido. Esperando 1 hora.`);
    await browser.close();
    setTimeout(runCycle, 60 * 60 * 1000);

  } catch (err) {
    console.error(`${getCurrentTimestamp()} ⚠️ Error en ciclo principal: ${err.message}`);
    if (browser) { try { await browser.close(); } catch (e) {} }
    console.log(`${getCurrentTimestamp()} 🔄 Reintentando en 60 segundos...`);
    setTimeout(runCycle, 60000);
  }
}

// Iniciar
runCycle();

process.on('SIGINT', () => {
  console.log(`${getCurrentTimestamp()} \n🛑 Cerrando...`);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(`${getCurrentTimestamp()} \n🛑 Cerrando...`);
  process.exit(0);
});
