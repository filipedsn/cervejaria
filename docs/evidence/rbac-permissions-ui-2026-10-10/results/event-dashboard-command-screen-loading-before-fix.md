# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: operational-session.spec.ts >> event.dashboard.read reveals and revokes event KPIs without changing command access
- Location: e2e\rbac-live\operational-session.spec.ts:1029:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'Comandas', exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('heading', { name: 'Comandas', exact: true })

```

```yaml
- banner:
  - text: 🍺
  - paragraph: Other permission QA c6f8ab74954d
  - button "Abrir conta": QE
  - link "Voltar para lista de eventos":
    - /url: /eventos
    - text: Eventos
  - text: Ao vivo
  - paragraph: Foreign event QA c6f8ab74954d·QA·10/10/2026 · 18:00
  - link "Ver ranking":
    - /url: /ranking/cmv2nlyvj000phv0wgk0q6die
  - button "Taps do evento (0/4)"
  - button "Ver QR Code"
- main: Carregando...
- navigation "Navegação principal":
  - link "Cardápio":
    - /url: /operacao/catalogo
  - link "Eventos":
    - /url: /eventos
  - link "Comandas":
    - /url: /comandas
```

# Test source

```ts
  966  |   const ownerTenantId = (await ownerMe.json()).cervejaria.id;
  967  |   const menuUrl = `/api/eventos/${eventMenuEventId}/cardapio`;
  968  |   const beforeResponse = await ownerContext.request.get(menuUrl);
  969  |   expect(beforeResponse.status(), await beforeResponse.text()).toBe(200);
  970  |   const before = await beforeResponse.json();
  971  |   expect(before.produtoIds).toEqual([]);
  972  |   const adminUrl = `/api/usuarios/${eventMenuStaffId}/permissoes-operacao`;
  973  |   const setMenuPermissions = async (permissoesOperacao: string[]) => {
  974  |     const response = await ownerContext.request.patch(adminUrl, { data: { permissoesOperacao } });
  975  |     expect(response.status(), await response.text()).toBe(200);
  976  |   };
  977  |   await setMenuPermissions([]);
  978  | 
  979  |   const staffContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  980  |   const staff = await staffContext.newPage();
  981  |   await staffContext.addCookies([{ name: 'token', value: eventMenuStaffCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  982  |   const modeContext = await staffContext.request.get('/api/operacao/contexto');
  983  |   expect(modeContext.status(), await modeContext.text()).toBe(200);
  984  |   const mode = await modeContext.json();
  985  |   expect(mode.operationMode).toBe('EVENTO');
  986  |   expect(mode.operationalSettingsSource).toBe('LEGACY');
  987  |   await staff.goto('/eventos');
  988  |   const disabledStaffMe = await (await staffContext.request.get('/api/auth/me')).json();
  989  |   expect(disabledStaffMe.usuario.permissoesOperacao).toEqual([]);
  990  |   expect(disabledStaffMe.cervejaria.id).toBe(ownerTenantId);
  991  |   const eventCard = staff.locator('.card').filter({ hasText: eventMenuEventName }).first();
  992  |   await expect(eventCard).toBeVisible();
  993  |   await expect(eventCard.locator('button[aria-label*="card"]')).toHaveCount(0);
  994  |   const denied = await staffContext.request.put(menuUrl, { data: { produtoIds: [eventMenuForeignProductId] } });
  995  |   expect([401, 403]).toContain(denied.status());
  996  |   expect(await (await ownerContext.request.get(menuUrl)).json()).toEqual(before);
  997  | 
  998  |   await setMenuPermissions(['event.menu.manage']);
  999  |   await staff.reload();
  1000 |   expect((await (await staffContext.request.get('/api/auth/me')).json()).usuario.permissoesOperacao).toEqual(['event.menu.manage']);
  1001 |   const grantedCard = staff.locator('.card').filter({ hasText: eventMenuEventName }).first();
  1002 |   const editorButton = grantedCard.locator('button[aria-label*="card"]');
  1003 |   await expect(editorButton).toHaveCount(1);
  1004 |   await editorButton.click();
  1005 |   const dialog = staff.getByRole('dialog');
  1006 |   await expect(dialog).toBeVisible();
  1007 |   await dialog.getByRole('button', { name: /Montar manual/ }).click();
  1008 |   await expect(dialog.getByText(eventMenuForeignProductName, { exact: true })).toBeVisible();
  1009 |   await dialog.locator('label').filter({ hasText: eventMenuForeignProductName }).locator('input[type="checkbox"]').check();
  1010 |   const savePromise = staff.waitForResponse((response) => new URL(response.url()).pathname === menuUrl && response.request().method() === 'PUT');
  1011 |   await dialog.getByRole('button', { name: /Salvar card/ }).click();
  1012 |   const saved = await savePromise;
  1013 |   expect(saved.status(), await saved.text()).toBe(200);
  1014 |   const afterGrant = await (await ownerContext.request.get(menuUrl)).json();
  1015 |   expect(afterGrant.produtoIds).toEqual([eventMenuForeignProductId]);
  1016 |   expect(afterGrant.produtos.map((produto: { id: string }) => produto.id)).toEqual([eventMenuForeignProductId]);
  1017 | 
  1018 |   await setMenuPermissions([]);
  1019 |   await staff.reload();
  1020 |   const revokedCard = staff.locator('.card').filter({ hasText: eventMenuEventName }).first();
  1021 |   await expect(revokedCard.locator('button[aria-label*="card"]')).toHaveCount(0);
  1022 |   const revoked = await staffContext.request.put(menuUrl, { data: { produtoIds: [] } });
  1023 |   expect([401, 403]).toContain(revoked.status());
  1024 |   expect(await (await ownerContext.request.get(menuUrl)).json()).toEqual(afterGrant);
  1025 |   console.log('RBAC_LIVE_REGRESSION key=event.menu.manage; dependency=none; disabled=editor-hidden-and-direct-write-denied-no-mutation; enabled=real-ui-menu-change-persisted; revoked=same-session-editor-hidden-and-direct-write-denied; event-mode=LEGACY; result=PASS');
  1026 |   await Promise.all([ownerContext.close(), staffContext.close()]);
  1027 | });
  1028 | 
  1029 | test('event.dashboard.read reveals and revokes event KPIs without changing command access', async ({ browser }) => {
  1030 |   const ownerContext = await browser.newContext();
  1031 |   const owner = await ownerContext.newPage();
  1032 |   await ownerContext.addCookies([{ name: 'token', value: eventMenuOwnerCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  1033 |   await owner.goto('/eventos');
  1034 |   const permissionApiForEventStaff = `/api/usuarios/${eventMenuStaffId}/permissoes-operacao`;
  1035 |   const setEventStaffPermissions = async (permissoesOperacao: string[]) => {
  1036 |     const response = await ownerContext.request.patch(permissionApiForEventStaff, { data: { permissoesOperacao } });
  1037 |     expect(response.status(), await response.text()).toBe(200);
  1038 |   };
  1039 |   const dashboardUrl = `/api/eventos/${eventMenuEventId}/dashboard`;
  1040 |   const baselineResponse = await ownerContext.request.get(dashboardUrl);
  1041 |   expect(baselineResponse.status(), await baselineResponse.text()).toBe(200);
  1042 |   const baseline = await baselineResponse.json();
  1043 |   await setEventStaffPermissions(['command.read']);
  1044 | 
  1045 |   const staffContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  1046 |   const staff = await staffContext.newPage();
  1047 |   await staffContext.addCookies([{ name: 'token', value: eventMenuStaffCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  1048 |   const modeResponse = await staffContext.request.get('/api/operacao/contexto');
  1049 |   expect(modeResponse.status(), await modeResponse.text()).toBe(200);
  1050 |   const mode = await modeResponse.json();
  1051 |   expect(mode.operationMode).toBe('EVENTO');
  1052 |   expect(mode.operationalSettingsSource).toBe('LEGACY');
  1053 |   const disabledMe = await (await staffContext.request.get('/api/auth/me')).json();
  1054 |   expect(disabledMe.usuario.permissoesOperacao).toEqual(['command.read']);
  1055 |   const deniedDashboard = await staffContext.request.get(dashboardUrl);
  1056 |   expect([401, 403]).toContain(deniedDashboard.status());
  1057 |   const disabledCommands = await staffContext.request.get(`/api/comandas/evento/${eventMenuEventId}?status=ABERTA`);
  1058 |   expect(disabledCommands.status(), await disabledCommands.text()).toBe(200);
  1059 |   await staff.goto('/eventos');
  1060 |   await expect.poll(() => new URL(staff.url()).pathname).toBe('/eventos');
  1061 |   const eventCard = staff.locator('.card').filter({ hasText: eventMenuEventName }).first();
  1062 |   await expect(eventCard.getByText('Comandas abertas', { exact: true })).toHaveCount(0);
  1063 |   const openCommandsValue = () => eventCard.getByText('Comandas abertas', { exact: true }).locator('..').locator('p').nth(1);
  1064 |   await staff.goto('/comandas');
  1065 |   await expect.poll(() => new URL(staff.url()).pathname).toBe('/comandas');
> 1066 |   await expect(staff.getByRole('heading', { name: 'Comandas', exact: true })).toBeVisible();
       |                                                                               ^ Error: expect(locator).toBeVisible() failed
  1067 |   await expect(staff.locator('.metric-card').filter({ hasText: 'Comandas abertas' })).toHaveCount(0);
  1068 |   await staff.goto('/eventos');
  1069 | 
  1070 |   await setEventStaffPermissions(['command.read', 'event.dashboard.read']);
  1071 |   await staff.reload();
  1072 |   expect((await (await staffContext.request.get('/api/auth/me')).json()).usuario.permissoesOperacao).toEqual(['command.read', 'event.dashboard.read']);
  1073 |   const grantedDashboard = await staffContext.request.get(dashboardUrl);
  1074 |   expect(grantedDashboard.status(), await grantedDashboard.text()).toBe(200);
  1075 |   const grantedProjection = await grantedDashboard.json();
  1076 |   expect(grantedProjection).toEqual(baseline);
  1077 |   await expect(eventCard.getByText('Comandas abertas', { exact: true })).toBeVisible();
  1078 |   await expect(openCommandsValue()).toHaveText(String(baseline.resumo.comandasAbertas));
  1079 | 
  1080 |   await setEventStaffPermissions(['command.read']);
  1081 |   await staff.reload();
  1082 |   const revokedDashboard = await staffContext.request.get(dashboardUrl);
  1083 |   expect([401, 403]).toContain(revokedDashboard.status());
  1084 |   const commandAccessAfterRevoke = await staffContext.request.get(`/api/comandas/evento/${eventMenuEventId}?status=ABERTA`);
  1085 |   expect(commandAccessAfterRevoke.status(), await commandAccessAfterRevoke.text()).toBe(200);
  1086 |   await expect(eventCard.getByText('Comandas abertas', { exact: true })).toHaveCount(0);
  1087 |   await staff.goto('/comandas');
  1088 |   await expect.poll(() => new URL(staff.url()).pathname).toBe('/comandas');
  1089 |   await expect(staff.getByRole('heading', { name: 'Comandas', exact: true })).toBeVisible();
  1090 |   await expect(staff.locator('.metric-card').filter({ hasText: 'Comandas abertas' })).toHaveCount(0);
  1091 |   console.log('RBAC_LIVE_REGRESSION key=event.dashboard.read; dependency=command.read retained; disabled=event-dashboard-api-denied-kpis-hidden-command-read-works; enabled=event-kpis-visible-and-api-projection-matches-owner; revoked=same-session-kpis-hidden-dashboard-denied-command-read-remains; event-mode=LEGACY; result=PASS');
  1092 |   await Promise.all([ownerContext.close(), staffContext.close()]);
  1093 | });
  1094 | 
```