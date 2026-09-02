interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function ComandasBuscaInput({
  value,
  onChange,
  placeholder = 'Buscar comanda...',
}: Props) {
  return (
    <input
      type="search"
      className="input w-full"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Buscar comandas"
      autoComplete="off"
    />
  );
}
