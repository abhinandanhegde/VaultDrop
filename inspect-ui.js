const { chromium } = require('playwright');
const path = require('path');

const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');

async function main() {
  const fs = require('fs');
  if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  
  const viewports = [
    { name: 'desktop-1920', width: 1920, height: 1080 },
    { name: 'desktop-1440', width: 1440, height: 900 },
    { name: 'desktop-1280', width: 1280, height: 800 },
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'mobile-390', width: 390, height: 844 },
  ];

  const pages_to_check = [
    { url: 'http://localhost:3000/', name: 'home' },
    { url: 'http://localhost:3000/how-it-works', name: 'how-it-works' },
  ];

  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      colorScheme: 'dark',
    });
    const page = await context.newPage();
    
    for (const pg of pages_to_check) {
      await page.goto(pg.url, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(1500);
      
      // Full page screenshot
      const filePath = path.join(SCREENSHOTS_DIR, `${pg.name}-${vp.name}.png`);
      await page.screenshot({ path: filePath, fullPage: true });
      console.log(`Saved: ${filePath}`);

      // Also take a viewport-only screenshot
      const vpPath = path.join(SCREENSHOTS_DIR, `${pg.name}-${vp.name}-viewport.png`);
      await page.screenshot({ path: vpPath, fullPage: false });
      console.log(`Saved viewport: ${vpPath}`);
    }
    
    await context.close();
  }

  await browser.close();
  console.log('All screenshots captured.');
}

main().catch(console.error);
