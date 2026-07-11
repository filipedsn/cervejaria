import type { InputHTMLAttributes } from 'react';
import { formatCurrencyInput } from '../lib/currency';

type CurrencyInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onChange: (value: string) => void;
};

export function CurrencyInput({ value, onChange, className, placeholder, ...props }: CurrencyInputProps) {
  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      className={className ?? 'input'}
      value={value}
      placeholder={placeholder ?? 'R$ 0,00'}
      onChange={(e) => onChange(formatCurrencyInput(e.target.value))}
    />
  );
}
