import { Modal } from './Modal';

export type CardapioSalvoOption = {
  id: string;
  nome: string;
  itemCount?: number;
  produtos?: unknown[];
};

type CardapioSalvoModalProps = {
  open: boolean;
  onClose: () => void;
  value: string;
  onChange: (id: string) => void;
  cardapios: CardapioSalvoOption[] | undefined;
  emptyMessage?: string;
};

function itemCount(cardapio: CardapioSalvoOption) {
  return cardapio.itemCount ?? cardapio.produtos?.length ?? 0;
}

export function cardapioSalvoLabel(
  cardapios: CardapioSalvoOption[] | undefined,
  value: string,
) {
  const cardapio = cardapios?.find((c) => c.id === value);
  if (!cardapio) return null;
  const count = itemCount(cardapio);
  return `${cardapio.nome} · ${count} ${count === 1 ? 'item' : 'itens'}`;
}

export function CardapioSalvoModal({
  open,
  onClose,
  value,
  onChange,
  cardapios,
  emptyMessage = 'Nenhum cardápio cadastrado.',
}: CardapioSalvoModalProps) {
  const list = cardapios ?? [];

  function escolher(id: string) {
    onChange(id);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Escolher cardápio"
      hideHeaderClose
      footer={
        <button type="button" className="touch-btn-secondary w-full" onClick={onClose}>
          Cancelar
        </button>
      }
    >
      {list.length === 0 ? (
        <p className="text-sm text-ink-faint text-center py-6">{emptyMessage}</p>
      ) : (
        <div className="space-y-2" role="radiogroup" aria-label="Cardápio salvo">
          {list.map((cardapio) => {
            const isSelected = value === cardapio.id;
            const count = itemCount(cardapio);
            return (
              <button
                key={cardapio.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                className={`card-touch w-full min-h-[3.5rem] px-4 py-3 text-left transition-colors ${
                  isSelected
                    ? 'border-brand-500 bg-brand-50/40 ring-1 ring-brand-500/35'
                    : 'hover:border-brand-400/30'
                }`}
                onClick={() => escolher(cardapio.id)}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`font-semibold truncate ${isSelected ? 'text-brand-600' : 'text-ink'}`}>
                      {cardapio.nome}
                    </p>
                    <p className="text-xs text-ink-faint mt-0.5">
                      {count} {count === 1 ? 'item' : 'itens'}
                    </p>
                  </div>
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-sm ${
                      isSelected
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : 'border-line bg-surface text-transparent'
                    }`}
                    aria-hidden
                  >
                    ✓
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
