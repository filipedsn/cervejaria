/** Full TAP-98 release catalog. Missing cases count as not approved. */
export type CasePriority = 'P0' | 'P1' | 'P2';
export type CatalogCase = { id: string; priority: CasePriority; title: string };

export const RELEASE_CATALOG: CatalogCase[] = [
  // SMK — Pré-condições (P0)
  { id: 'SMK-S01', priority: 'P0', title: 'health devolve releaseSha' },
  { id: 'SMK-S02', priority: 'P0', title: 'ready devolve 200' },
  { id: 'SMK-S03', priority: 'P0', title: 'guard recusa alvo de produção' },
  { id: 'SMK-S04', priority: 'P0', title: 'login leva cada persona à tela correta' },
  // AUT
  { id: 'AUT-S01', priority: 'P1', title: 'login e logout' },
  { id: 'AUT-S02', priority: 'P1', title: 'esqueci a senha e redefinição' },
  { id: 'AUT-S03', priority: 'P1', title: '/me reflete papel e permissões' },
  { id: 'AUT-S04', priority: 'P1', title: 'troca de usuário no mesmo dispositivo' },
  { id: 'AUT-X01', priority: 'P1', title: 'credencial errada dá 401' },
  { id: 'AUT-X02', priority: 'P1', title: 'empresa inativa dá 403' },
  { id: 'AUT-X03', priority: 'P1', title: 'rate limit de login' },
  { id: 'AUT-X04', priority: 'P1', title: 'token expirado ou adulterado' },
  { id: 'AUT-X05', priority: 'P1', title: 'ADMIN em rota de empresa' },
  { id: 'AUT-X06', priority: 'P1', title: 'rota inexistente cai no CatchAll' },
  // ADM
  { id: 'ADM-S01', priority: 'P1', title: 'listar, editar, ativar e desativar empresa' },
  { id: 'ADM-S02', priority: 'P0', title: 'empresa provisionada nasce canônica' },
  { id: 'ADM-S03', priority: 'P1', title: 'SMTP de teste' },
  { id: 'ADM-S04', priority: 'P1', title: 'backup executar e baixar' },
  { id: 'ADM-S05', priority: 'P1', title: 'reextrair branding' },
  { id: 'ADM-X01', priority: 'P1', title: 'atendente ou dono em /api/admin dá 403' },
  { id: 'ADM-X02', priority: 'P1', title: 'slug duplicado' },
  { id: 'ADM-X03', priority: 'P1', title: 'textos sem acentuação corrompida' },
  // ONB
  { id: 'ONB-S01', priority: 'P1', title: 'readiness reflete progresso real' },
  { id: 'ONB-S02', priority: 'P1', title: 'wizard não mostra escolha de modo' },
  { id: 'ONB-X01', priority: 'P1', title: 'links e destaques do onboarding existem' },
  // CFG
  { id: 'CFG-S01', priority: 'P1', title: 'grupos do PDV persistem e afetam a operação' },
  { id: 'CFG-S02', priority: 'P1', title: 'aparência (logo, cor, fundo)' },
  { id: 'CFG-S03', priority: 'P1', title: 'mesas' },
  { id: 'CFG-S04', priority: 'P1', title: 'torneiras do PDV' },
  { id: 'CFG-S05', priority: 'P1', title: 'perfil visual da cozinha' },
  { id: 'CFG-X01', priority: 'P1', title: 'atendente em configurações dá 403' },
  { id: 'CFG-X02', priority: 'P1', title: 'tentar EVENTO dá 409' },
  { id: 'CFG-X03', priority: 'P1', title: 'mutação de trailer dá 409' },
  { id: 'CFG-X04', priority: 'P1', title: 'fechar com pedido pendente sem cobrar no lançamento' },
  { id: 'CFG-X05', priority: 'P1', title: 'upload acima de 5 MB ou tipo inválido' },
  { id: 'CFG-X06', priority: 'P1', title: 'desligar cozinha com pedidos ativos dá 409' },
  { id: 'CFG-X07', priority: 'P1', title: 'abas trailers e operacao legadas não aparecem' },
  // RBAC (P0)
  { id: 'RBAC-S01', priority: 'P0', title: 'matriz das 28 chaves concede e revoga' },
  { id: 'RBAC-S02', priority: 'P0', title: 'DONO acessa tudo' },
  { id: 'RBAC-S03', priority: 'P0', title: 'cadastro de funcionário pelo dono' },
  { id: 'RBAC-X01', priority: 'P0', title: 'sem permissão não vê menu e recebe 403' },
  { id: 'RBAC-X02', priority: 'P0', title: 'cancel.delivered só habilita para dono' },
  { id: 'RBAC-X03', priority: 'P0', title: 'e-mail duplicado dá 409' },
  { id: 'RBAC-X04', priority: 'P0', title: 'atendente editando permissões dá 403' },
  { id: 'RBAC-X05', priority: 'P0', title: 'editar permissões de outra empresa dá 404' },
  { id: 'RBAC-X06', priority: 'P0', title: 'alvo não-atendente dá 409' },
  { id: 'RBAC-X07', priority: 'P0', title: 'chaves de evento no canônico' },
  // CAT
  { id: 'CAT-S01', priority: 'P1', title: 'CRUD de produto, opcional e categoria' },
  { id: 'CAT-S02', priority: 'P1', title: 'cardápio salvo criar e ativar' },
  { id: 'CAT-S03', priority: 'P1', title: 'ativar e desativar produto' },
  { id: 'CAT-S04', priority: 'P1', title: 'preço TURNO com catalog.shift.manage' },
  { id: 'CAT-S05', priority: 'P1', title: 'preço TEMPLATE com catalog.manage' },
  { id: 'CAT-X01', priority: 'P1', title: 'sem permissão escritas e tela bloqueadas' },
  { id: 'CAT-X02', priority: 'P1', title: 'TURNO sem permissão dá 403' },
  { id: 'CAT-X03', priority: 'P1', title: 'produto inativo não pode ser vendido' },
  // CXA (P0)
  ...['S01','S02','S03','S04','S05','S06','S07','S08','S09','X01','X02','X03','X04','X05','X06','X07','X08','X09','X10'].map((s) => ({ id: `CXA-${s}`, priority: 'P0' as const, title: `caixa ${s}` })),
  // CMD (P0)
  ...['S01','S02','S03','S04','S05','S06','S07','S08','S09','S10','S11','S12','X01','X02','X03','X04','X05','X06','X07','X08','X09','X10','X11','X12','X13','X14','X15'].map((s) => ({ id: `CMD-${s}`, priority: 'P0' as const, title: `comanda ${s}` })),
  // KDS (P0)
  ...['S01','S02','S03','S04','S05','S06','X01','X02','X03','X04'].map((s) => ({ id: `KDS-${s}`, priority: 'P0' as const, title: `cozinha ${s}` })),
  // EST
  ...['S01','S02','S03','S04','S05','X01','X02','X03','X04','X05','X06'].map((s) => ({ id: `EST-${s}`, priority: 'P1' as const, title: `estoque ${s}` })),
  // POR
  ...['S01','S02','S03','S04','S05','X01','X02','X03','X04','X05'].map((s) => ({ id: `POR-${s}`, priority: 'P1' as const, title: `portal ${s}` })),
  // AGD
  ...['S01','S02','S03','X01','X02','X03','X04'].map((s) => ({ id: `AGD-${s}`, priority: 'P1' as const, title: `agenda ${s}` })),
  // CLI
  ...['S01','S02','X01','X02'].map((s) => ({ id: `CLI-${s}`, priority: 'P1' as const, title: `clientes ${s}` })),
  // DSH (P0 for S01-S03, others P1)
  { id: 'DSH-S01', priority: 'P0', title: 'dashboard KPIs exatos' },
  { id: 'DSH-S02', priority: 'P0', title: 'filtros de mês e ponto' },
  { id: 'DSH-S03', priority: 'P0', title: 'link para resumo do turno' },
  { id: 'DSH-S04', priority: 'P1', title: 'dashboard legado no canônico' },
  { id: 'DSH-S05', priority: 'P1', title: 'ranking e TV no canônico' },
  { id: 'DSH-X01', priority: 'P1', title: 'sem dashboard.read' },
  { id: 'DSH-X02', priority: 'P1', title: 'mês futuro bloqueado' },
  { id: 'DSH-X03', priority: 'P1', title: 'resumo executivo e CSV' },
  // PWA
  ...['S01','S02','S03','S04','S05'].map((s) => ({ id: `PWA-${s}`, priority: 'P1' as const, title: `pwa ${s}` })),
  // SEC (P0)
  ...['X01','X02','X03','X04','X05','X06'].map((s) => ({ id: `SEC-${s}`, priority: 'P0' as const, title: `segurança ${s}` })),
];

export const CATALOG_BY_ID = new Map(RELEASE_CATALOG.map((item) => [item.id, item]));

export function catalogCounts() {
  const by = (p: CasePriority) => RELEASE_CATALOG.filter((item) => item.priority === p);
  return { P0: by('P0').length, P1: by('P1').length, P2: by('P2').length, total: RELEASE_CATALOG.length };
}
