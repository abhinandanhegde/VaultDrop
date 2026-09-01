const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const RESULTS = [];

function log(msg) {
  console.log(msg);
  RESULTS.push(msg);
}

async function inspectPage(page, label) {
  log(`\n${'='.repeat(80)}`);
  log(`INSPECTING: ${label}`);
  log(`${'='.repeat(80)}`);

  // Get viewport dimensions
  const vp = page.viewportSize();
  log(`Viewport: ${vp.width}x${vp.height}`);

  // 1. Body/page background
  const bodyBg = await page.evaluate(() => {
    const body = document.body;
    const cs = getComputedStyle(body);
    return { bg: cs.backgroundColor, color: cs.color, font: cs.fontFamily, fontSize: cs.fontSize };
  });
  log(`\nBody: bg=${bodyBg.bg} color=${bodyBg.color} font=${bodyBg.font} size=${bodyBg.fontSize}`);

  // 2. Hero section
  const hero = await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    if (!h1) return null;
    const cs = getComputedStyle(h1);
    const rect = h1.getBoundingClientRect();
    return {
      text: h1.textContent.trim(),
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      color: cs.color,
      top: rect.top,
      width: rect.width,
      centerX: rect.left + rect.width / 2,
    };
  });
  log(`\nH1: "${hero?.text}"`);
  log(`  fontSize=${hero?.fontSize} weight=${hero?.fontWeight} color=${hero?.color}`);
  log(`  position: top=${hero?.top?.toFixed(0)}px width=${hero?.width?.toFixed(0)}px center=${hero?.centerX?.toFixed(0)}px`);

  // 3. All major sections - width analysis
  const sections = await page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return [];
    const results = [];
    const children = main.querySelectorAll('section');
    children.forEach((sec, i) => {
      const rect = sec.getBoundingClientRect();
      const cs = getComputedStyle(sec);
      results.push({
        index: i,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        left: rect.left,
        right: window.innerWidth - rect.right,
        padding: cs.padding,
        text: sec.textContent.substring(0, 80).trim(),
      });
    });
    // Also check the main container
    const mainRect = main.getBoundingClientRect();
    results.push({
      index: 'main',
      top: mainRect.top,
      width: mainRect.width,
      height: mainRect.height,
      left: mainRect.left,
      right: window.innerWidth - mainRect.right,
      text: 'MAIN',
    });
    return results;
  });
  log(`\nSection layout:`);
  sections.forEach(s => {
    const w = typeof s.width === 'number' ? s.width.toFixed(0) : s.width;
    const l = typeof s.left === 'number' ? s.left.toFixed(0) : s.left;
    const r = typeof s.right === 'number' ? s.right.toFixed(0) : s.right;
    const h = typeof s.height === 'number' ? s.height.toFixed(0) : s.height;
    log(`  [${s.index}] w=${w}px h=${h}px left=${l}px right=${r}px "${s.text?.substring(0, 50)}"`);
  });

  // 4. Glass card analysis
  const cards = await page.evaluate(() => {
    const glassElements = document.querySelectorAll('[class*="glass"], [class*="GlassCard"], .rounded-2xl');
    const results = [];
    glassElements.forEach((el, i) => {
      if (i > 8) return;
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      results.push({
        tag: el.tagName,
        className: el.className.substring(0, 60),
        bg: cs.backgroundColor,
        border: cs.border,
        borderRadius: cs.borderRadius,
        backdrop: cs.backdropFilter,
        width: rect.width,
        height: rect.height,
        left: rect.left,
        right: window.innerWidth - rect.right,
      });
    });
    return results;
  });
  log(`\nGlass/Card elements (${cards.length}):`);
  cards.forEach((c, i) => {
    log(`  [${i}] ${c.tag} w=${c.width?.toFixed(0)}px left=${c.left?.toFixed(0)}px right=${c.right?.toFixed(0)}px bg=${c.bg} border=${c.border?.substring(0, 30)} backdrop=${c.backdrop}`);
  });

  // 5. Form card specifically
  const formCard = await page.evaluate(() => {
    // Find the form/create section by #create anchor or the big card
    const createSection = document.querySelector('#create');
    if (!createSection) return null;
    const card = createSection.querySelector('[class*="glass"], [class*="rounded-2xl"]') || createSection.querySelector('div > div');
    if (!card) return null;
    const rect = card.getBoundingClientRect();
    const cs = getComputedStyle(card);
    return {
      bg: cs.backgroundColor,
      border: cs.border,
      borderRadius: cs.borderRadius,
      backdrop: cs.backdropFilter,
      boxShadow: cs.boxShadow?.substring(0, 60),
      width: rect.width,
      height: rect.height,
      left: rect.left,
      right: window.innerWidth - rect.right,
    };
  });
  if (formCard) {
    log(`\nForm card: w=${formCard.width?.toFixed(0)}px h=${formCard.height?.toFixed(0)}px`);
    log(`  left=${formCard.left?.toFixed(0)}px right=${formCard.right?.toFixed(0)}px`);
    log(`  bg=${formCard.bg} border=${formCard.border?.substring(0, 40)}`);
    log(`  borderRadius=${formCard.borderRadius} backdrop=${formCard.backdrop}`);
    log(`  boxShadow=${formCard.boxShadow}`);
  }

  // 6. Access Policy grid
  const policyGrid = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll('p, span, h2, h3'));
    const accessPolicy = headings.find(h => h.textContent.trim() === 'Access Policy');
    if (!accessPolicy) return null;
    const grid = accessPolicy.parentElement?.querySelector('.grid');
    if (!grid) return null;
    const children = grid.children;
    const results = [];
    for (let i = 0; i < children.length; i++) {
      const rect = children[i].getBoundingClientRect();
      const cs = getComputedStyle(children[i]);
      const heading = children[i].querySelector('[class*="uppercase"]');
      results.push({
        label: heading?.textContent?.trim() || `item-${i}`,
        width: rect.width,
        height: rect.height,
        bg: cs.backgroundColor,
        border: cs.border?.substring(0, 30),
      });
    }
    return { gridWidth: grid.getBoundingClientRect().width, items: results };
  });
  if (policyGrid) {
    log(`\nAccess Policy grid: totalWidth=${policyGrid.gridWidth?.toFixed(0)}px`);
    policyGrid.items.forEach(item => {
      log(`  ${item.label}: w=${item.width?.toFixed(0)}px h=${item.height?.toFixed(0)}px bg=${item.bg}`);
    });
  }

  // 7. CTA button
  const cta = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const createBtn = btns.find(b => b.textContent.includes('Create'));
    if (!createBtn) return null;
    const rect = createBtn.getBoundingClientRect();
    const cs = getComputedStyle(createBtn);
    return {
      text: createBtn.textContent.trim(),
      bg: cs.backgroundColor,
      color: cs.color,
      borderRadius: cs.borderRadius,
      height: rect.height,
      width: rect.width,
      fontWeight: cs.fontWeight,
    };
  });
  if (cta) {
    log(`\nCTA: "${cta.text}" h=${cta.height?.toFixed(0)}px w=${cta.width?.toFixed(0)}px bg=${cta.bg} color=${cta.color} weight=${cta.fontWeight}`);
  }

  // 8. Lifecycle ribbon
  const lifecycle = await page.evaluate(() => {
    const labels = ['Create', 'Encrypt', 'Share', 'Access', 'Destroyed'];
    const elements = [];
    const allText = document.querySelectorAll('span');
    allText.forEach(span => {
      if (labels.includes(span.textContent.trim())) {
        const rect = span.getBoundingClientRect();
        elements.push({ label: span.textContent.trim(), left: rect.left, top: rect.top, width: rect.width });
      }
    });
    if (elements.length === 0) return null;
    const first = elements[0];
    const last = elements[elements.length - 1];
    return {
      items: elements,
      totalWidth: last.left + last.width - first.left,
      firstLeft: first.left,
      lastRight: last.left + last.width,
      containerCenter: (first.left + last.left + last.width) / 2,
      viewportCenter: window.innerWidth / 2,
    };
  });
  if (lifecycle) {
    log(`\nLifecycle ribbon:`);
    lifecycle.items.forEach(i => log(`  ${i.label}: left=${i.left?.toFixed(0)}px`));
    log(`  totalWidth=${lifecycle.totalWidth?.toFixed(0)}px centered=${Math.abs(lifecycle.containerCenter - lifecycle.viewportCenter) < 50 ? 'YES' : 'NO (off by ' + (lifecycle.containerCenter - lifecycle.viewportCenter).toFixed(0) + 'px)'}`);
  }

  // 9. Trust model section
  const trust = await page.evaluate(() => {
    const h2s = Array.from(document.querySelectorAll('h2'));
    const trustH2 = h2s.find(h => h.textContent.includes('VaultDrop know'));
    if (!trustH2) return null;
    const section = trustH2.closest('section');
    if (!section) return null;
    const rect = section.getBoundingClientRect();
    return { top: rect.top, height: rect.height, width: rect.width };
  });
  if (trust) {
    log(`\nTrust model: top=${trust.top?.toFixed(0)}px height=${trust.height?.toFixed(0)}px`);
  }

  // 10. Empty space analysis
  const emptySpace = await page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return null;
    const mainRect = main.getBoundingClientRect();
    const lastChild = main.lastElementChild;
    const lastRect = lastChild ? lastChild.getBoundingClientRect() : null;
    return {
      mainHeight: mainRect.height,
      contentBottom: lastRect ? lastRect.bottom - mainRect.top : 0,
      emptyBottom: lastRect ? mainRect.bottom - lastRect.bottom : 0,
      sideMargins: {
        left: mainRect.left,
        right: window.innerWidth - mainRect.right,
      },
    };
  });
  if (emptySpace) {
    log(`\nEmpty space analysis:`);
    log(`  Main height: ${emptySpace.mainHeight?.toFixed(0)}px`);
    log(`  Content ends at: ${emptySpace.contentBottom?.toFixed(0)}px`);
    log(`  Empty space at bottom: ${emptySpace.emptyBottom?.toFixed(0)}px`);
    log(`  Side margins: left=${emptySpace.sideMargins?.left?.toFixed(0)}px right=${emptySpace.sideMargins?.right?.toFixed(0)}px`);
  }

  // 11. Color contrast for key text
  const textColors = await page.evaluate(() => {
    const results = [];
    const elements = document.querySelectorAll('h1, h2, p, span, button, a, label');
    const seen = new Set();
    elements.forEach(el => {
      const cs = getComputedStyle(el);
      const key = `${cs.color}-${cs.fontSize}`;
      if (!seen.has(key) && results.length < 15) {
        seen.add(key);
        results.push({
          tag: el.tagName,
          text: el.textContent?.trim().substring(0, 40),
          color: cs.color,
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
        });
      }
    });
    return results;
  });
  log(`\nText color palette:`);
  textColors.forEach(t => {
    log(`  <${t.tag}> color=${t.color} size=${t.fontSize} weight=${t.fontWeight} "${t.text?.substring(0, 35)}"`);
  });

  // 12. Full page metrics
  const metrics = await page.evaluate(() => {
    const main = document.querySelector('main');
    return {
      pageHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      mainContentHeight: main?.scrollHeight || 0,
    };
  });
  log(`\nPage metrics: scrollHeight=${metrics.pageHeight}px viewport=${metrics.viewportHeight}px main=${metrics.mainContentHeight}px`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  const viewports = [
    { name: '1440x900', width: 1440, height: 900 },
    { name: '1280x800', width: 1280, height: 800 },
    { name: '390x844-mobile', width: 390, height: 844 },
  ];

  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      colorScheme: 'dark',
    });
    const page = await context.newPage();
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);

    await inspectPage(page, `HOME @ ${vp.name}`);
    await context.close();
  }

  await browser.close();

  fs.writeFileSync(path.join(__dirname, 'screenshots', 'inspection-report.txt'), RESULTS.join('\n'));
  console.log('\nReport saved to screenshots/inspection-report.txt');
}

main().catch(console.error);
