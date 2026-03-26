// bot.js - Versión v1.7.0
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
  const dateStr = future.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
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
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
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
  if (!sel) { console.log(`${getCurrentTimestamp()} ⚠️ No se pudo obtener el balance.`); return null; }
  const container = await page.$(sel);
  const balance = await extractBalanceFromContainer(page, container);
  if (balance) console.log(`${getCurrentTimestamp()} 💰 Balance actual: ${balance}`);
  return balance;
}

// ============================================================
// NUEVA LÓGICA CENTRAL: detecta estado del pot en el modal
// Retorna: { state: 'claimable' | 'cooldown' | 'unknown', waitTimeMs? }
// ============================================================
async function detectPotState(page) {
  console.log(`${getCurrentTimestamp()} 🔍 Detectando estado del Lucky Pot...`);

  // Buscar countdown directamente en el DOM (puede estar visible sin abrir modal)
  const countdownResult = await page.evaluate(() => {
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      const text = el.textContent || '';
      const lower = text.toLowerCase();
      if (lower.includes('next pot available in') || lower.includes('time left to collect')) {
        const timeMatch = text.match(/(\d+)\s*hours?\s*(\d+)\s*min\s*(\d+)\s*sec/i);
        if (timeMatch) {
          return {
            found: true,
            text: timeMatch[0],
            hours: parseInt(timeMatch[1], 10),
            minutes: parseInt(timeMatch[2], 10),
            seconds: parseInt(timeMatch[3], 10)
          };
        }
      }
    }
    return { found: false };
  });

  if (countdownResult.found) {
    const totalMs = (countdownResult.hours * 3600 + countdownResult.minutes * 60 + countdownResult.seconds) * 1000;
    if (totalMs > 0) {
      const waitTimeMs = totalMs + 300000; // +5 minutos de margen
      const { dateStr, timeStr } = getFutureTime(waitTimeMs);
      console.log(`${getCurrentTimestamp()} ⏰ Countdown detectado: ${countdownResult.text}`);
      console.log(`${getCurrentTimestamp()} ⏰ Próximo intento: ${dateStr} a las ${timeStr} (+5 min margen)`);
      return { state: 'cooldown', waitTimeMs };
    }
  }

  // Buscar botón "Open Lucky Pot" o "Claim"
  const buttonResult = await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent?.trim().toLowerCase() || '';
      if (text.includes('open lucky pot') || text === 'claim') {
        return { found: true, text: btn.textContent?.trim() };
      }
    }
    return { found: false };
  });

  if (buttonResult.found) {
    console.log(`${getCurrentTimestamp()} ✅ Pot disponible para reclamar. Botón: "${buttonResult.text}"`);
    return { state: 'claimable' };
  }

  console.log(`${getCurrentTimestamp()} ⚠️ Estado del pot desconocido (ni botón ni countdown).`);
  return { state: 'unknown' };
}

// ============================================================
// CLAIM: click en el botón, espera confirmación, verifica balance
// ============================================================
async function claimPot(page, balanceAtStart) {
  console.log(`${getCurrentTimestamp()} 👆 Reclamando Lucky Pot...`);

  // Click en el botón de claim
  const clicked = await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
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
    return false;
  }

  // Esperar la animación y confirmación (modal de "Congratulations")
  console.log(`${getCurrentTimestamp()} ⏳ Esperando confirmación del reclamo...`);
  await page.waitForTimeout(5000);

  // Buscar el texto de confirmación en el modal
  const confirmed = await page.evaluate(() => {
    const body = document.body.textContent?.toLowerCase() || '';
    return body.includes('congratulations') || body.includes('credits added');
  });

  if (confirmed) {
    console.log(`${getCurrentTimestamp()} 🎉 Confirmación de reclamo detectada en el modal.`);
    // Click en OK para cerrar el modal
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
    console.log(`${getCurrentTimestamp()} ⚠️ No se detectó confirmación en el modal. Continuando de todas formas...`);
  }

  // Recargar para obtener el balance actualizado
  await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
  await page.waitForTimeout(5000);

  const balanceAfter = await getBalanceSafely(page);
  if (!balanceAfter) {
    console.log(`${getCurrentTimestamp()} ⚠️ No se pudo leer el balance después del reclamo.`);
    return false;
  }

  const before = parseFloat(balanceAtStart.replace(/,/g, ''));
  const after = parseFloat(balanceAfter.replace(/,/g, ''));
  const diff = (after - before).toFixed(2);
  console.log(`${getCurrentTimestamp()} 📊 Balance antes: ${balanceAtStart} | después: ${balanceAfter} | diferencia: +${diff}`);

  if (after > before) {
    console.log(`${getCurrentTimestamp()} 🎉 ÉXITO: Premio reclamado. +${diff} créditos.`);
    await sendNotification(`Premio Honeygain reclamado. +${diff} créditos.`, balanceAfter);
    return true;
  } else {
    console.log(`${getCurrentTimestamp()} ⚠️ El balance no aumentó tras el reclamo.`);
    return false;
  }
}

// ============================================================
// Función de login + detección de estado (reutilizable)
// ============================================================
async function launchAndDetect() {
  let browser = null;
  let page = null;
  try {
    browser = await puppeteer.launch({
      headless: 'old',
      args: [
        "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
      ]
    });
    page = await browser.newPage();
    await page.goto("https://dashboard.honeygain.com/login", { waitUntil: "networkidle2", timeout: 60000 });
    try {
      await page.waitForSelector(".sc-kLhKbu.cRDTkV", { timeout: 10000 });
      await page.click(".sc-kLhKbu.cRDTkV");
    } catch (e) {}
    await page.waitForSelector('#email', { timeout: 15000 });
    await page.waitForSelector('#password', { timeout: 15000 });
    if (!(await performLogin(page))) throw new Error("Login fallido");
    return { browser, page };
  } catch (err) {
    if (browser) { try { await browser.close(); } catch (e) {} }
    throw err;
  }
}

// ============================================================
// CICLO PRINCIPAL
// ============================================================
async function runCycle() {
  let browser = null;
  let page = null;

  try {
    console.log(`${getCurrentTimestamp()} 🚀 Iniciando ciclo...`);

    const email = process.env.EMAIL;
    const password = process.env.PASSWORD;
    if (!email || !password) throw new Error("Variables EMAIL y PASSWORD requeridas.");

    ({ browser, page } = await launchAndDetect());

    // --- 1. LEER BALANCE INICIAL ---
    console.log(`${getCurrentTimestamp()} 🔍 Obteniendo balance inicial...`);
    const balanceAtStart = await getBalanceSafely(page);
    if (!balanceAtStart) throw new Error("No se pudo obtener el balance inicial.");

    // --- 2. DETECTAR ESTADO DEL POT (primer paso, siempre) ---
    const potState = await detectPotState(page);

    // --- 3. SI HAY COUNTDOWN → salir inmediatamente y programar ---
    if (potState.state === 'cooldown') {
      console.log(`${getCurrentTimestamp()} 🕒 Pot en cooldown. No se intenta reclamar.`);
      if (browser) await browser.close();
      setTimeout(runCycle, potState.waitTimeMs);
      return;
    }

    // --- 4. SI ES RECLAMABLE → reclamar ---
    if (potState.state === 'claimable') {
      const success = await claimPot(page, balanceAtStart);

      if (success) {
        // Tras éxito, reabrir sesión para leer el countdown real
        if (browser) await browser.close();
        console.log(`${getCurrentTimestamp()} 🔍 Leyendo countdown tras reclamo exitoso...`);
        let waitTimeMs = 24 * 60 * 60 * 1000; // fallback: 24h
        try {
          ({ browser, page } = await launchAndDetect());
          const afterState = await detectPotState(page);
          if (afterState.state === 'cooldown') {
            waitTimeMs = afterState.waitTimeMs;
          }
          if (browser) await browser.close();
        } catch (e) {
          console.log(`${getCurrentTimestamp()} ⚠️ No se pudo leer countdown tras reclamo. Usando fallback 24h.`);
          if (browser) { try { await browser.close(); } catch (e2) {} }
        }
        const { dateStr, timeStr } = getFutureTime(waitTimeMs);
        console.log(`${getCurrentTimestamp()} ⏰ Próxima ejecución: ${dateStr} a las ${timeStr}`);
        setTimeout(runCycle, waitTimeMs);
        return;
      }

      // Reclamo fallido (balance no aumentó)
      console.log(`${getCurrentTimestamp()} ⚠️ Reclamo sin éxito. Esperando 5 minutos y reintentando...`);
      if (browser) await browser.close();
      setTimeout(runCycle, 5 * 60 * 1000);
      return;
    }

    // --- 5. ESTADO DESCONOCIDO → esperar 1h ---
    console.log(`${getCurrentTimestamp()} ⚠️ Estado desconocido. Esperando 1 hora antes de reintentar.`);
    if (browser) await browser.close();
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
