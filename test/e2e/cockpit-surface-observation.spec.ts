import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:3900' });

const fakeObservationFrame = `<!doctype html>
<html>
  <head><title>Fake Surface</title></head>
  <body>
    <h1>Fake Surface</h1>
    <script>
      window.__requests = [];
      window.__requestIds = [];
      window.addEventListener('message', (event) => {
        if (!event.data || event.data.type !== 'spectra.surface.inspect.request') return;
        window.__requests.push({ requestId: event.data.requestId, mountId: event.data.mountId, origin: event.origin });
        if (!window.__requestIds.includes(event.data.requestId)) window.__requestIds.push(event.data.requestId);
      });
      window.__sendObservation = (requestId, overrides = {}) => {
        const request = window.__requests.find((item) => item.requestId === requestId);
        if (!request) throw new Error('unknown request ' + requestId);
        parent.postMessage({
          type: 'spectra.surface.inspect.response',
          schemaVersion: 'spectra.surfaceObservation.v1',
          requestId,
          mountId: request.mountId,
          observation: {
            schemaVersion: 'spectra.surfaceObservation.v1',
            mountId: request.mountId,
            appId: request.mountId === 'focus' ? 'focus' : 'epk',
            origin: location.origin,
            path: location.pathname,
            documentTitle: document.title,
            capturedAt: '2026-07-12T00:00:00.000Z',
            headings: [{ level: 1, text: 'Fake Surface' }],
            landmarks: [],
            buttons: [],
            links: [],
            formLabels: [],
            states: [],
            statusText: [],
            errorText: [],
            visibleBodyText: 'Fresh fake evidence',
            observerErrors: [],
            unhandledRejections: [],
            truncation: {},
            redactions: {},
            ...overrides,
          },
        }, request.origin);
      };
    </script>
  </body>
</html>`;

test('Workbench inspects EPK Admin evidence, redacts values, and attaches it to one local-only prompt', async ({ page }) => {
  const requests: Array<Record<string, any>> = [];
  await page.route('**/api/v1/ai/request', async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, any>);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        provider: 'ollama',
        model: 'qwen2.5',
        dataBoundary: 'local',
        response: 'Local answer with attached surface evidence.',
        structuredResponse: null,
        provenance: { routedBy: 'prism-spectra' },
        usage: { tokensIn: 10, tokensOut: 20, cost: 0, latencyMs: 42 },
      }),
    });
  });

  await page.goto('/workbench', { waitUntil: 'load' });
  await page.locator('.nav button[data-view="epk-admin"]').click();

  const adminFrame = page.frameLocator('section[data-section="epk-admin"] iframe');
  await expect(adminFrame.locator('.brand')).toContainText('EPK OS');
  await expect(adminFrame.locator('#canvas')).toBeVisible();
  await page.waitForTimeout(250);
  await adminFrame.locator('body').evaluate((body) => {
    const fixture = document.createElement('section');
    fixture.setAttribute('aria-label', 'Observation fixture');
    fixture.innerHTML = `
      <h2>Observation Fixture</h2>
      <button id="fixture-disabled" disabled aria-expanded="true">Disabled Action <span hidden>HIDDEN_BUTTON_TEXT_SHOULD_NOT_APPEAR</span></button>
      <a href="/admin/next.html?token=secret-query">Safe Link</a>
      <label for="secret-token">API token</label>
      <input id="secret-token" name="github-token" type="password" value="SECRET_TOKEN_VALUE" />
      <label for="ordinary-input">Ordinary value</label>
      <input id="ordinary-input" value="ORDINARY_INPUT_VALUE" />
      <input type="button" value="INPUT_BUTTON_VALUE_SECRET" aria-label="Input button action" />
      <input type="submit" value="INPUT_SUBMIT_VALUE_SECRET" aria-label="Input submit action" />
      <input type="reset" value="INPUT_RESET_VALUE_SECRET" aria-label="Input reset action" />
      <label for="notes-input">Notes</label>
      <textarea id="notes-input">TEXTAREA_SECRET_VALUE</textarea>
      <label><input id="checked-box" type="checkbox" checked /> Checked box</label>
      <select id="selected-state"><option value="OPTION_SECRET_VALUE">OPTION_SECRET_TEXT</option><option selected value="OPTION_SELECTED_SECRET_VALUE">OPTION_SELECTED_SECRET_TEXT</option></select>
      <div role="status">Fixture status ready Authorization: Bearer STATUS_SECRET_VALUE_123456 token=STATUS_TOKEN_SECRET_123456</div>
      <div class="error">Fixture visible error api_key=ERROR_API_KEY_SECRET_123456 http://localhost:3900/path?token=URL_TOKEN_SECRET_123456#URL_FRAGMENT_SECRET_123456 eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJTZWNyZXQifQ.signatureSECRET /Users/dave/secrets/ERROR_PATH_SECRET_123456.txt</div>
      <p>Authorization=Bearer REDACTION_START_BOUNDARY_SECRET</p>
      <p>REDACTION_FIXTURE_START</p>
      <p>API token VISIBLE_TOKEN_SECRET_123456 password=VISIBLE_PASSWORD_SECRET_123456 credential:VISIBLE_CREDENTIAL_SECRET_123456</p>
      <p>token: "MULTI WORD TOKEN SECRET" password='MULTI WORD PASSWORD SECRET' secret: "MULTI WORD SECRET" passwd=PASSWD_SECRET api key: API_KEY_WITH_SPACE_SECRET Authorization: Bearer AUTH_SECRET file:///Users/dave/secrets/FILE_URL_SECRET.txt file:///private/tmp/PRIVATE_FILE_URL_SECRET.txt</p>
      <p>Authorization: Basic BASIC_AUTH_SECRET_SUFFIX_BASIC Authorization: Token TOKEN_AUTH_SECRET_SUFFIX_TOKEN Authorization: Digest DIGEST_AUTH_SECRET_SUFFIX_DIGEST Authorization: ApiKey APIKEY_AUTH_SECRET_SUFFIX_APIKEY file://localhost/Users/dave/secrets/LOCALHOST_FILE_URL_SECRET.txt file:///home/dave/HOME_FILE_URL_SECRET.txt file:///C:/Users/dave/WINDOWS_FILE_URL_SECRET.txt file:/private/tmp/PRIVATE_FILE_SECRET.txt /home/dave/HOME_PATH_SECRET.txt /root/ROOT_PATH_SECRET.txt C:\\Users\\dave\\WINDOWS PATH WITH SPACES SECRET WINDOWS_PATH_WITH_SPACES_SECRET.txt D:/Projects/private/WINDOWS_FORWARD_SLASH_SECRET.txt</p>
      <p>Authorization: Digest username="DIGEST_USER_SECRET", realm="DIGEST_REALM_SECRET", nonce="DIGEST_NONCE_SECRET", uri="/DIGEST_URI_SECRET", response="DIGEST_RESPONSE_SECRET" Authorization=Bearer BEARER_EQUALS_SECRET /home/dave/HOME PATH WITH SPACES SECRET.txt /home/dave/SECRET DIRECTORY/extensionless-child C:\\Users\\dave\\SECRET FOLDER\\extensionless-file D:/Projects/private/FORWARD SLASH SECRET DIRECTORY/file file:///home/dave/FILE URL WITH SPACES SECRET.txt</p>
      <p>Authorization=Digest username=UNQUOTED_USER_SECRET, realm=UNQUOTED_REALM_SECRET, nonce=UNQUOTED_NONCE_SECRET, uri=/UNQUOTED_URI_SECRET, response=UNQUOTED_RESPONSE_SECRET file://localhost/Users/dave/LOCAL FILE URL SECRET.txt file:/private/tmp/PRIVATE FILE URL SECRET FILE:///C:/Users/dave/WINDOWS FILE URL SECRET.txt</p>
      <p>Authorization=Bearer REDACTION_END_BOUNDARY_SECRET</p>
      <p>REDACTION_FIXTURE_END</p>
      <a href="javascript:alert('JAVASCRIPT_LINK_SECRET')">JavaScript link</a>
      <a href="data:text/plain,DATA_LINK_SECRET">Data link</a>
      <a href="file:///Users/dave/secrets/FILE_LINK_SECRET.txt">File link</a>
      <a href="blob:https://example.com/FILE_URL_SECRET">Blob link</a>
      <a href="spectra-secret://CUSTOM_LINK_SECRET">Custom link</a>
      <a href="https://example.com/path?token=HTTPS_LINK_TOKEN_SECRET#HTTPS_LINK_FRAGMENT_SECRET">Safe HTTPS link</a>
      <a href="/releases/current">Release route</a>
      <a href="https://example.com/home/documentation">Documentation route</a>
      <a href="https://example.com/admin/admin.html">Example admin route</a>
      <p aria-hidden="true">ARIA_HIDDEN_TEXT_SHOULD_NOT_APPEAR</p>
      <p style="opacity: 0;">OPACITY_ZERO_TEXT_SHOULD_NOT_APPEAR</p>
      <div style="display: none;"><p>HIDDEN_ANCESTOR_TEXT_SHOULD_NOT_APPEAR</p></div>
      <div hidden>HIDDEN_TEXT_SHOULD_NOT_APPEAR</div>
      <script>window.HIDDEN_SCRIPT_TEXT = "SCRIPT_TEXT_SHOULD_NOT_APPEAR";</script>
      <style>.hidden-style-fixture::before { content: "STYLE_TEXT_SHOULD_NOT_APPEAR"; }</style>
      <template>TEMPLATE_TEXT_SHOULD_NOT_APPEAR</template>
      <noscript>NOSCRIPT_TEXT_SHOULD_NOT_APPEAR</noscript>
      <p>Visible tail text</p>
    `;
    (fixture.querySelector('#notes-input') as HTMLTextAreaElement).value = 'TEXTAREA_CURRENT_SECRET_VALUE';
    body.replaceChildren(fixture);
    window.dispatchEvent(new ErrorEvent('error', {
      message: 'Authorization: Bearer OBSERVER_ERROR_SECRET_123456 /Users/dave/secrets/OBSERVER_ERROR_PATH_SECRET_123456.txt',
    }));
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {
      promise: Promise.resolve(),
      reason: 'token: UNHANDLED_REJECTION_SECRET_123456 http://localhost:3900/path?token=UNHANDLED_QUERY_SECRET_123456#UNHANDLED_FRAGMENT_SECRET_123456',
    }));
  });
  await expect(adminFrame.locator('body')).toContainText('REDACTION_FIXTURE_START');
  await expect(adminFrame.locator('body')).toContainText('REDACTION_FIXTURE_END');

  await page.locator('section[data-section="epk-admin"] button[data-surface-action="inspect"]').click();
  await expect(page.locator('section[data-section="epk-admin"] [data-surface-observation-preview]')).toBeVisible();
  await expect(page.locator('section[data-section="epk-admin"] [data-surface-observation-preview]')).toContainText('Observation Fixture');
  expect(requests).toHaveLength(0);

  await page.locator('section[data-section="epk-admin"] button[data-surface-action="attach"]').click();
  await expect(page.locator('#console-surface-observation-panel')).toContainText('attached to next prompt');

  await page.locator('.nav button[data-view="console"]').click();
  await page.locator('#console-prompt').fill('Why is the disabled action disabled?');
  await page.locator('#console-send').click();
  await expect(page.locator('#console-status')).toContainText('Response received');

  expect(requests).toHaveLength(1);
  const observation = requests[0].input.surfaceObservation;
  expect(requests[0]).toMatchObject({
    sourceApp: 'prism-spectra',
    intent: 'workbench-chat',
    preferredMode: 'local-only',
  });
  expect(observation.schemaVersion).toBe('spectra.surfaceObservation.v1');
  expect(observation.mountId).toBe('epk-admin');
  expect(observation.origin).toMatch(/^http:\/\/127\.0\.0\.1:/);
  expect(observation.path).toBe('/admin/admin.html');
  expect(observation.visibleBodyText).toContain('REDACTION_FIXTURE_START');
  expect(observation.visibleBodyText).toContain('REDACTION_FIXTURE_END');
  expect(JSON.stringify(observation)).not.toContain('SECRET_TOKEN_VALUE');
  expect(JSON.stringify(observation)).not.toContain('ORDINARY_INPUT_VALUE');
  expect(JSON.stringify(observation)).not.toContain('INPUT_BUTTON_VALUE_SECRET');
  expect(JSON.stringify(observation)).not.toContain('INPUT_SUBMIT_VALUE_SECRET');
  expect(JSON.stringify(observation)).not.toContain('INPUT_RESET_VALUE_SECRET');
  expect(JSON.stringify(observation)).not.toContain('TEXTAREA_SECRET_VALUE');
  expect(JSON.stringify(observation)).not.toContain('TEXTAREA_CURRENT_SECRET_VALUE');
  expect(JSON.stringify(observation)).not.toContain('OPTION_SECRET_TEXT');
  expect(JSON.stringify(observation)).not.toContain('OPTION_SECRET_VALUE');
  expect(JSON.stringify(observation)).not.toContain('OPTION_SELECTED_SECRET_TEXT');
  expect(JSON.stringify(observation)).not.toContain('OPTION_SELECTED_SECRET_VALUE');
  expect(JSON.stringify(observation)).not.toContain('HIDDEN_TEXT_SHOULD_NOT_APPEAR');
  expect(JSON.stringify(observation)).not.toContain('ARIA_HIDDEN_TEXT_SHOULD_NOT_APPEAR');
  expect(JSON.stringify(observation)).not.toContain('OPACITY_ZERO_TEXT_SHOULD_NOT_APPEAR');
  expect(JSON.stringify(observation)).not.toContain('HIDDEN_ANCESTOR_TEXT_SHOULD_NOT_APPEAR');
  expect(JSON.stringify(observation)).not.toContain('HIDDEN_BUTTON_TEXT_SHOULD_NOT_APPEAR');
  expect(JSON.stringify(observation)).not.toContain('SCRIPT_TEXT_SHOULD_NOT_APPEAR');
  expect(JSON.stringify(observation)).not.toContain('STYLE_TEXT_SHOULD_NOT_APPEAR');
  expect(JSON.stringify(observation)).not.toContain('TEMPLATE_TEXT_SHOULD_NOT_APPEAR');
  expect(JSON.stringify(observation)).not.toContain('NOSCRIPT_TEXT_SHOULD_NOT_APPEAR');
  expect(JSON.stringify(observation)).not.toContain('STATUS_SECRET_VALUE_123456');
  expect(JSON.stringify(observation)).not.toContain('STATUS_TOKEN_SECRET_123456');
  expect(JSON.stringify(observation)).not.toContain('ERROR_API_KEY_SECRET_123456');
  expect(JSON.stringify(observation)).not.toContain('URL_TOKEN_SECRET_123456');
  expect(JSON.stringify(observation)).not.toContain('URL_FRAGMENT_SECRET_123456');
  expect(JSON.stringify(observation)).not.toContain('signatureSECRET');
  expect(JSON.stringify(observation)).not.toContain('VISIBLE_TOKEN_SECRET_123456');
  expect(JSON.stringify(observation)).not.toContain('VISIBLE_PASSWORD_SECRET_123456');
  expect(JSON.stringify(observation)).not.toContain('VISIBLE_CREDENTIAL_SECRET_123456');
  expect(JSON.stringify(observation)).not.toContain('ERROR_PATH_SECRET_123456');
  expect(JSON.stringify(observation)).not.toContain('REDACTION_START_BOUNDARY_SECRET');
  expect(JSON.stringify(observation)).not.toContain('REDACTION_END_BOUNDARY_SECRET');
  expect(JSON.stringify(observation)).not.toContain('OBSERVER_ERROR_SECRET_123456');
  expect(JSON.stringify(observation)).not.toContain('OBSERVER_ERROR_PATH_SECRET_123456');
  expect(JSON.stringify(observation)).not.toContain('UNHANDLED_REJECTION_SECRET_123456');
  expect(JSON.stringify(observation)).not.toContain('UNHANDLED_QUERY_SECRET_123456');
  expect(JSON.stringify(observation)).not.toContain('UNHANDLED_FRAGMENT_SECRET_123456');
  expect(JSON.stringify(observation)).not.toContain('MULTI WORD TOKEN SECRET');
  expect(JSON.stringify(observation)).not.toContain('MULTI WORD PASSWORD SECRET');
  expect(JSON.stringify(observation)).not.toContain('MULTI WORD SECRET');
  expect(JSON.stringify(observation)).not.toContain('PASSWD_SECRET');
  expect(JSON.stringify(observation)).not.toContain('API_KEY_WITH_SPACE_SECRET');
  expect(JSON.stringify(observation)).not.toContain('AUTH_SECRET');
  expect(JSON.stringify(observation)).not.toContain('FILE_URL_SECRET');
  expect(JSON.stringify(observation)).not.toContain('PRIVATE_FILE_URL_SECRET');
  expect(JSON.stringify(observation)).not.toContain('BASIC_AUTH_SECRET');
  expect(JSON.stringify(observation)).not.toContain('TOKEN_AUTH_SECRET');
  expect(JSON.stringify(observation)).not.toContain('DIGEST_AUTH_SECRET');
  expect(JSON.stringify(observation)).not.toContain('APIKEY_AUTH_SECRET');
  expect(JSON.stringify(observation)).not.toContain('SUFFIX_BASIC');
  expect(JSON.stringify(observation)).not.toContain('SUFFIX_TOKEN');
  expect(JSON.stringify(observation)).not.toContain('SUFFIX_DIGEST');
  expect(JSON.stringify(observation)).not.toContain('SUFFIX_APIKEY');
  expect(JSON.stringify(observation)).not.toContain('LOCALHOST_FILE_URL_SECRET');
  expect(JSON.stringify(observation)).not.toContain('HOME_FILE_URL_SECRET');
  expect(JSON.stringify(observation)).not.toContain('WINDOWS_FILE_URL_SECRET');
  expect(JSON.stringify(observation)).not.toContain('PRIVATE_FILE_SECRET');
  expect(JSON.stringify(observation)).not.toContain('DIGEST_USER_SECRET');
  expect(JSON.stringify(observation)).not.toContain('DIGEST_REALM_SECRET');
  expect(JSON.stringify(observation)).not.toContain('DIGEST_NONCE_SECRET');
  expect(JSON.stringify(observation)).not.toContain('DIGEST_URI_SECRET');
  expect(JSON.stringify(observation)).not.toContain('DIGEST_RESPONSE_SECRET');
  expect(JSON.stringify(observation)).not.toContain('BEARER_EQUALS_SECRET');
  expect(JSON.stringify(observation)).not.toContain('UNQUOTED_USER_SECRET');
  expect(JSON.stringify(observation)).not.toContain('UNQUOTED_REALM_SECRET');
  expect(JSON.stringify(observation)).not.toContain('UNQUOTED_NONCE_SECRET');
  expect(JSON.stringify(observation)).not.toContain('UNQUOTED_URI_SECRET');
  expect(JSON.stringify(observation)).not.toContain('UNQUOTED_RESPONSE_SECRET');
  expect(JSON.stringify(observation)).not.toContain('USER_SECRET');
  expect(JSON.stringify(observation)).not.toContain('REALM_SECRET');
  expect(JSON.stringify(observation)).not.toContain('NONCE_SECRET');
  expect(JSON.stringify(observation)).not.toContain('URI_SECRET');
  expect(JSON.stringify(observation)).not.toContain('RESPONSE_SECRET');
  expect(JSON.stringify(observation)).not.toContain('EQUALS_SECRET');
  expect(JSON.stringify(observation)).not.toContain('UNQUOTED_');
  expect(JSON.stringify(observation)).not.toContain('HOME_PATH_SECRET');
  expect(JSON.stringify(observation)).not.toContain('ROOT_PATH_SECRET');
  expect(JSON.stringify(observation)).not.toContain('WINDOWS_PATH_WITH_SPACES_SECRET');
  expect(JSON.stringify(observation)).not.toContain('WINDOWS_FORWARD_SLASH_SECRET');
  expect(JSON.stringify(observation)).not.toContain('HOME PATH WITH SPACES SECRET');
  expect(JSON.stringify(observation)).not.toContain('SECRET DIRECTORY');
  expect(JSON.stringify(observation)).not.toContain('SECRET FOLDER');
  expect(JSON.stringify(observation)).not.toContain('FORWARD SLASH SECRET');
  expect(JSON.stringify(observation)).not.toContain('FILE URL WITH SPACES SECRET');
  expect(JSON.stringify(observation)).not.toContain('LOCAL FILE URL SECRET');
  expect(JSON.stringify(observation)).not.toContain('PRIVATE FILE URL SECRET');
  expect(JSON.stringify(observation)).not.toContain('WINDOWS FILE URL SECRET');
  expect(JSON.stringify(observation)).not.toContain('WITH SPACES SECRET');
  expect(JSON.stringify(observation)).not.toContain('URL WITH SPACES SECRET');
  expect(JSON.stringify(observation)).not.toContain('FILE URL SECRET');
  expect(JSON.stringify(observation)).not.toContain('FORWARD_SLASH_SECRET');
  expect(JSON.stringify(observation)).not.toContain('JAVASCRIPT_LINK_SECRET');
  expect(JSON.stringify(observation)).not.toContain('DATA_LINK_SECRET');
  expect(JSON.stringify(observation)).not.toContain('FILE_LINK_SECRET');
  expect(JSON.stringify(observation)).not.toContain('CUSTOM_LINK_SECRET');
  expect(JSON.stringify(observation)).not.toContain('HTTPS_LINK_TOKEN_SECRET');
  expect(JSON.stringify(observation)).not.toContain('HTTPS_LINK_FRAGMENT_SECRET');
  expect(JSON.stringify(observation)).not.toContain('Authorization: Bearer');
  expect(JSON.stringify(observation)).not.toContain('token=');
  expect(JSON.stringify(observation)).not.toContain('token:');
  expect(JSON.stringify(observation)).not.toContain('password=');
  expect(JSON.stringify(observation)).not.toContain('secret:');
  expect(JSON.stringify(observation)).not.toContain('passwd=');
  expect(JSON.stringify(observation)).not.toContain('api key:');
  expect(JSON.stringify(observation)).not.toContain('api_key=');
  expect(JSON.stringify(observation)).not.toContain('credential:');
  expect(JSON.stringify(observation)).not.toContain('javascript:');
  expect(JSON.stringify(observation)).not.toContain('data:text');
  expect(JSON.stringify(observation)).not.toContain('file:///');
  expect(JSON.stringify(observation)).not.toContain('blob:');
  expect(JSON.stringify(observation)).not.toContain('spectra-secret:');
  expect(JSON.stringify(observation)).not.toContain('file://localhost');
  expect(JSON.stringify(observation)).not.toContain('/home/dave');
  expect(JSON.stringify(observation)).not.toContain('/root/');
  expect(JSON.stringify(observation)).not.toContain('C:\\Users');
  expect(JSON.stringify(observation)).not.toContain('D:/Projects');
  expect(JSON.stringify(observation)).not.toContain('/Users/dave/secrets');
  expect(JSON.stringify(observation)).toContain('[redacted-credential]');
  expect(JSON.stringify(observation)).toContain('[redacted-path]');
  expect(JSON.stringify(observation)).toContain('[redacted-jwt]');
  expect(JSON.stringify(observation)).toContain('[redacted-non-http-url]');
  expect(JSON.stringify(observation)).toContain('API token');
  expect(JSON.stringify(observation)).toContain('/admin/admin.html');
  expect(JSON.stringify(observation)).toContain('/releases/current');
  expect(observation.links.some((link: any) => link.href === 'http://127.0.0.1:3902/admin/next.html')).toBe(true);
  expect(observation.links.some((link: any) => link.href === 'https://example.com/path')).toBe(true);
  expect(observation.links.some((link: any) => link.href === 'https://example.com/home/documentation')).toBe(true);
  expect(observation.links.some((link: any) => link.href === 'https://example.com/admin/admin.html')).toBe(true);
  expect(observation.redactions.fileUrls).toBeGreaterThan(0);
  expect(new TextEncoder().encode(JSON.stringify(observation)).length).toBeLessThanOrEqual(24 * 1024);
  expect(observation.visibleBodyText.length).toBeLessThanOrEqual(6000);
  expect(observation.buttons.some((button: any) => button.label.includes('Disabled Action') && button.disabled === true && button.expanded === true)).toBe(true);
  expect(observation.formLabels.some((field: any) => field.label.includes('API token') && field.redacted === true)).toBe(true);
  expect(observation.formLabels.some((field: any) => field.checked === true || field.selected === true)).toBe(true);
  expect(observation.statusText.some((entry: string) => entry.includes('Fixture status ready'))).toBe(true);
  expect(observation.errorText.some((entry: string) => entry.includes('Fixture visible error'))).toBe(true);
  expect(observation.redactions.formValuesOmitted).toBeGreaterThan(0);

  await expect(page.locator('#console-surface-observation-panel')).toContainText('attachment cleared');
  await page.locator('#console-prompt').fill('Ask again without old evidence.');
  await page.locator('#console-send').click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].input.surfaceObservation).toBeUndefined();
});

test('Surface observation caps oversized packets without carrying form values', async ({ page }) => {
  const requests: Array<Record<string, any>> = [];
  await page.route('**/api/v1/ai/request', async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, any>);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        provider: 'ollama',
        model: 'qwen2.5',
        dataBoundary: 'local',
        response: 'Local answer with capped surface evidence.',
        structuredResponse: null,
        provenance: { routedBy: 'prism-spectra' },
        usage: { tokensIn: 10, tokensOut: 20, cost: 0, latencyMs: 42 },
      }),
    });
  });

  await page.goto('/workbench', { waitUntil: 'load' });
  await page.locator('.nav button[data-view="epk-admin"]').click();

  const adminFrame = page.frameLocator('section[data-section="epk-admin"] iframe');
  await expect(adminFrame.locator('.brand')).toContainText('EPK OS');
  await expect(adminFrame.locator('#canvas')).toBeVisible();
  await page.waitForTimeout(250);
  await adminFrame.locator('body').evaluate((body) => {
    const fixture = document.createElement('section');
    fixture.setAttribute('aria-label', 'Oversized observation fixture');
    const extraButtons = Array.from({ length: 220 }, (_, index) => `<button type="button">Bulk Button ${index}</button>`).join('');
    const extraInputs = Array.from({ length: 220 }, (_, index) => `<label for="bulk-input-${index}">Bulk Input ${index}</label><input id="bulk-input-${index}" value="BULK_INPUT_SECRET_${index}" />`).join('');
    const extraStates = Array.from({ length: 220 }, (_, index) => `<button type="button" aria-pressed="${index % 2 === 0 ? 'true' : 'false'}">State Button ${index}</button>`).join('');
    fixture.innerHTML = `
      <h2>Oversized Observation Fixture</h2>
      <p>${'Visible long text '.repeat(5000)}</p>
      ${extraButtons}
      ${extraInputs}
      ${extraStates}
      <p>Oversized tail text</p>
    `;
    body.replaceChildren(fixture);
  });

  await page.locator('section[data-section="epk-admin"] button[data-surface-action="inspect"]').click();
  await expect(page.locator('section[data-section="epk-admin"] [data-surface-observation-preview]')).toBeVisible();
  await page.locator('section[data-section="epk-admin"] button[data-surface-action="attach"]').click();

  await page.locator('.nav button[data-view="console"]').click();
  await page.locator('#console-prompt').fill('Summarize the capped oversized evidence.');
  await page.locator('#console-send').click();
  await expect(page.locator('#console-status')).toContainText('Response received');

  expect(requests).toHaveLength(1);
  const observation = requests[0].input.surfaceObservation;
  expect(observation.mountId).toBe('epk-admin');
  expect(JSON.stringify(observation)).not.toContain('BULK_INPUT_SECRET_');
  expect(observation.states.length).toBeLessThanOrEqual(160);
  expect(observation.buttons.length).toBeLessThanOrEqual(40);
  expect(observation.formLabels.length).toBeLessThanOrEqual(40);
  expect(new TextEncoder().encode(JSON.stringify(observation)).length).toBeLessThanOrEqual(24 * 1024);
  expect(observation.visibleBodyText.length).toBeLessThanOrEqual(6000);
  expect(JSON.stringify(observation.truncation)).toContain('visibleBodyText');
  expect(observation.redactions.formValuesOmitted).toBeGreaterThan(0);
});

test('Workbench inspects Focus evidence through the same allowlisted handshake', async ({ page }) => {
  await page.goto('/workbench', { waitUntil: 'load' });
  await page.locator('.nav button[data-view="focus"]').click();

  const focusFrame = page.frameLocator('section[data-section="focus"] iframe');
  await expect.poll(() => focusFrame.locator('head').evaluate(() => document.title)).toBe('prism-focus');
  await focusFrame.locator('body').evaluate((body) => {
    const fixture = document.createElement('section');
    fixture.setAttribute('aria-label', 'Focus observation fixture');
    fixture.innerHTML = '<h2>Focus Fixture</h2><button aria-pressed="true">Focus Button</button><div role="status">Focus status ready</div>';
    body.prepend(fixture);
  });

  await page.locator('section[data-section="focus"] button[data-surface-action="inspect"]').click();
  const preview = page.locator('section[data-section="focus"] [data-surface-observation-preview]');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Focus Fixture');
  await expect(preview).toContainText('Focus Button');
  await expect(preview).toContainText('Focus status ready');
});

test('Surface evidence display and attachment stay bound to the source mount', async ({ page }) => {
  await page.route('**/api/v1/shell/mounts', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'epk-admin',
          label: 'Mounted surface - Fake EPK Admin',
          subtitle: 'Fake EPK Admin mount for evidence binding tests.',
          url: 'http://127.0.0.1:3900/fake-epk.html',
        },
        {
          id: 'focus',
          label: 'Mounted surface - Fake Focus',
          subtitle: 'Fake Focus mount for evidence binding tests.',
          url: 'http://127.0.0.1:3900/fake-focus.html',
        },
      ]),
    });
  });
  await page.route('**/fake-focus.html', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: fakeObservationFrame });
  });
  await page.route('**/fake-epk.html', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: fakeObservationFrame });
  });

  await page.goto('/workbench', { waitUntil: 'load' });
  await page.locator('.nav button[data-view="focus"]').click();
  const focusFrame = page.frameLocator('section[data-section="focus"] iframe');
  await expect(focusFrame.locator('h1')).toContainText('Fake Surface');

  await page.locator('section[data-section="focus"] button[data-surface-action="inspect"]').click();
  await expect.poll(() => focusFrame.locator('body').evaluate(() => (window as any).__requestIds.length)).toBeGreaterThanOrEqual(1);
  const focusRequestId = await focusFrame.locator('body').evaluate(() => (window as any).__requestIds[0]);
  await focusFrame.locator('body').evaluate((_body, requestId) => {
    (window as any).__sendObservation(requestId, {
      documentTitle: 'Focus Evidence',
      visibleBodyText: 'FOCUS_BOUND_EVIDENCE',
    });
  }, focusRequestId);
  const focusPreview = page.locator('section[data-section="focus"] [data-surface-observation-preview]');
  await expect(focusPreview).toBeVisible();
  await expect(focusPreview).toContainText('FOCUS_BOUND_EVIDENCE');

  await page.locator('.nav button[data-view="epk-admin"]').click();
  const epkPanel = page.locator('section[data-section="epk-admin"]');
  await expect(epkPanel.locator('[data-surface-observation-preview]')).toHaveCount(0);
  await expect(epkPanel).not.toContainText('FOCUS_BOUND_EVIDENCE');
  await expect(epkPanel.locator('button[data-surface-action="attach"]')).toBeDisabled();

  await epkPanel.locator('button[data-surface-action="inspect"]').click();
  await expect(epkPanel.locator('[data-surface-observation-preview]')).toHaveCount(0);
  await expect(epkPanel.locator('button[data-surface-action="attach"]')).toBeDisabled();
  const epkFrame = page.frameLocator('section[data-section="epk-admin"] iframe');
  await expect.poll(() => epkFrame.locator('body').evaluate(() => (window as any).__requestIds.length)).toBeGreaterThanOrEqual(1);
  const epkRequestId = await epkFrame.locator('body').evaluate(() => (window as any).__requestIds[0]);
  await epkFrame.locator('body').evaluate((_body, requestId) => {
    (window as any).__sendObservation(requestId, {
      documentTitle: 'EPK Evidence',
      visibleBodyText: 'EPK_BOUND_EVIDENCE',
    });
  }, epkRequestId);
  const epkPreview = epkPanel.locator('[data-surface-observation-preview]');
  await expect(epkPreview).toBeVisible();
  await expect(epkPreview).toContainText('EPK_BOUND_EVIDENCE');
  await expect(epkPreview).not.toContainText('FOCUS_BOUND_EVIDENCE');
  await expect(epkPanel.locator('button[data-surface-action="attach"]')).toBeEnabled();
  await epkPanel.locator('button[data-surface-action="attach"]').click();
  await expect(epkPanel).toContainText('attached to next prompt');

  await page.locator('.nav button[data-view="console"]').click();
  await expect(page.locator('#console-surface-observation-panel')).toContainText('Evidence source: Mounted surface - Fake EPK Admin');
  await expect(page.locator('#console-surface-observation-panel')).toContainText('EPK_BOUND_EVIDENCE');
  await expect(page.locator('#console-surface-observation-panel')).not.toContainText('FOCUS_BOUND_EVIDENCE');

  await page.locator('.nav button[data-view="epk-admin"]').click();
  await epkPanel.locator('button[data-surface-action="inspect"]').click();
  await expect(epkPanel.locator('[data-surface-observation-preview]')).toHaveCount(0);
  await expect(epkPanel.locator('button[data-surface-action="attach"]')).toBeDisabled();
  await expect(epkPanel.locator('.surface-observation-head span')).toContainText(/did not respond/);
  await expect(epkPanel.locator('button[data-surface-action="attach"]')).toBeDisabled();
  await page.locator('.nav button[data-view="console"]').click();
  await expect(page.locator('#console-surface-observation-panel')).not.toContainText('EPK_BOUND_EVIDENCE');
});

test('Surface observation ignores stale, duplicate, wrong-source, and wrong-request responses without poisoning the current inspection', async ({ page }) => {
  await page.route('**/api/v1/shell/mounts', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'focus',
          label: 'Mounted surface - Fake Focus',
          subtitle: 'Fake focus mount for observation retry tests.',
          url: 'http://127.0.0.1:3900/fake-surface.html',
        },
      ]),
    });
  });
  await page.route('**/fake-surface.html', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: fakeObservationFrame });
  });

  await page.goto('/workbench', { waitUntil: 'load' });
  await page.locator('.nav button[data-view="focus"]').click();
  const frame = page.frameLocator('section[data-section="focus"] iframe');
  await expect(frame.locator('h1')).toContainText('Fake Surface');

  await page.locator('section[data-section="focus"] button[data-surface-action="inspect"]').click();
  await expect.poll(() => frame.locator('body').evaluate(() => (window as any).__requestIds.length)).toBeGreaterThanOrEqual(1);
  const staleRequestId = await frame.locator('body').evaluate(() => (window as any).__requestIds[0]);

  await page.locator('section[data-section="focus"] button[data-surface-action="inspect"]').click();
  await expect.poll(() => frame.locator('body').evaluate(() => (window as any).__requestIds.length)).toBeGreaterThanOrEqual(2);
  const currentRequestId = await frame.locator('body').evaluate(() => {
    const ids = (window as any).__requestIds as string[];
    return ids[ids.length - 1];
  });
  expect(currentRequestId).not.toBe(staleRequestId);

  await frame.locator('body').evaluate((_body, requestId) => {
    (window as any).__sendObservation(requestId, {
      documentTitle: 'Stale A',
      visibleBodyText: 'STALE_A_EVIDENCE_SHOULD_NOT_DISPLAY',
    });
  }, staleRequestId);
  await expect(page.locator('section[data-section="focus"] [data-surface-observation-preview]')).toHaveCount(0);

  await page.evaluate(() => {
    const iframe = document.createElement('iframe');
    iframe.srcdoc = `<script>
      parent.postMessage({
        type: 'spectra.surface.inspect.response',
        schemaVersion: 'spectra.surfaceObservation.v1',
        requestId: 'wrong-source',
        mountId: 'focus',
        observation: {}
      }, location.origin);
    </script>`;
    document.body.append(iframe);
  });
  await expect(page.locator('section[data-section="focus"] [data-surface-observation-preview]')).toHaveCount(0);

  await frame.locator('body').evaluate((_body, requestId) => {
    parent.postMessage({
      type: 'spectra.surface.inspect.response',
      schemaVersion: 'spectra.surfaceObservation.v1',
      requestId: `wrong-${requestId}`,
      mountId: 'focus',
      observation: {
        schemaVersion: 'spectra.surfaceObservation.v1',
        mountId: 'focus',
        appId: 'focus',
        origin: location.origin,
        path: location.pathname,
        documentTitle: 'Wrong request',
        capturedAt: '2026-07-12T00:00:00.000Z',
        headings: [],
        landmarks: [],
        buttons: [],
        links: [],
        formLabels: [],
        states: [],
        statusText: [],
        errorText: [],
        visibleBodyText: 'WRONG_REQUEST_EVIDENCE_SHOULD_NOT_DISPLAY',
        observerErrors: [],
        unhandledRejections: [],
        truncation: {},
        redactions: {},
      },
    }, location.origin);
  }, currentRequestId);
  await expect(page.locator('section[data-section="focus"] [data-surface-observation-preview]')).toHaveCount(0);

  await frame.locator('body').evaluate((_body, requestId) => {
    (window as any).__sendObservation(requestId, {
      documentTitle: 'Fresh B',
      visibleBodyText: 'FRESH_B_EVIDENCE_SHOULD_DISPLAY',
    });
  }, currentRequestId);
  const preview = page.locator('section[data-section="focus"] [data-surface-observation-preview]');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Fresh B');
  await expect(preview).toContainText('FRESH_B_EVIDENCE_SHOULD_DISPLAY');
  await expect(preview).not.toContainText('STALE_A_EVIDENCE_SHOULD_NOT_DISPLAY');

  await frame.locator('body').evaluate((_body, requestId) => {
    (window as any).__sendObservation(requestId, {
      documentTitle: 'Duplicate B',
      visibleBodyText: 'DUPLICATE_B_EVIDENCE_SHOULD_NOT_REPLACE',
    });
  }, currentRequestId);
  await expect(preview).toContainText('Fresh B');
  await expect(preview).not.toContainText('DUPLICATE_B_EVIDENCE_SHOULD_NOT_REPLACE');
});

test('Surface observation retry attempts remain bounded inside timeout', async ({ page }) => {
  await page.route('**/api/v1/shell/mounts', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'focus',
          label: 'Mounted surface - Silent Focus',
          subtitle: 'Silent focus mount for retry bounds.',
          url: 'http://127.0.0.1:3900/fake-surface.html',
        },
      ]),
    });
  });
  await page.route('**/fake-surface.html', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: fakeObservationFrame });
  });

  await page.goto('/workbench', { waitUntil: 'load' });
  await page.locator('.nav button[data-view="focus"]').click();
  const frame = page.frameLocator('section[data-section="focus"] iframe');
  await expect(frame.locator('h1')).toContainText('Fake Surface');

  await page.locator('section[data-section="focus"] button[data-surface-action="inspect"]').click();
  await expect(page.locator('section[data-section="focus"] .surface-observation-head span')).toContainText(/did not respond/);
  const requestStats = await frame.locator('body').evaluate(() => ({
    total: (window as any).__requests.length,
    unique: (window as any).__requestIds.length,
  }));
  expect(requestStats.unique).toBe(1);
  expect(requestStats.total).toBeLessThanOrEqual(12);
});

test('Surface observer only answers the exact configured Workbench parent origin', async ({ page }) => {
  const rogueParentHtml = `<!doctype html>
    <html><body>
      <iframe src="http://127.0.0.1:3901/"></iframe>
      <script>
        window.__responses = 0;
        window.addEventListener('message', (event) => {
          if (event.data && event.data.type === 'spectra.surface.inspect.response') window.__responses += 1;
        });
        const iframe = document.querySelector('iframe');
        iframe.addEventListener('load', () => {
          iframe.contentWindow.postMessage({
            type: 'spectra.surface.inspect.request',
            schemaVersion: 'spectra.surfaceObservation.v1',
            requestId: 'rogue-parent-request',
            mountId: 'focus',
          }, 'http://127.0.0.1:3901');
        });
      </script>
    </body></html>`;
  await page.route('http://127.0.0.1:8123/rogue-observer-parent.html', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: rogueParentHtml,
    });
  });
  await page.route('http://not-loopback.test/rogue-observer-parent.html', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: rogueParentHtml,
    });
  });

  await page.goto('http://127.0.0.1:8123/rogue-observer-parent.html', { waitUntil: 'load' });
  await page.waitForTimeout(750);
  await expect.poll(() => page.evaluate(() => (window as any).__responses)).toBe(0);

  await page.goto('http://not-loopback.test/rogue-observer-parent.html', { waitUntil: 'load' });
  await page.waitForTimeout(750);
  await expect.poll(() => page.evaluate(() => (window as any).__responses)).toBe(0);
});

test('Surface observation discard removes evidence before any prompt can attach it', async ({ page }) => {
  let requestBody: Record<string, any> | null = null;
  await page.route('**/api/v1/ai/request', async (route) => {
    requestBody = route.request().postDataJSON() as Record<string, any>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        provider: 'ollama',
        model: 'qwen2.5',
        dataBoundary: 'local',
        response: 'No evidence attached.',
        structuredResponse: null,
        provenance: { routedBy: 'prism-spectra' },
        usage: { tokensIn: 1, tokensOut: 2, cost: 0, latencyMs: 3 },
      }),
    });
  });

  await page.goto('/workbench', { waitUntil: 'load' });
  await page.locator('.nav button[data-view="epk-admin"]').click();
  await page.locator('section[data-section="epk-admin"] button[data-surface-action="inspect"]').click();
  await expect(page.locator('section[data-section="epk-admin"] [data-surface-observation-preview]')).toBeVisible();
  await page.locator('section[data-section="epk-admin"] button[data-surface-action="discard"]').click();
  await expect(page.locator('section[data-section="epk-admin"] [data-surface-observation-preview]')).toHaveCount(0);

  await page.locator('.nav button[data-view="console"]').click();
  await page.locator('#console-prompt').fill('Prompt after discard.');
  await page.locator('#console-send').click();
  await expect.poll(() => requestBody !== null).toBe(true);
  const body = requestBody as unknown as Record<string, any>;
  expect(body.input.surfaceObservation).toBeUndefined();
});

test('Surface observation attachment clears after a failed AI request', async ({ page }) => {
  const requests: Array<Record<string, any>> = [];
  await page.route('**/api/v1/ai/request', async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, any>);
    if (requests.length === 1) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'forced failure' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        provider: 'ollama',
        model: 'qwen2.5',
        dataBoundary: 'local',
        response: 'Second request is clean.',
        structuredResponse: null,
        provenance: { routedBy: 'prism-spectra' },
        usage: { tokensIn: 1, tokensOut: 2, cost: 0, latencyMs: 3 },
      }),
    });
  });

  await page.goto('/workbench', { waitUntil: 'load' });
  await page.locator('.nav button[data-view="focus"]').click();
  const focusFrame = page.frameLocator('section[data-section="focus"] iframe');
  await expect.poll(() => focusFrame.locator('head').evaluate(() => document.title)).toBe('prism-focus');
  await page.locator('section[data-section="focus"] button[data-surface-action="inspect"]').click();
  await expect(page.locator('section[data-section="focus"] [data-surface-observation-preview]')).toBeVisible();
  await page.locator('section[data-section="focus"] button[data-surface-action="attach"]').click();

  await page.locator('.nav button[data-view="console"]').click();
  await page.locator('#console-prompt').fill('This request will fail.');
  await page.locator('#console-send').click();
  await expect(page.locator('#console-status')).toContainText('Console degraded');
  expect(requests[0].input.surfaceObservation).toBeTruthy();

  await expect(page.locator('#console-surface-observation-panel')).toContainText('attachment cleared');
  await page.locator('#console-prompt').fill('This request should not inherit evidence.');
  await page.locator('#console-send').click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].input.surfaceObservation).toBeUndefined();
});
