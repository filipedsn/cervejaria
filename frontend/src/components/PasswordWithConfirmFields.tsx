export function validatePasswordPair(
  senha: string,
  confirmar: string,
  opts: { optional?: boolean; minLength?: number } = {},
): string | null {
  const minLength = opts.minLength ?? 6;

  if (opts.optional) {
    if (!senha && !confirmar) return null;
    if (senha && !confirmar) return 'Confirme a senha';
    if (!senha && confirmar) return 'Informe a senha';
  }

  if (senha.length < minLength) {
    return `Senha deve ter no mínimo ${minLength} caracteres`;
  }
  if (senha !== confirmar) {
    return 'As senhas não coincidem';
  }
  return null;
}

interface PasswordWithConfirmFieldsProps {
  senha: string;
  confirmar: string;
  onSenhaChange: (value: string) => void;
  onConfirmarChange: (value: string) => void;
  senhaLabel?: string;
  confirmLabel?: string;
  /** Quando false, senha é opcional (edição). Se preenchida, confirmação é obrigatória. */
  required?: boolean;
  minLength?: number;
  className?: string;
}

export function PasswordWithConfirmFields({
  senha,
  confirmar,
  onSenhaChange,
  onConfirmarChange,
  senhaLabel = 'Senha',
  confirmLabel = 'Confirmar senha',
  required = true,
  minLength = 6,
  className = '',
}: PasswordWithConfirmFieldsProps) {
  return (
    <div className={`space-y-4 ${className}`}>
      <div>
        <label className="label">{senhaLabel}</label>
        <input
          type="password"
          className="input"
          value={senha}
          onChange={(e) => onSenhaChange(e.target.value)}
          required={required}
          minLength={required ? minLength : undefined}
          autoComplete="new-password"
          placeholder={required ? undefined : 'Deixe vazio para manter a senha atual'}
        />
      </div>
      <div>
        <label className="label">{confirmLabel}</label>
        <input
          type="password"
          className="input"
          value={confirmar}
          onChange={(e) => onConfirmarChange(e.target.value)}
          required={required}
          minLength={required ? minLength : undefined}
          autoComplete="new-password"
          placeholder={required ? undefined : 'Repita a nova senha'}
        />
      </div>
    </div>
  );
}
