export function generateTestCode(name, mocks, testSteps, startUrl) {
  const lines = [];

  lines.push("const { test, expect } = require('@playwright/test');");
  lines.push("const path = require('path');");
  lines.push("const fs = require('fs');");
  lines.push('');

  lines.push(`test('${name.replace(/'/g, "\\'")}', async ({ page }) => {`);

  const hasSteps = testSteps && testSteps.length > 0;
  if (hasSteps) {
    if (mocks && mocks.length > 0) {
      mocks.forEach((m, i) => {
        const filename = m.filename || `mock_${i}`;
        const mockPath = `path.join(__dirname, 'mocks', '${filename}.json')`;
        lines.push(`  await page.route('*${getUrlGlob(m.url)}*', async (route) => {`);
        lines.push(`    if (route.request().method() !== '${m.method || 'GET'}') return route.fallback();`);
        lines.push(`    const body = fs.readFileSync(${mockPath}, 'utf-8');`);
        const ct = m.headers?.['content-type'] || 'application/json';
        lines.push(`    await route.fulfill({ status: ${m.status || 200}, contentType: '${ct}', body });`);
        lines.push(`  });`);
        lines.push('');
      });
    }

    lines.push(`  await page.goto('${(startUrl || 'https://example.com').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}');`);
    lines.push('');

    testSteps.forEach((a) => {
      const line = actionToCode(a);
      if (line) lines.push('  ' + line);
      (a.expects || []).forEach((ex) => {
        const expectLine = expectToCode(ex, a);
        if (expectLine) lines.push('  ' + expectLine);
      });
    });
  }

  lines.push('});');
  return lines.join('\n');
}

export function getUrlGlob(url) {
  try {
    const u = new URL(url);
    const path = u.pathname || '/';
    return path + (u.search ? '*' : '');
  } catch {
    return '/*';
  }
}

export function escapeForPlaywright(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function locatorMethodStr(info) {
  if (!info || !info.method) return '';
  let suffix = '';
  if (info.method === 'nthChild') {
    const sel = info.childSelector || '> *';
    const n = typeof info.nthIndex === 'number' ? `.nth(${info.nthIndex})` : '';
    const inner = info.inner ? '.' + locatorMethodStr(info.inner) : '';
    return `locator('${escapeForPlaywright(sel)}')` + n + inner;
  }
  if (typeof info.nthIndex === 'number' && info.nthIndex >= 0) suffix = `.nth(${info.nthIndex})`;
  switch (info.method) {
    case 'role':
      if (info.role) {
        const opts = [];
        if (info.name) opts.push(`name: '${escapeForPlaywright(info.name)}'`);
        if (info.level != null) opts.push(`level: ${info.level}`);
        const optStr = opts.length ? `, { ${opts.join(', ')} }` : '';
        return `getByRole('${escapeForPlaywright(info.role)}'${optStr})` + suffix;
      }
      return '';
    case 'label':
      return info.label ? `getByLabel('${escapeForPlaywright(info.label)}')` + suffix : '';
    case 'testId':
      return info.value ? `getByTestId('${escapeForPlaywright(info.value)}')` + suffix : '';
    case 'text':
      return info.text ? `getByText('${escapeForPlaywright(info.text)}')` + suffix : '';
    case 'css':
      return info.selector ? `locator('${escapeForPlaywright(info.selector)}')` + suffix : '';
    case 'rowCell': {
      if (!info.rowText) return '';
      let chain = `getByText('${escapeForPlaywright(info.rowText)}')`;
      if (info.cellText) chain += `.getByText('${escapeForPlaywright(info.cellText)}')`;
      else if (info.dataIndex) chain += `.locator('[data-index="${escapeForPlaywright(info.dataIndex)}"]')`;
      return chain + suffix;
    }
    default:
      return '';
  }
}

export function getLocatorStr(selector, locatorInfo, innerLocatorInfo) {
  let base = '';
  const method = locatorMethodStr(locatorInfo);
  if (method) {
    base = 'page.' + method;
  } else {
    base = `page.locator('${escapeForPlaywright(selector || '')}')`;
  }
  if (innerLocatorInfo) {
    const inner = locatorMethodStr(innerLocatorInfo);
    if (inner) base += '.' + inner;
  }
  return base;
}

export function expectQuote(s) {
  if (!s) return "''";
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

export function expectToCode(ex, parentAction) {
  if (ex.custom) {
    let s = ex.custom.trim();
    if (ex.not && !s.includes('.not')) {
      const start = s.indexOf('expect(');
      if (start >= 0) {
        let depth = 0;
        let j = start + 6;
        while (j < s.length) {
          if (s[j] === '(') depth++;
          else if (s[j] === ')') {
            depth--;
            if (depth === 0) {
              s = s.slice(0, j + 1) + '.not' + s.slice(j + 1);
              break;
            }
          }
          j++;
        }
      }
    }
    return (s.endsWith(';') ? s : s + ';');
  }
  const loc = getLocatorStr(parentAction.selector || '', parentAction.locatorInfo, parentAction.innerLocatorInfo);
  const v = ex.value || '';
  const notPart = ex.not ? '.not' : '';
  switch (ex.assertion) {
    case 'toBeAttached':
    case 'toBeVisible':
    case 'toBeHidden':
    case 'toBeEnabled':
    case 'toBeDisabled':
    case 'toBeEditable':
    case 'toBeFocused':
    case 'toBeInViewport':
    case 'toBeChecked':
    case 'toBeEmpty':
      return `await expect(${loc})${notPart}.${ex.assertion}();`;
    case 'toHaveText':
    case 'toContainText':
      return `await expect(${loc})${notPart}.${ex.assertion}(${expectQuote(v)});`;
    case 'toHaveAttribute': {
      const parts = v.split(',').map((p) => p.trim());
      const attr = expectQuote(parts[0] || 'href');
      const val = expectQuote(parts[1] != null ? parts[1] : '');
      return `await expect(${loc})${notPart}.toHaveAttribute(${attr}, ${val});`;
    }
    case 'toHaveValue':
      return `await expect(${loc})${notPart}.toHaveValue(${expectQuote(v)});`;
    case 'toHaveValues': {
      let arrVal = '[]';
      if (v.trim()) {
        if (v.trim().startsWith('[')) arrVal = v;
        else arrVal = '[' + v.split(',').map((x) => expectQuote(x.trim())).join(', ') + ']';
      }
      return `await expect(${loc})${notPart}.toHaveValues(${arrVal});`;
    }
    case 'toHaveClass':
    case 'toContainClass':
      return `await expect(${loc})${notPart}.${ex.assertion}(${expectQuote(v)});`;
    case 'toHaveId':
      return `await expect(${loc})${notPart}.toHaveId(${expectQuote(v)});`;
    case 'toHaveCount':
      const num = parseInt(v, 10);
      return `await expect(${loc})${notPart}.toHaveCount(${isNaN(num) ? 0 : num});`;
    case 'toHaveCSS': {
      const parts = v.split(',').map((p) => p.trim());
      const prop = expectQuote(parts[0] || 'color');
      const val2 = expectQuote(parts[1] != null ? parts[1] : '');
      return `await expect(${loc})${notPart}.toHaveCSS(${prop}, ${val2});`;
    }
    case 'toHaveAccessibleName':
    case 'toHaveAccessibleDescription':
      return `await expect(${loc})${notPart}.${ex.assertion}(${expectQuote(v)});`;
    case 'toHaveRole':
      return `await expect(${loc})${notPart}.toHaveRole(${expectQuote(v)});`;
    case 'toHaveJSProperty': {
      const parts = v.split(',').map((p) => p.trim());
      const prop = expectQuote(parts[0] || 'value');
      const val3 = parts[1] != null ? (parts[1] === 'true' ? 'true' : parts[1] === 'false' ? 'false' : expectQuote(parts[1])) : 'undefined';
      return `await expect(${loc})${notPart}.toHaveJSProperty(${prop}, ${val3});`;
    }
    default:
      return `await expect(${loc})${notPart}.toBeVisible();`;
  }
}

export function actionToCode(a) {
  if (a.type === 'route') return null;
  const loc = getLocatorStr(a.selector || '', a.locatorInfo, a.innerLocatorInfo);
  if (a.type === 'expectRequest') {
    const method = (a.method || 'GET').toUpperCase();
    let pathPart = '';
    try {
      const u = new URL(a.url || '', 'https://x');
      pathPart = u.pathname || u.href.split('?')[0] || '/';
    } catch {
      pathPart = (a.url || '').split('?')[0] || '/*';
    }
    const escaped = pathPart.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `await page.waitForResponse(res => res.url().includes('${escaped}') && res.request().method() === '${method}');`;
  }
  switch (a.type) {
    case 'click':
      return `await ${loc}.click();`;
    case 'doubleClick':
      return `await ${loc}.dblclick();`;
    case 'rightClick':
      return `await ${loc}.click({ button: 'right' });`;
    case 'fill':
      const val = String(a.value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `await ${loc}.fill('${val}');`;
    case 'selectOption':
      const optVal = String(a.value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `await ${loc}.selectOption('${optVal}');`;
    case 'check':
      return `await ${loc}.check();`;
    case 'uncheck':
      return `await ${loc}.uncheck();`;
    case 'press':
      const key = String(a.key ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `await ${loc}.press('${key}');`;
    case 'hover':
      return `await ${loc}.hover();`;
    case 'scroll':
      return `await ${loc}.scrollIntoViewIfNeeded();`;
    case 'goto':
      const gotoUrl = String(a.url ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `await page.goto('${gotoUrl}');`;
    case 'dragTo': {
      const targetLoc = getLocatorStr(a.targetSelector || '', a.targetLocatorInfo);
      return `await ${loc}.dragTo(${targetLoc});`;
    }
    case 'setInputFiles': {
      const files = a.files && a.files.length ? a.files.map(function (f) { return "'./fixtures/" + String(f).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }) : ["'./path/to/file'"];
      return `await ${loc}.setInputFiles([${files.join(', ')}]);`;
    }
    default:
      return null;
  }
}
