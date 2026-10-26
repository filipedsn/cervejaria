# Recuperacao manual apos migration de producao

`deploy/runtime/deploy-recovery.json` existe somente quando um deploy falhou depois
de iniciar uma migration pelo deploy Windows legado. Enquanto ele existir,
`deploy.pause` mantem o watchdog bloqueado. Producao publica roda no VPS; la a
recuperacao segue `docs/handoff-vps-hostinger-arquiteto.md` §7.1.G.

Comece sempre por:

```powershell
npm.cmd run prod:status
```

Preserve `deploy-recovery.json`, `deploy.pause`, o backup informado no arquivo e os
logs de deploy. Nao use rollback automatico de banco: ele nao existe.

## Caso A — migration nao iniciou

Esse caso nao cria recovery critico. Corrija a causa de preflight, backup, build ou
staging e retome a operacao normalmente. Se houver um arquivo de recovery, trate-o
como Caso C ate entender sua origem.

## Caso B — migration comprovadamente backward-compatible

Verifique no `deploy-recovery.json` a fase, os commits, o backup e se a migration
terminou. Um responsavel deve confirmar explicitamente que a release anterior pode
operar sobre o schema atual. Esta confirmacao nao e automatizada e este projeto nao
oferece bypass generico para `prisma migrate status`.

Depois de validar banco, artefatos e a decisao operacional, libere o watchdog com:

```powershell
npm.cmd run prod:recovery:clear
```

O comando exige a frase `LIBERAR-WATCHDOG-APOS-VALIDACAO`, nao altera banco, nao
restaura artefatos e nao inicia API diretamente. Apos liberar, acompanhe o watchdog
com `npm.cmd run prod:status` e execute smoke operacional.

## Caso C — migration incompatível, destrutiva ou estado desconhecido

1. Mantenha `deploy.pause` e a aplicacao parada.
2. Preserve backup, `deploy-recovery.json` e logs.
3. Avalie o schema e os dados com pessoal autorizado.
4. Quando necessario, restaure o banco pre-deploy seguindo o procedimento aprovado.
5. Valide schema e dados.
6. Restaure a release anterior conforme procedimento aprovado.
7. Execute smoke.
8. Somente entao execute `npm.cmd run prod:recovery:clear` para liberar watchdog.

Nao ha comando destrutivo documentado aqui de proposito. Restauracao de banco requer
uma decisao humana, backup identificado e autorizacao explicita.
