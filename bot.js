// bot.js - Versión v1.9.0
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
  const dateStr = future.toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
  const timeStr = future.toLocaleTimeString('es-ES', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
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
// ABRIR MODAL DEL POT
// ============================================================
async function openPotModal(page) {
  console.log(`${getCurrentTimestamp()} 🍯 Abriendo modal del Lucky Pot...`);
  // El ícono del tarro está en la navbar superior
  const potIconSelector = 'a[href*="lucky"], button[class*="lucky"], div[class*="lucky-pot"]';
  try {
    await page.waitForSelector(potIconSelector, { timeout: 5000 });
    await page.click(potIconSelector);
  } catch (e) {
    // Fallback: buscar por posición conocida del ícono en el navbar
    console.log(`${getCurrentTimestamp()} ℹ️ Selector del ícono no encontrado, usando click por evaluación...`);
    await page.evaluate(() => {
      const links = document.querySelectorAll('a, button');
      for (const el of links) {
        const href = el.getAttribute('href') || '';
        const cls = el.className || '';
        if (href.includes('lucky') || cls.includes('lucky') || cls.includes('pot')) {
          el.click();
          return;
        }
      }
    });
  }
  // Esperar a que el modal aparezca
  await page.waitForTimeout(2000);
}

// ============================================================
// DETECTAR ESTADO DEL MODAL (abierto)
// Retorna: { state: 'claimable' | 'cooldown' | 'unknown', waitTimeMs? }
// ============================================================
async function detectModalState(page) {
  console.log(`${getCurrentTimestamp()} 🔍 Leyendo estado del modal del Lucky Pot...`);

  // Intentar encontrar el botón "Open Lucky Pot" dentro del modal
  const claimBtnSelector = 'button';
  try {
    await page.waitForSelector(claimBtnSelector, { timeout: 5000 });
  } catch (e) { /* continuar */ }

  const result = await page.evaluate(() => {
    // Buscar botón "Open Lucky Pot" o "Claim" visible
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const rect = btn.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = window.getComputedStyle(btn);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const text = btn.textContent?.trim().toLowerCase() || '';
      if (text.includes('open lucky pot') || text === 'claim') {
        return { state: 'claimable', buttonText: btn.textContent?.trim() };
      }
    }

    // Buscar countdown dentro del modal
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
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

    return { state: 'unknown' };
  });

  if (result.state === 'claimable') {
    console.log(`${getCurrentTimestamp()} ✅ Modal muestra pot disponible. Botón: "${result.buttonText}"`);
    return { state: 'claimable' };
  }

  if (result.state === 'cooldown') {
    const totalMs = (result.hours * 3600 + result.minutes * 60 + result.seconds) * 1000;
    const waitTimeMs = totalMs + 300000; // +5 min margen
    const { dateStr, timeStr } = getFutureTime(waitTimeMs);
    console.log(`${getCurrentTimestamp()} ⏰ Modal muestra countdown: ${result.text}`);
    console.log(`${getCurrentTimestamp()} ⏰ Próximo intento: ${dateStr} a las ${timeStr} (+5 min margen)`);
    return { state: 'cooldown', waitTimeMs };
  }

  console.log(`${getCurrentTimestamp()} ⚠️ Estado del modal desconocido.`);
  return { state: 'unknown' };
}

// ============================================================
// CLAIM: click real con page.click(), espera animación y OK
// ============================================================
async function claimPot(page, balanceAtStart) {
  console.log(`${getCurrentTimestamp()} 👆 Haciendo click en "Open Lucky Pot"...`);

  // Encontrar el selector del botón y hacer click real
  const claimButtonSelector = await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const rect = btn.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = window.getComputedStyle(btn);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const text = btn.textContent?.trim().toLowerCase() || '';
      if (text.includes('open lucky pot') || text === 'claim') {
        // Añadir un atributo temporal para identificarlo
        btn.setAttribute('data-honeygain-claim', 'true');
        return true;
      }
    }
    return false;
  });

  if (!claimButtonSelector) {
    console.log(`${getCurrentTimestamp()} ⚠️ No se encontró el botón de claim.`);
    return { success: false };
  }

  // Click real con page.click() usando el atributo temporal
  await page.click('button[data-honeygain-claim="true"]');
  console.log(`${getCurrentTimestamp()} ⏳ Esperando animación (~7 segundos)...`);
  await page.waitForTimeout(7000);

  // Verificar "Congratulations" en el modal
  const congratsVisible = await page.evaluate(() => {
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const text = el.textContent?.toLowerCase() || '';
      if (text.includes('congratulations') || text.includes('credits added')) return true;
    }
    return false;
  });

  if (congratsVisible) {
    console.log(`${getCurrentTimestamp()} 🎉 "Congratulations" detectado en el modal.`);
    // Click real en OK
    const okClicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const rect = btn.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const text = btn.textContent?.trim().toLowerCase() || '';
        if (text === 'ok') {
          btn.setAttribute('data-honeygain-ok', 'true');
          return true;
        }
      }
      return false;
    });
    if (okClicked) {
      await page.click('button[data-honeygain-ok="true"]');
      console.log(`${getCurrentTimestamp()} ✅ Click en OK.`);
      await page.waitForTimeout(3000);
    }
  } else {
    console.log(`${getCurrentTimestamp()} ⚠️ "Congratulations" no detectado. Continuando de todas formas...`);
    await page.waitForTimeout(3000);
  }

  // Leer balance actualizado
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
    return { success: true };
  } else {
    console.log(`${getCurrentTimestamp()} ⚠️ El balance no aumentó.`);
    return { success: false };
  }
}

// ============================================================
// LEER COUNTDOWN ABRIENDO EL MODAL
// ============================================================
async function readCountdownFromModal(page) {
  console.log(`${getCurrentTimestamp()} 🔍 Leyendo countdown desde el modal...`);
  await openPotModal(page);
  const state = await detectModalState(page);
  // Cerrar modal con Escape
  try { await page.keyboard.press('Escape'); } catch (e) {}
  if (state.state === 'cooldown') return state.waitTimeMs;
  console.log(`${getCurrentTimestamp()} ⚠️ No se encontró countdown en el modal. Usando fallback 24h.`);
  return 24 * 60 * 60 * 1000;
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

    // 2. ABRIR MODAL Y DETECTAR ESTADO
    await openPotModal(page);
    const modalState = await detectModalState(page);

    // 3. COOLDOWN → cerrar modal, cerrar sesión y programar
    if (modalState.state === 'cooldown') {
      console.log(`${getCurrentTimestamp()} 🕒 Pot en cooldown. Cerrando sesión.`);
      try { await page.keyboard.press('Escape'); } catch (e) {}
      await browser.close();
      setTimeout(runCycle, modalState.waitTimeMs);
      return;
    }

    // 4. DISPONIBLE → reclamar
    if (modalState.state === 'claimable') {
      const claimResult = await claimPot(page, balanceAtStart);

      if (claimResult.success) {
        // Leer countdown abriendo el modal de nuevo
        const waitTimeMs = await readCountdownFromModal(page);
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
    try { await page.keyboard.press('Escape'); } catch (e) {}
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
