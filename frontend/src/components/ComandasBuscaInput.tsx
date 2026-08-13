interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function ComandasBuscaInput({ value, onChange }: Props) {
  return (
    <input
      type="search"
      className="input w-full"
      placeholder="Buscar por nome ou número..."
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Buscar comandas"
      autoComplete="off"
    />
  );
}
