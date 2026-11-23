export type ManualArticle = {
  slug: string;
  title: string;
  group: string;
  summary: string;
};

export const MANUAL_ARTICLES: ManualArticle[] = [
  { slug: 'inicio', title: 'O que é o Quiver Tap', group: 'Começar', summary: 'Visão geral do sistema e do fluxo do dia.' },
  { slug: 'acesso', title: 'Acesso e papéis', group: 'Começar', summary: 'Login, dono e equipe.' },
  { slug: 'configuracao', title: 'Configuração do PDV', group: 'Preparação', summary: 'Equipe, recursos do ponto e aparência.' },
  { slug: 'catalogo', title: 'Catálogo e cardápio', group: 'Preparação', summary: 'Produtos, preços e cardápio do turno.' },
  { slug: 'caixa', title: 'Caixa e turno', group: 'Operação', summary: 'Abrir, acompanhar e fechar o caixa.' },
  { slug: 'comandas', title: 'Comandas e vendas', group: 'Operação', summary: 'Abrir comanda, lançar itens e receber.' },
  { slug: 'cozinha', title: 'Cozinha, bar e TV', group: 'Operação', summary: 'Fila de preparo e tela grande.' },
  { slug: 'estoque', title: 'Estoque', group: 'Operação', summary: 'Controle de saldos quando estiver ligado.' },
  { slug: 'portal', title: 'Portal do cliente', group: 'Cliente', summary: 'QR Code, pedidos e pagamento pelo celular.' },
  { slug: 'agenda-dashboard', title: 'Agenda e dashboard', group: 'Gestão', summary: 'Programação e visão do resultado.' },
  { slug: 'problemas', title: 'Problemas comuns', group: 'Ajuda', summary: 'Checklist do primeiro dia e soluções rápidas.' },
];

export const MANUAL_DEFAULT_SLUG = MANUAL_ARTICLES[0].slug;

export function isManualSlug(value: string | null | undefined): value is string {
  return Boolean(value && MANUAL_ARTICLES.some((article) => article.slug === value));
}
