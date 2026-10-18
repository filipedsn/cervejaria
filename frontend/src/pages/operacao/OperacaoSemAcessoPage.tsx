export function OperacaoSemAcessoPage() {
  return (
    <div className="card mx-auto max-w-lg space-y-2 text-center" role="alert" data-testid="operacao-sem-acesso">
      <h1 className="text-xl font-bold text-ink">Seu usuário ainda não tem acesso à operação</h1>
      <p className="text-sm text-ink-muted">
        Para usar comandas, cozinha, caixa ou estoque, peça ao responsável pela empresa para liberar as permissões em Configurações › Equipe.
      </p>
    </div>
  );
}
