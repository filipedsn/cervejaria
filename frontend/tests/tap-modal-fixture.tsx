import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../src/contexts/AuthContext';
import { AdicionarItensOperacaoModal } from '../src/components/operacao/AdicionarItensOperacaoModal';
import type { ProdutoOperacao } from '../src/lib/operacao';

const products: ProdutoOperacao[] = ['Vinho', 'IPA', 'Pilsen', 'Stout', 'Blend'].map((name, index) => ({
  id: `beer-${name.toLowerCase()}`,
  nome: `Chope ${name}`,
  categoria: 'Chope',
  tipo: 'BEBIDA',
  formato: 'CHOPE',
  precos: [{ volumeMl: 300, preco: 15 + index }, { volumeMl: 473, preco: 22 + index }],
  precoUnit: '0',
  exigePreparo: false,
  controlaEstoque: false,
  ativo: true,
  ordem: index,
}));

function Fixture() {
  const [fixtureProducts, setFixtureProducts] = useState(products);
  useEffect(() => {
    (window as Window & { setTapFixtureProducts?: typeof setFixtureProducts }).setTapFixtureProducts = setFixtureProducts;
    return () => { delete (window as Window & { setTapFixtureProducts?: typeof setFixtureProducts }).setTapFixtureProducts; };
  }, []);
  const onSelecionar = (product: ProdutoOperacao, configuration?: { quantidade?: number; tapId?: string; volumeMl?: number; precoUnit?: number }) => {
    const output = document.getElementById('selection-result');
    if (output) output.textContent = JSON.stringify({ productId: product.id, ...configuration });
  };
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AuthProvider>
    <AdicionarItensOperacaoModal
      open
      onClose={() => undefined}
      pontoVendaId="pdv-tap121-synthetic"
      sessaoCaixaId="shift-tap121-synthetic"
      tapsEnabled
      produtos={fixtureProducts}
      linhas={[]}
      onSelecionar={onSelecionar}
      onAlterar={() => undefined}
      onConfirm={() => undefined}
      isPending={false}
      controlaEstoque={false}
    />
  </AuthProvider></QueryClientProvider>;
}

createRoot(document.getElementById('root')!).render(<><output id="selection-result" aria-live="polite" /><Fixture /></>);
