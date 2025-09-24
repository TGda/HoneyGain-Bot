// bot.js
const puppeteer = require("puppeteer");

// Función para obtener la hora actual formateada
function getCurrentTime() {
  const now = new Date();
  return now.toLocaleTimeString('es-ES', { 
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// Función para extraer segundos del texto del temporizador
function parseCountdownText(countdownText) {
  // Ejemplo: "06 hours 23 min 28 sec" -> { hours: 6, minutes: 23, seconds: 28 }
  const regex = /(\d+) hours (\d+) min (\d+) sec/;
  const match = countdownText.match(regex);
  
  if (match && match.length === 4) {
    return {
      hours: parseInt(match[1], 10),
      minutes: parseInt(match[2], 10),
      seconds: parseInt(match[3], 10)
    };
  }
  
  // Si no coincide el formato, asumir 0 segundos para evitar errores
  console.warn(`⚠️ No se pudo parsear el texto del temporizador: "${countdownText}". Usando 0 segundos.`);
  return { hours: 0, minutes: 0, seconds: 0 };
}

// Función para convertir tiempo a milisegundos
function timeToMilliseconds(timeObj) {
  return (timeObj.hours * 3600 + timeObj.minutes * 60 + timeObj.seconds) * 1000;
}

// Función para calcular la hora futura
function getFutureTime(milliseconds) {
  const now = new Date();
  const future = new Date(now.getTime() + milliseconds);
  return future.toLocaleTimeString('es-ES', { 
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

let browser;
let page;
let isFirstRun = true;

// Función para login con reintentos
async function login() {
  for (let attempt = 1; attempt < 4; ++attempt) {
    try {
      const email = process.env.HONEYGAIN_EMAIL;
      const password = process.env.HONEYGAIN_PASSWORD;

      console.log(`✍️ Escribiendo credenciales (intento ${attempt})...`);
      await page.type("#email", email, { delay: 50 });
      await page.type("#password", password, { delay: 50 });

      console.log("🔑 Enviando login...");
      await page.click(".sc-kLhKbu.dEXYZj.hg-login-with-email");
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 });
      return true;
    } catch (error) {
      if (attempt === 3) {
        throw new Error(`Silently attempt to log in ${attempt} times failed.`);
      }
      console.log(`⚠️ Intento ${attempt} fallido. Reintentando en 30 segundos...`);
      await new Promise((resolve) => setTimeout(resolve, 30000));
    }
  }
}

// Función principal del ciclo
async function runCycle() {
  try {
    if (isFirstRun) {
      console.log("🚀 Iniciando bot de Honeygain...");
      browser = await puppeteer.launch({
        headless: "new",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-background-networking",
          "--disable-translate",
          "--disable-sync",
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-breakpad",
          "--disable-component-extensions-with-background-pages",
          "--metrics-recording-only",
          "--mute-audio",
          "--no-first-run",
          "--no-zygote"
        ],
      });

      page = await browser.newPage();
      
      console.log("🌐 Abriendo página de login...");
      const response = await page.goto("https://dashboard.honeygain.com/login", {
        waitUntil: "networkidle2",
        timeout: 60000,
      });
      console.log(`   Estado de carga: ${response.status()}`);

      // Verificar si hay mensaje de JavaScript no soportado
      const content = await page.content();
      if (content.includes("Your browser does not support JavaScript!")) {
        console.log("⚠️ La página indica que el navegador no soporta JavaScript. Esto puede ser un problema para la automatización.");
      }

      // Esperar y hacer clic en el botón inicial si aparece
      console.log("🔍 Esperando botón inicial...");
      try {
        await page.waitForSelector(".sc-kLhKbu.cRDTkV", { timeout: 10000 });
        console.log("👆 Haciendo clic en botón inicial...");
        await page.click(".sc-kLhKbu.cRDTkV");
      } catch (e) {
        console.log("ℹ️ No se encontró botón inicial, continuando...");
      }

      // Esperar a que los campos de entrada estén disponibles
      console.log("🔍 Esperando campos de login...");
      await page.waitForSelector('#email', { timeout: 15000 });
      await page.waitForSelector('#password', { timeout: 15000 });

      const email = process.env.HONEYGAIN_EMAIL;
      const password = process.env.HONEYGAIN_PASSWORD;

      if (!email || !password) {
        throw new Error("❌ Variables de entorno HONEYGAIN_EMAIL y HONEYGAIN_PASSWORD requeridas.");
      }

      // Realizar login
      if (await login()) {
        console.log("✅ Login exitoso. Redirigido a dashboard.");
        
        // Verificar que estamos en el dashboard
        const currentUrl = page.url();
        console.log(`📍 URL después del login: ${currentUrl}`);
        
        if (!currentUrl.includes("dashboard.honeygain.com/")) {
          throw new Error("No se pudo acceder al dashboard después del login");
        }
      } else {
        throw new Error("No se pudo realizar el login");
      }

      isFirstRun = false;
    } else {
      // En ciclos posteriores, solo refrescamos la página
      console.log("🔄 Refrescando dashboard...");
      await page.reload({ waitUntil: "networkidle2", timeout: 60000 });
      await page.waitForTimeout(3000);
    }

    // Obtener balance actual con hora
    console.log("🔍 Obteniendo balance actual...");
    // Usar el nuevo selector del balance que proporcionaste
    await page.waitForSelector('#root > div.sc-cSzYSJ.hZVuLe > div.sc-jwpOCX.cDWKqV > div > main > div > div > div:nth-child(1) > div > div > div > div > div.sc-blHHSb.sc-gnElHG.hJDEkH.XGcis', { timeout: 15000 });
    
    // Extraer el texto completo y luego obtener solo el balance numérico
    const balanceContainer = await page.$('#root > div.sc-cSzYSJ.hZVuLe > div.sc-jwpOCX.cDWKqV > div > main > div > div > div:nth-child(1) > div > div > div > div > div.sc-blHHSb.sc-gnElHG.hJDEkH.XGcis');
    const balanceText = await page.evaluate(element => element.textContent, balanceContainer);
    
    // Extraer solo el valor numérico del balance (asumiendo que está después de "Current Balance")
    const balanceMatch = balanceText.match(/Current Balance\s*([\d,.]+)/i);
    let balance = "0";
    if (balanceMatch && balanceMatch[1]) {
      balance = balanceMatch[1];
    }
    
    const currentTime = getCurrentTime();
    console.log(`💰 Balance actual a las ${currentTime} : ${balance}`);

    // Verificar si aparece el conteo regresivo o el botón de reclamar
    console.log("🔍 Verificando si hay conteo regresivo o botón de reclamar...");
    
    // Primero intentamos encontrar el conteo regresivo con el nuevo selector
    try {
      const countdownSelector = "#root > div.sc-cSzYSJ.hZVuLe > div.sc-jwpOCX.cDWKqV > div > main > div > div > div:nth-child(4) > div > div > div > div.sc-fAUdSK.fFFaNF > div > div > div";
      await page.waitForSelector(countdownSelector, { timeout: 5000 });
      const countdownText = await page.$eval(countdownSelector, el => el.textContent);
      
      // Extraer solo la parte del tiempo (eliminar "Next pot available in")
      const timePart = countdownText.replace(/Next pot available in/i, '').trim();
      console.log(`⏳ Conteo regresivo encontrado: ${timePart}`);
      
      // Parsear el tiempo y calcular espera
      const timeObj = parseCountdownText(timePart);
      const waitTimeMs = timeToMilliseconds(timeObj) + 20000; // +20 segundos
      
      // Programar el próximo ciclo
      const futureTime = getFutureTime(waitTimeMs);
      const minutes = (waitTimeMs / 1000 / 60).toFixed(2);
      console.log(`⏰ Próximo intento a las ${futureTime} que son aproximadamente en ${minutes} minutos...`);
      
      // Esperar el tiempo calculado antes de repetir
      setTimeout(runCycle, waitTimeMs);
      
    } catch (countdownError) {
      // Si no hay conteo regresivo, verificar si hay botón de reclamar
      console.log("ℹ️ No se encontró conteo regresivo. Verificando si hay botón de reclamar...");
      
      try {
        // Usar el selector del botón de reclamar que proporcionaste
        const claimButtonSelector = "#root > div.sc-cSzYSJ.hZVuLe > div.sc-jwpOCX.cDWKqV > div > main > div > div > div:nth-child(4) > div > div > div > div.sc-fAUdSK.fFFaNF > div > div > button > span > div > span";
        await page.waitForSelector(claimButtonSelector, { timeout: 5000 });
        console.log("✅ Botón de reclamar encontrado. Haciendo clic para reclamar el premio...");
        
        // Hacer clic en el botón de reclamar
        await page.click(claimButtonSelector);
        
        // Esperar un momento después de reclamar
        console.log("⏳ Esperando después de reclamar el premio...");
        await page.waitForTimeout(5000);
        
        // Refrescar la página para obtener el balance actualizado
        console.log("🔄 Refrescando página para obtener balance actualizado...");
        await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
        await page.waitForTimeout(3000);
        
        // Verificar el nuevo balance
        console.log("🔍 Verificando nuevo balance...");
        await page.waitForSelector('#root > div.sc-cSzYSJ.hZVuLe > div.sc-jwpOCX.cDWKqV > div > main > div > div > div:nth-child(1) > div > div > div > div > div.sc-blHHSb.sc-gnElHG.hJDEkH.XGcis', { timeout: 15000 });
        
        // Extraer el nuevo balance
        const newBalanceContainer = await page.$('#root > div.sc-cSzYSJ.hZVuLe > div.sc-jwpOCX.cDWKqV > div > main > div > div > div:nth-child(1) > div > div > div > div > div.sc-blHHSb.sc-gnElHG.hJDEkH.XGcis');
        const newBalanceText = await page.evaluate(element => element.textContent, newBalanceContainer);
        
        const newBalanceMatch = newBalanceText.match(/Current Balance\s*([\d,.]+)/i);
        let newBalance = "0";
        if (newBalanceMatch && newBalanceMatch[1]) {
          newBalance = newBalanceMatch[1];
        }
        
        const newTime = getCurrentTime();
        if (newBalance !== balance) {
          console.log(`🎉 Balance incrementado a las ${newTime} : ${balance} → ${newBalance}`);
        } else {
          console.log(`ℹ️ Balance sin cambios a las ${newTime} : ${balance} → ${newBalance}`);
        }
        
        // Esperar 5 minutos antes del próximo intento
        console.log("⏰ Próximo intento en 5 minutos...");
        setTimeout(runCycle, 300000); // 5 minutos
        
      } catch (claimButtonError) {
        console.log("⚠️ No se encontró ni conteo regresivo ni botón de reclamar. Reintentando en 5 minutos...");
        setTimeout(runCycle, 300000); // 5 minutos
      }
    }

  } catch (err) {
    console.error("⚠️ Error en el ciclo:", err.message);
    
    // Intentar reconectar en caso de error
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        console.error("⚠️ Error al cerrar el navegador:", closeErr.message);
      }
    }
    
    // Reiniciar después de 60 segundos
    console.log("🔄 Intentando reconectar en 60 segundos...");
    setTimeout(() => {
      isFirstRun = true; // Forzar relogin
      runCycle();
    }, 60000);
  }
}

// Iniciar el primer ciclo
runCycle();

// Manejar señales de cierre limpiamente
process.on('SIGINT', async () => {
  console.log("\n🛑 Recibida señal de interrupción. Cerrando...");
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log("\n🛑 Recibida señal de terminación. Cerrando...");
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});
