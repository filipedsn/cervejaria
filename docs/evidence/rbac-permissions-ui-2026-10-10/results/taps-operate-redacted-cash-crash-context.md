# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: operational-session.spec.ts >> event.taps.operate mounts a chope only while the permission is granted
- Location: e2e\rbac-live\operational-session.spec.ts:1219:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: /Taps do evento/ })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('button', { name: /Taps do evento/ })

```

```yaml
- alert:
  - paragraph: Algo deu errado nesta tela.
  - paragraph: Recarregue a página ou volte ao menu.
  - button "Recarregar"
```

# Test source

```ts
  1143 | 
  1144 |   await setEventStaffPermissions(['command.read']);
  1145 |   await staff.reload();
  1146 |   expect((await (await staffContext.request.get('/api/auth/me')).json()).usuario.permissoesOperacao).toEqual(['command.read']);
  1147 |   await expect(cashPanel.getByRole('button', { name: 'Abrir caixa', exact: true })).toHaveCount(0);
  1148 |   const revoked = await staffContext.request.post(openingUrl, { data: { trocoInicial: 12.34 } });
  1149 |   expect([401, 403]).toContain(revoked.status());
  1150 |   expect(await (await ownerContext.request.get(cashUrl)).json()).toEqual(ownerCashAfterGrant);
  1151 |   const commandAccessAfterRevoke = await staffContext.request.get(`/api/comandas/evento/${eventMenuEventId}?status=ABERTA`);
  1152 |   expect(commandAccessAfterRevoke.status(), await commandAccessAfterRevoke.text()).toBe(200);
  1153 |   console.log('RBAC_LIVE_REGRESSION key=cash.open; dependency=command.read retained; disabled=button-hidden-api-denied-no-session; enabled=real-ui-opens-session-with-exact-float-and-redacted-response; revoked=same-session-button-hidden-api-denied-session-unchanged; event-mode=LEGACY; result=PASS');
  1154 |   await Promise.all([ownerContext.close(), staffContext.close()]);
  1155 | });
  1156 | 
  1157 | test('event.cash.close requires both close and value access and denies after revoke', async ({ browser }) => {
  1158 |   const ownerContext = await browser.newContext();
  1159 |   const owner = await ownerContext.newPage();
  1160 |   await ownerContext.addCookies([{ name: 'token', value: eventMenuOwnerCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  1161 |   await owner.goto('/eventos');
  1162 |   const eventId = eventMenuEventId;
  1163 |   const cashUrl = `/api/eventos/${eventId}/caixa`;
  1164 |   const closeUrl = `${cashUrl}/fechar`;
  1165 |   const permissionApiForEventStaff = `/api/usuarios/${eventMenuStaffId}/permissoes-operacao`;
  1166 |   const setEventStaffPermissions = async (permissoesOperacao: string[]) => {
  1167 |     const response = await ownerContext.request.patch(permissionApiForEventStaff, { data: { permissoesOperacao } });
  1168 |     expect(response.status(), await response.text()).toBe(200);
  1169 |   };
  1170 |   const closingBody = { contadoDinheiro: 45.67, contadoPix: 0, contadoDebito: 0, contadoCredito: 0, contadoCartao: 0 };
  1171 |   const initialCashResponse = await ownerContext.request.get(cashUrl);
  1172 |   expect(initialCashResponse.status(), await initialCashResponse.text()).toBe(200);
  1173 |   const initialCash = await initialCashResponse.json();
  1174 |   expect(initialCash).toMatchObject({ aberto: true, caixa: { status: 'ABERTO' } });
  1175 |   const firstSessionId = initialCash.caixa.id;
  1176 |   await setEventStaffPermissions(['command.read', 'cash.values.read']);
  1177 | 
  1178 |   const staffContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  1179 |   const staff = await staffContext.newPage();
  1180 |   await staffContext.addCookies([{ name: 'token', value: eventMenuStaffCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  1181 |   await staff.goto('/comandas');
  1182 |   const cashPanel = staff.getByRole('region', { name: 'Caixa do evento' });
  1183 |   await expect(cashPanel).toBeVisible();
  1184 |   await expect(cashPanel.getByRole('button', { name: 'Conferir e fechar caixa' })).toHaveCount(0);
  1185 |   const denied = await staffContext.request.post(closeUrl, { data: closingBody });
  1186 |   expect([401, 403]).toContain(denied.status());
  1187 |   expect(await (await ownerContext.request.get(cashUrl)).json()).toEqual(initialCash);
  1188 | 
  1189 |   await setEventStaffPermissions(['command.read', 'cash.values.read', 'cash.close']);
  1190 |   await staff.reload();
  1191 |   expect((await (await staffContext.request.get('/api/auth/me')).json()).usuario.permissoesOperacao)
  1192 |     .toEqual(['command.read', 'cash.values.read', 'cash.close']);
  1193 |   const closeButton = cashPanel.getByRole('button', { name: 'Conferir e fechar caixa' });
  1194 |   await expect(closeButton).toBeVisible();
  1195 |   await expect(closeButton).toBeEnabled();
  1196 |   await closeButton.click();
  1197 |   await expect(staff.getByRole('heading', { name: 'Conferir caixa do evento' })).toBeVisible();
  1198 |   const closeResponsePromise = staff.waitForResponse((response) => new URL(response.url()).pathname === closeUrl && response.request().method() === 'POST');
  1199 |   await staff.getByRole('button', { name: 'Confirmar fechamento' }).click();
  1200 |   const closed = await closeResponsePromise;
  1201 |   expect(closed.status(), await closed.text()).toBe(200);
  1202 |   expect(await (await ownerContext.request.get(cashUrl)).json()).toMatchObject({ aberto: false, caixa: { id: firstSessionId, status: 'FECHADO' } });
  1203 | 
  1204 |   const reopened = await ownerContext.request.post(`${cashUrl}/abrir`, { data: { trocoInicial: 12.34 } });
  1205 |   expect(reopened.status(), await reopened.text()).toBe(201);
  1206 |   const secondSession = await (await ownerContext.request.get(cashUrl)).json();
  1207 |   expect(secondSession).toMatchObject({ aberto: true, caixa: { status: 'ABERTO' } });
  1208 |   expect(secondSession.caixa.id).not.toBe(firstSessionId);
  1209 |   await setEventStaffPermissions(['command.read', 'cash.values.read']);
  1210 |   await staff.reload();
  1211 |   await expect(cashPanel.getByRole('button', { name: 'Conferir e fechar caixa' })).toHaveCount(0);
  1212 |   const revoked = await staffContext.request.post(closeUrl, { data: closingBody });
  1213 |   expect([401, 403]).toContain(revoked.status());
  1214 |   expect(await (await ownerContext.request.get(cashUrl)).json()).toEqual(secondSession);
  1215 |   console.log('RBAC_LIVE_REGRESSION key=cash.close; dependencies=cash.values.read+command.read retained; disabled=close-hidden-api-denied-session-unchanged; enabled=real-ui-close-persisted; revoked=same-session-close-hidden-api-denied-session-unchanged; event-mode=LEGACY; result=PASS');
  1216 |   await Promise.all([ownerContext.close(), staffContext.close()]);
  1217 | });
  1218 | 
  1219 | test('event.taps.operate mounts a chope only while the permission is granted', async ({ browser }) => {
  1220 |   const ownerContext = await browser.newContext();
  1221 |   const owner = await ownerContext.newPage();
  1222 |   await ownerContext.addCookies([{ name: 'token', value: eventMenuOwnerCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  1223 |   await owner.goto('/eventos');
  1224 |   const tapId = process.env.RBAC_QA_EVENT_TAP_ID!;
  1225 |   const chopeId = process.env.RBAC_QA_EVENT_TAP_CHOPE_ID!;
  1226 |   const tapUrl = `/api/eventos/${eventMenuEventId}/taps/${tapId}/chope`;
  1227 |   const permissionApiForEventStaff = `/api/usuarios/${eventMenuStaffId}/permissoes-operacao`;
  1228 |   const setEventStaffPermissions = async (permissoesOperacao: string[]) => {
  1229 |     const response = await ownerContext.request.patch(permissionApiForEventStaff, { data: { permissoesOperacao } });
  1230 |     expect(response.status(), await response.text()).toBe(200);
  1231 |   };
  1232 |   await setEventStaffPermissions(['command.read']);
  1233 |   const staffContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  1234 |   const staff = await staffContext.newPage();
  1235 |   await staffContext.addCookies([{ name: 'token', value: eventMenuStaffCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  1236 |   await staff.goto('/eventos');
  1237 |   const eventCard = staff.locator('.card').filter({ hasText: eventMenuEventName }).first();
  1238 |   await expect(eventCard).toBeVisible();
  1239 |   await eventCard.getByRole('button', { name: 'Comandas', exact: true }).click();
  1240 |   await expect.poll(() => new URL(staff.url()).pathname).toBe('/comandas');
  1241 |   await expect(staff.getByRole('heading', { name: 'Comandas', exact: true })).toBeVisible();
  1242 |   const tapsTrigger = staff.getByRole('button', { name: /Taps do evento/ });
> 1243 |   await expect(tapsTrigger).toBeVisible();
       |                             ^ Error: expect(locator).toBeVisible() failed
  1244 |   await tapsTrigger.click();
  1245 |   let dialog = staff.getByRole('dialog');
  1246 |   await expect(dialog.getByText('Você precisa da permissão “Montar e operar Taps” para alterar esta montagem.')).toBeVisible();
  1247 |   await expect(dialog.getByRole('button', { name: /TAP 9902/ })).toHaveCount(0);
  1248 |   const denied = await staffContext.request.put(tapUrl, { data: { produtoId: chopeId } });
  1249 |   expect([401, 403]).toContain(denied.status());
  1250 |   const before = await ownerContext.request.get(`/api/eventos/${eventMenuEventId}/taps`);
  1251 |   expect(before.status()).toBe(200);
  1252 |   expect((await before.json()).find((tap: { id: string }) => tap.id === tapId).chopeAtual).toBeNull();
  1253 |   await dialog.getByRole('button', { name: /Fechar|Cancelar/ }).first().click();
  1254 | 
  1255 |   await setEventStaffPermissions(['command.read', 'taps.operate']);
  1256 |   await staff.reload();
  1257 |   await tapsTrigger.click();
  1258 |   dialog = staff.getByRole('dialog');
  1259 |   const tapButton = dialog.getByRole('button', { name: /TAP 9902/ });
  1260 |   await expect(tapButton).toBeVisible();
  1261 |   await tapButton.click();
  1262 |   await dialog.getByRole('button', { name: 'Posicionar chope' }).click();
  1263 |   await dialog.getByLabel('Chope').selectOption(chopeId);
  1264 |   const mountResponsePromise = staff.waitForResponse((response) => new URL(response.url()).pathname === tapUrl && response.request().method() === 'PUT');
  1265 |   await dialog.getByRole('button', { name: 'Posicionar', exact: true }).click();
  1266 |   const mounted = await mountResponsePromise;
  1267 |   expect(mounted.status(), await mounted.text()).toBe(200);
  1268 |   expect((await (await ownerContext.request.get(`/api/eventos/${eventMenuEventId}/taps`)).json()).find((tap: { id: string }) => tap.id === tapId).chopeAtual.id).toBe(chopeId);
  1269 | 
  1270 |   await setEventStaffPermissions(['command.read']);
  1271 |   await staff.reload();
  1272 |   await tapsTrigger.click();
  1273 |   dialog = staff.getByRole('dialog');
  1274 |   await expect(dialog.getByText('Você precisa da permissão “Montar e operar Taps” para alterar esta montagem.')).toBeVisible();
  1275 |   await expect(dialog.getByRole('button', { name: /TAP 9902/ })).toHaveCount(0);
  1276 |   const revoked = await staffContext.request.put(tapUrl, { data: { produtoId: chopeId } });
  1277 |   expect([401, 403]).toContain(revoked.status());
  1278 |   const afterRevoke = await ownerContext.request.get(`/api/eventos/${eventMenuEventId}/taps`);
  1279 |   expect((await afterRevoke.json()).find((tap: { id: string }) => tap.id === tapId).chopeAtual.id).toBe(chopeId);
  1280 |   console.log('RBAC_LIVE_REGRESSION key=taps.operate; dependency=command.read and tapsEnabled legacy setting; disabled=grid-read-only-api-denied-no-mount; enabled=real-ui-mount-persisted; revoked=same-session-grid-read-only-api-denied-mount-unchanged; event-mode=LEGACY; result=PASS');
  1281 |   await Promise.all([ownerContext.close(), staffContext.close()]);
  1282 | });
  1283 | 
```