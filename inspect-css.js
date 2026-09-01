const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(3000);

  // Check CSS loading
  const cssInfo = await page.evaluate(() => {
    const stylesheets = Array.from(document.styleSheets);
    const results = [];
    stylesheets.forEach((ss, i) => {
      try {
        const rules = ss.cssRules?.length || 0;
        results.push({ index: i, href: ss.href?.substring(0, 80) || 'inline', rules });
      } catch (e) {
        results.push({ index: i, href: ss.href?.substring(0, 80) || 'inline', error: e.message });
      }
    });
    return results;
  });
  console.log('Stylesheets:', JSON.stringify(cssInfo, null, 2));

  // Check specific class application
  const classCheck = await page.evaluate(() => {
    const main = document.querySelector('main');
    const firstChild = main?.firstElementChild;
    const secondChild = firstChild?.nextElementSibling;
    const thirdChild = secondChild?.nextElementSibling;

    const check = (el, label) => {
      if (!el) return { label, found: false };
      const cs = getComputedStyle(el);
      return {
        label,
        className: el.className?.substring(0, 100),
        display: cs.display,
        gridTemplateColumns: cs.gridTemplateColumns,
        gap: cs.gap,
        maxWidth: cs.maxWidth,
        padding: cs.padding,
        bg: cs.backgroundColor,
        border: cs.border,
        borderRadius: cs.borderRadius,
        backdropFilter: cs.backdropFilter,
        width: el.getBoundingClientRect().width,
      };
    };

    // Check the lifecycle ribbon (should be section 1, inside the main)
    const sections = main?.querySelectorAll(':scope > section');
    const lifecycleSection = sections?.[1];

    return {
      mainWrapper: check(firstChild, 'main-first-child'),
      hero: check(firstChild?.firstElementChild, 'hero-animated'),
      lifecycleSection: lifecycleSection ? {
        width: lifecycleSection.getBoundingClientRect().width,
        display: getComputedStyle(lifecycleSection).display,
        innerDiv: lifecycleSection.querySelector('.flex') ? {
          display: getComputedStyle(lifecycleSection.querySelector('.flex')).display,
          gap: getComputedStyle(lifecycleSection.querySelector('.flex')).gap,
          justifyContent: getComputedStyle(lifecycleSection.querySelector('.flex')).justifyContent,
          childCount: lifecycleSection.querySelector('.flex').children.length,
          firstChildWidth: lifecycleSection.querySelector('.flex').children[0]?.getBoundingClientRect().width,
          totalWidth: lifecycleSection.querySelector('.flex')?.getBoundingClientRect().width,
        } : null,
      } : null,
    };
  });
  console.log('\nClass check:', JSON.stringify(classCheck, null, 2));

  // Check if glass-strong class is actually applied
  const glassCheck = await page.evaluate(() => {
    // Find all elements with glass-strong in className
    const allElements = document.querySelectorAll('*');
    const glassElements = [];
    allElements.forEach(el => {
      if (typeof el.className === 'string' && el.className.includes('glass-strong')) {
        const cs = getComputedStyle(el);
        glassElements.push({
          tag: el.tagName,
          class: el.className.substring(0, 80),
          bg: cs.backgroundColor,
          border: cs.border,
          borderRadius: cs.borderRadius,
          backdrop: cs.backdropFilter,
        });
      }
    });

    // Also check for overflow-hidden p-0 elements (form card)
    const formCards = [];
    allElements.forEach(el => {
      if (typeof el.className === 'string' && el.className.includes('overflow-hidden') && el.className.includes('p-0')) {
        const cs = getComputedStyle(el);
        formCards.push({
          tag: el.tagName,
          class: el.className.substring(0, 80),
          bg: cs.backgroundColor,
          border: cs.border,
          borderRadius: cs.borderRadius,
          backdrop: cs.backdropFilter,
          boxShadow: cs.boxShadow?.substring(0, 50),
          width: el.getBoundingClientRect().width,
          height: el.getBoundingClientRect().height,
        });
      }
    });

    return { glassElements, formCards };
  });
  console.log('\nGlass elements:', JSON.stringify(glassCheck, null, 2));

  // Check access policy grid specifically
  const gridCheck = await page.evaluate(() => {
    const allDivs = document.querySelectorAll('.grid');
    const results = [];
    allDivs.forEach((div, i) => {
      if (i > 5) return;
      const cs = getComputedStyle(div);
      results.push({
        index: i,
        className: div.className.substring(0, 100),
        display: cs.display,
        gridTemplateColumns: cs.gridTemplateColumns,
        gap: cs.gap,
        childCount: div.children.length,
        firstChildClass: div.children[0]?.className?.substring(0, 60),
        width: div.getBoundingClientRect().width,
      });
    });
    return results;
  });
  console.log('\nGrid elements:', JSON.stringify(gridCheck, null, 2));

  // Check the actual page HTML structure for the form card
  const formHTML = await page.evaluate(() => {
    const create = document.querySelector('#create');
    if (!create) return 'no #create found';
    const card = create.querySelector('[class*="overflow-hidden"]');
    if (!card) return 'no overflow-hidden found in #create';
    return {
      outerHTML: card.outerHTML.substring(0, 300),
      computedBg: getComputedStyle(card).backgroundColor,
      computedBorder: getComputedStyle(card).border,
      computedBorderRadius: getComputedStyle(card).borderRadius,
      computedBackdrop: getComputedStyle(card).backdropFilter,
    };
  });
  console.log('\nForm card HTML:', JSON.stringify(formHTML, null, 2));

  // Check font loading
  const fontCheck = await page.evaluate(() => {
    return {
      bodyFont: getComputedStyle(document.body).fontFamily,
      h1Font: getComputedStyle(document.querySelector('h1')).fontFamily,
      h2Font: getComputedStyle(document.querySelector('h2'))?.fontFamily,
      cssVariables: {
        fontSans: getComputedStyle(document.documentElement).getPropertyValue('--font-geist-sans'),
        fontMono: getComputedStyle(document.documentElement).getPropertyValue('--font-geist-mono'),
      },
      fontFaceCount: document.fonts?.size || 0,
      fontsReady: document.fonts?.status,
    };
  });
  console.log('\nFont check:', JSON.stringify(fontCheck, null, 2));

  await browser.close();
}

main().catch(console.error);
