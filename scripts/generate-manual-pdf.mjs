/**
 * Gera o manual do usuário em PDF com capturas de tela do app.
 * Requer: frontend em http://localhost:5201 e backend em :3001 (seed demo).
 *
 * Uso: node scripts/generate-manual-pdf.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'docs', 'manual');
const SHOTS_DIR = join(OUT_DIR, 'screenshots');
const BASE = process.env.MANUAL_BASE_URL ?? 'http://localhost:5201';
const EMAIL = process.env.MANUAL_EMAIL ?? 'dono@demo.com';
const SENHA = process.env.MANUAL_SENHA ?? '123456';

const VIEWPORT = { width: 390, height: 844 };

mkdirSync(SHOTS_DIR, { recursive: true });

async function shot(page, name) {
  const path = join(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  return path;
}

async function waitApp(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
}

async function login(page) {
  await page.goto(`${BASE}/login`);
  await waitApp(page);
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(SENHA);
  await page.getByRole('button', { name: /entrar/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
  await waitApp(page);
}

async function captureScreenshots() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    locale: 'pt-BR',
  });
  const page = await context.newPage();
  const files = {};

  // Login
  await page.goto(`${BASE}/login`);
  await waitApp(page);
  files.login = await shot(page, '01-login');

  await login(page);

  // Eventos
  await page.goto(`${BASE}/eventos`);
  await waitApp(page);
  files.eventos = await shot(page, '02-eventos');

  const novoBtn = page.getByRole('button', { name: /novo compromisso|cadastrar compromisso/i }).first();
  if (await novoBtn.isVisible().catch(() => false)) {
    await novoBtn.click();
    await page.waitForTimeout(500);
    files.eventosNovo = await shot(page, '03-eventos-novo');
    await page.getByRole('button', { name: '×' }).click().catch(() => page.keyboard.press('Escape'));
    await page.waitForTimeout(300);
  }

  // Criar evento demo para telas operacionais
  await page.goto(`${BASE}/eventos`);
  await waitApp(page);
  const cadastrar = page.getByRole('button', { name: /cadastrar compromisso|novo compromisso/i }).first();
  if (await cadastrar.isVisible().catch(() => false)) {
    await cadastrar.click();
    await page.waitForTimeout(400);
    await page.locator('input').nth(0).fill('Evento Manual — Demo');
    const inputs = page.locator('input');
    const count = await inputs.count();
    for (let i = 0; i < count; i++) {
      const ph = await inputs.nth(i).getAttribute('placeholder');
      if (ph && /local|condomínio|bar/i.test(ph)) {
        await inputs.nth(i).fill('Igarapé');
        break;
      }
    }
    await page.getByRole('button', { name: /salvar|criar|confirmar/i }).last().click();
    await page.waitForTimeout(1200);
  }

  await page.goto(`${BASE}/eventos`);
  await waitApp(page);
  files.eventosAoVivo = await shot(page, '04-eventos-ao-vivo');

  // Comandas
  await page.goto(`${BASE}/comandas`);
  await waitApp(page);
  files.comandas = await shot(page, '05-comandas');

  await page.goto(`${BASE}/comandas/nova`);
  await waitApp(page);
  files.novaComanda = await shot(page, '06-nova-comanda');

  // Criar comanda com item
  await page.locator('input').first().fill('Cliente Demo');
  await page.getByRole('button', { name: /abrir comanda|criar comanda|confirmar/i }).click();
  await page.waitForURL(/\/comandas\//, { timeout: 10000 });
  await waitApp(page);
  files.comandaDetalhe = await shot(page, '07-comanda-detalhe');

  const addItem = page.getByRole('button', { name: /adicionar item/i }).first();
  if (await addItem.isVisible().catch(() => false)) {
    await addItem.click();
    await page.waitForTimeout(600);
    const produto = page.locator('button').filter({ hasText: /pilsen|ipa|weiss|chope/i }).first();
    if (await produto.isVisible().catch(() => false)) {
      await produto.click();
      await page.waitForTimeout(400);
      const confirm = page.getByRole('button', { name: /adicionar|confirmar/i }).last();
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click();
        await page.waitForTimeout(800);
      }
    } else {
      await page.keyboard.press('Escape');
    }
    await waitApp(page);
    files.comandaComItens = await shot(page, '08-comanda-com-itens');
  }

  // Configurações
  for (const [tab, key] of [
    ['catalogo', '09-config-catalogo'],
    ['equipe', '10-config-equipe'],
    ['trailers', '11-config-trailers'],
    ['aparencia', '12-config-aparencia'],
  ]) {
    await page.goto(`${BASE}/configuracoes/${tab}`);
    await waitApp(page);
    files[key] = await shot(page, key);
  }

  // Dashboard
  await page.goto(`${BASE}/dashboard`);
  await waitApp(page);
  files.dashboard = await shot(page, '13-dashboard');

  await browser.close();
  return files;
}

function imgDataUrl(filePath) {
  if (!filePath || !existsSync(filePath)) return '';
  const buf = readFileSync(filePath);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function screenBlock(title, caption, filePath) {
  const src = imgDataUrl(filePath);
  if (!src) return '';
  return `
    <figure class="screen">
      <figcaption><strong>${title}</strong><br>${caption}</figcaption>
      <img src="${src}" alt="${title}" />
    </figure>`;
}

function buildHtml(files) {
  const logoPath = join(ROOT, 'frontend', 'public', 'logo.png');
  const logo = existsSync(logoPath) ? imgDataUrl(logoPath) : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Quiver Tap — Manual do Usuário</title>
  <style>
    @page { margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      color: #111827;
      line-height: 1.55;
      font-size: 11pt;
      margin: 0;
      padding: 0;
    }
    .cover {
      page-break-after: always;
      min-height: 90vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 2rem 1rem;
      background: linear-gradient(180deg, #e6f4f3 0%, #fff 45%);
    }
    .cover img.logo { width: 180px; margin-bottom: 2rem; }
    .cover h1 { font-size: 28pt; color: #004c4c; margin: 0 0 0.5rem; }
    .cover p.sub { font-size: 13pt; color: #6b7280; max-width: 28rem; }
    .cover p.meta { margin-top: 3rem; font-size: 10pt; color: #9ca3af; }
    h2 {
      color: #004c4c;
      font-size: 16pt;
      margin: 1.75rem 0 0.75rem;
      page-break-after: avoid;
    }
    h3 { font-size: 12pt; color: #374151; margin: 1.25rem 0 0.5rem; }
    p, li { margin: 0.4rem 0; }
    ul, ol { padding-left: 1.25rem; }
    .tip {
      background: #eaf8ef;
      border-left: 4px solid #16a34a;
      padding: 0.75rem 1rem;
      margin: 1rem 0;
      border-radius: 0 8px 8px 0;
      font-size: 10pt;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1rem 0;
      font-size: 10pt;
    }
    th, td {
      border: 1px solid #e5e7eb;
      padding: 0.5rem 0.65rem;
      text-align: left;
    }
    th { background: #f3f4f6; }
    figure.screen {
      margin: 1rem 0 1.5rem;
      page-break-inside: avoid;
      text-align: center;
    }
    figure.screen img {
      max-width: 220px;
      width: 100%;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.08);
    }
    figcaption {
      font-size: 9.5pt;
      color: #6b7280;
      margin-bottom: 0.75rem;
      text-align: left;
      max-width: 220px;
      margin-left: auto;
      margin-right: auto;
    }
    .section { page-break-before: always; }
    .section:first-of-type { page-break-before: auto; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    @media print {
      .cover { min-height: 100vh; }
    }
  </style>
</head>
<body>

  <div class="cover">
    ${logo ? `<img class="logo" src="${logo}" alt="Quiver Tap" />` : ''}
    <h1>Quiver Tap</h1>
    <p class="sub">Manual do usuário — primeira experiência com o sistema de comandas para cervejarias móveis</p>
    <p class="meta">Versão gerada em ${new Date().toLocaleDateString('pt-BR')} · Quiver Cloud</p>
  </div>

  <div class="section">
    <h2>1. O que é o Quiver Tap?</h2>
    <p>O Quiver Tap é o aplicativo para gerenciar <strong>eventos</strong>, <strong>comandas</strong> e <strong>vendas</strong> da sua cervejaria móvel. Funciona no celular ou tablet — pensado para o dia a dia na operação.</p>
    <p>Existem dois perfis principais:</p>
    <ul>
      <li><strong>Dono</strong> — configura produtos, equipe, trailers e acompanha relatórios.</li>
      <li><strong>Atendente</strong> — abre comandas, lança consumo e registra pagamentos.</li>
    </ul>

    <h3>Menu inferior</h3>
    <table>
      <tr><th>Ícone</th><th>Função</th></tr>
      <tr><td>Eventos</td><td>Agenda, criar e iniciar eventos</td></tr>
      <tr><td>Comandas</td><td>Operação do dia (abrir, lançar, fechar)</td></tr>
      <tr><td>Dashboard</td><td>Relatórios mensais (somente Dono)</td></tr>
      <tr><td>Config.</td><td>Catálogo, equipe, trailers (somente Dono)</td></tr>
    </table>
  </div>

  <div class="section">
    <h2>2. Acessando o aplicativo</h2>
    <p>Você receberá um <strong>link</strong> e suas <strong>credenciais</strong> (e-mail e senha). No celular, instale como app para melhor experiência:</p>
    <ol>
      <li>Abra o link no <strong>Safari</strong> (iPhone) ou <strong>Chrome</strong> (Android).</li>
      <li><strong>iPhone:</strong> Compartilhar → Adicionar à Tela de Início.</li>
      <li><strong>Android:</strong> Menu → Instalar app / Adicionar à tela inicial.</li>
    </ol>
    <p>Use sempre o <strong>ícone do Quiver Tap</strong> na tela inicial — não o navegador com barra de endereço.</p>

    ${screenBlock('Tela de login', 'Entre com o e-mail e senha fornecidos. Use “Esqueci minha senha” se necessário.', files.login)}

    <div class="tip">Na primeira vez em uma cervejaria nova, o app leva você para <strong>Eventos</strong> — é lá que começa a operação.</div>
  </div>

  <div class="section">
    <h2>3. Configuração inicial (Dono)</h2>
    <p>Antes do primeiro evento, acesse <strong>Config.</strong> e prepare o básico:</p>

    <h3>Catálogo</h3>
    <p>Cadastre chopes, latas, comidas e preços por volume. Sem produtos no catálogo, não é possível lançar itens nas comandas.</p>
    ${screenBlock('Catálogo', 'Cadastre produtos e preços por volume (300 ml, 500 ml…).', files['09-config-catalogo'])}

    <h3>Trailers</h3>
    <p>Se você tem mais de um trailer, cadastre cada um. Com um único trailer, o sistema usa o <strong>Principal</strong> automaticamente.</p>
    ${screenBlock('Trailers', 'Cadastro dos trailers / carretas da cervejaria.', files['11-config-trailers'])}

    <h3>Equipe</h3>
    <p>Convide atendentes com e-mail e senha. Eles acessam o mesmo link, com permissões limitadas à operação.</p>
    ${screenBlock('Equipe', 'Cadastro de atendentes da cervejaria.', files['10-config-equipe'])}

    <h3>Aparência</h3>
    <p>Logo e cores da sua marca no aplicativo.</p>
    ${screenBlock('Aparência', 'Personalização visual da cervejaria.', files['12-config-aparencia'])}
  </div>

  <div class="section">
    <h2>4. Eventos — o coração da operação</h2>
    <p>Toda venda acontece dentro de um <strong>evento</strong> (festa, jogo, feira, condomínio…). Sem evento <em>ao vivo</em>, não abre comanda.</p>

    ${screenBlock('Agenda de eventos', 'Calendário semanal, eventos do dia e próximos compromissos.', files.eventos)}

    <h3>Criar compromisso</h3>
    <ol>
      <li>Toque em <strong>+ Novo compromisso</strong> (ou Cadastrar compromisso, se a agenda estiver vazia).</li>
      <li>Preencha nome, local, data e horário.</li>
      <li>Escolha <strong>Evento avulso</strong> (uma data) ou <strong>Agenda fixa</strong> (ex.: toda sexta).</li>
      <li>Salve.</li>
    </ol>
    ${screenBlock('Novo compromisso', 'Formulário para cadastrar evento avulso ou recorrente.', files.eventosNovo)}

    <h3>Iniciar a sessão</h3>
    <p>No dia do evento, toque em <strong>Iniciar sessão</strong>. O status muda para <strong>Ao vivo</strong> — aí as comandas podem ser abertas.</p>
    ${screenBlock('Evento ao vivo', 'Card verde no topo com atalho “Continuar comandas”.', files.eventosAoVivo)}
  </div>

  <div class="section">
    <h2>5. Comandas — operação do dia</h2>

    ${screenBlock('Painel de comandas', 'Resumo do evento: comandas abertas/fechadas, valores e lista.', files.comandas)}

    <h3>Abrir comanda</h3>
    <ol>
      <li><strong>+ Nova Comanda</strong></li>
      <li>Nome do cliente (o sistema sugere quem já veio antes)</li>
      <li>Telefone opcional — ajuda no ranking e histórico</li>
      <li>Confirme</li>
    </ol>
    ${screenBlock('Nova comanda', 'Cadastro rápido do cliente antes de lançar consumo.', files.novaComanda)}

    <h3>Lançar itens</h3>
    <p>Dentro da comanda, toque em <strong>+ Adicionar item</strong>, escolha produto, volume e quantidade. Para chope, selecione o tap correto.</p>
    ${screenBlock('Comanda aberta', 'Detalhe da comanda com itens e total atualizado.', files.comandaComItens || files.comandaDetalhe)}

    <h3>Fechar comanda</h3>
    <ol>
      <li>Toque em <strong>Fechar comanda</strong></li>
      <li>Informe PIX, Dinheiro ou Cartão (débito/crédito)</li>
      <li>Pode dividir em mais de uma forma de pagamento</li>
      <li>Confirme quando o valor informado bater com o total</li>
    </ol>

    <h3>Encerrar o evento</h3>
    <p>No fim da noite, role até o final da tela de Comandas e toque em <strong>Encerrar evento</strong>. Todas as comandas precisam estar fechadas antes. Depois, confira o <strong>Resumo executivo</strong>.</p>
  </div>

  <div class="section">
    <h2>6. Atendente</h2>
    <p>O atendente não acessa Configurações nem Dashboard. O fluxo é:</p>
    <ol>
      <li>Login com e-mail cadastrado pelo dono</li>
      <li>Se houver mais de um trailer, escolher onde trabalhar</li>
      <li>Com evento ao vivo → operar em <strong>Comandas</strong></li>
      <li>Sem evento ao vivo → aguardar o dono iniciar a sessão em Eventos</li>
    </ol>
    <p>Para trocar de trailer: menu da conta (avatar) → <strong>Trocar trailer</strong>.</p>
  </div>

  <div class="section">
    <h2>7. Dashboard e pós-evento</h2>
    <p>Em <strong>Dashboard</strong>, o dono vê receita do mês, gráficos por dia e formas de pagamento. Filtre por trailer se tiver mais de um.</p>
    ${screenBlock('Dashboard', 'Visão gerencial mensal da cervejaria.', files.dashboard)}
  </div>

  <div class="section">
    <h2>8. Primeiro teste sugerido (30–45 min)</h2>
    <ol>
      <li>Cadastre 2–3 produtos no catálogo</li>
      <li>Crie um evento para hoje e inicie a sessão</li>
      <li>Monte os taps com os chopes do dia</li>
      <li>Abra 2 comandas de teste e lance itens</li>
      <li>Feche as comandas com formas de pagamento diferentes</li>
      <li>Encerre o evento e veja o resumo</li>
    </ol>

    <h3>Problemas comuns</h3>
    <table>
      <tr><th>Situação</th><th>Solução</th></tr>
      <tr><td>Não abre comanda</td><td>Verifique se o evento está <strong>Ao vivo</strong></td></tr>
      <tr><td>Não encerra evento</td><td>Feche todas as comandas abertas</td></tr>
      <tr><td>Lista de produtos vazia</td><td>Cadastre em Config. → Catálogo</td></tr>
      <tr><td>Atendente sem operação</td><td>Dono deve iniciar a sessão do dia</td></tr>
    </table>

    <p style="margin-top:2rem;color:#6b7280;font-size:10pt;text-align:center;">
      Dúvidas? Entre em contato com o administrador Quiver Cloud.<br>
      contato@quivercloud.com.br
    </p>
  </div>

</body>
</html>`;
}

async function main() {
  console.log('Capturando telas em', BASE, '…');
  const files = await captureScreenshots();
  console.log('Montando HTML…');
  const html = buildHtml(files);
  const htmlPath = join(OUT_DIR, 'manual.html');
  writeFileSync(htmlPath, html, 'utf8');

  console.log('Gerando PDF…');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle' });
  const pdfPath = join(OUT_DIR, 'Quiver-Tap-Manual-Usuario.pdf');
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
  });
  await browser.close();

  console.log('');
  console.log('Manual gerado com sucesso:');
  console.log(' ', pdfPath);
  console.log('Capturas em:', SHOTS_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
