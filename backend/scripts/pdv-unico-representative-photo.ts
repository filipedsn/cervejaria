import { createHash } from 'node:crypto';

type AnyRecord = Record<string, any>;

const stable = (value: unknown): string => {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    if (typeof (value as any).toFixed === 'function') return JSON.stringify((value as any).toString());
    if (Buffer.isBuffer(value)) return JSON.stringify(value.toString('base64'));
    return `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${stable((value as AnyRecord)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const rowKey = (model: AnyRecord, row: AnyRecord) => {
  const keys: string[] = model.primaryKey?.fields ?? model.fields.filter((field: AnyRecord) => field.isId).map((field: AnyRecord) => field.name);
  if (!keys.length) throw new Error(`Model ${model.name} has no stable primary key in the pinned Prisma schema.`);
  return keys.map((field) => `${field}=${stable(row[field])}`).join('|');
};

function jsonSafe(value: any): any {
  if (value instanceof Date) return { $photoType: 'date', value: value.toISOString() };
  if (typeof value === 'bigint') return { $photoType: 'bigint', value: value.toString() };
  if (Buffer.isBuffer(value)) return { $photoType: 'bytes', value: value.toString('base64') };
  if (value && typeof value === 'object' && typeof value.toFixed === 'function') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonSafe(child)]));
  return value;
}

function privateValue(runId: string, modelName: string, rowId: string, field: string) {
  return createHash('sha256').update(`${runId}:${modelName}:${rowId}:${field}`).digest('hex');
}

function redactMetadata(value: any, runId: string, modelName: string, rowId: string, path = 'metadata'): any {
  if (Array.isArray(value)) return value.map((item, index) => redactMetadata(item, runId, modelName, rowId, `${path}.${index}`));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const sensitive = /(nome|name|email|phone|telefone|cpf|cnpj|document|address|endereco|local|location|observ|message|description|text|token|senha|password|contact|contato|actor|user|birth|nascimento|motivo|reason|apelido|nickname|identificador|api.?key|secret|credential|refresh.?token|access.?token)/i.test(key);
    return [key, sensitive ? '[ANONIMIZADO]' : redactMetadata(item, runId, modelName, rowId, `${path}.${key}`)];
  }));
  return value;
}

function sanitizeRow(model: AnyRecord, input: AnyRecord, tenantLabel: string, runId: string) {
  const row = { ...input };
  const rowId = String(row.id ?? row[model.primaryKey?.fields?.[0] ?? 'id'] ?? privateValue(runId, model.name, 'row', 'key'));
  const replaceString = (field: string, prefix: string) => `${prefix}-${privateValue(runId, model.name, rowId, field).slice(0, 24)}`;
  for (const field of model.fields.filter((item: AnyRecord) => item.kind === 'scalar' || item.kind === 'enum')) {
    const name = field.name;
    if (model.name === 'Cervejaria' && name === 'nome') row[name] = tenantLabel;
    else if (model.name === 'Cervejaria' && name === 'slug') row[name] = `qa-${tenantLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${privateValue(runId, model.name, rowId, name).slice(0, 8)}`;
    else if (model.name === 'Usuario' && name === 'nome') row[name] = replaceString(name, 'QA User');
    else if (model.name === 'Usuario' && name === 'email') row[name] = `user-${privateValue(runId, model.name, rowId, name).slice(0, 20)}@example.invalid`;
    else if (model.name === 'Usuario' && name === 'senhaHash') row[name] = `$qa-disabled$${privateValue(runId, model.name, rowId, name)}`;
    else if (model.name === 'Cliente' && name === 'nome') row[name] = replaceString(name, 'QA Customer');
    else if (model.name === 'Cliente' && name === 'email') row[name] = row[name] == null ? null : `customer-${privateValue(runId, model.name, rowId, name).slice(0, 20)}@example.invalid`;
    else if (model.name === 'Cliente' && name === 'telefone') row[name] = row[name] == null ? null : `9${BigInt(`0x${privateValue(runId, model.name, rowId, name).slice(0, 15)}`).toString().slice(0, 10).padStart(10, '0')}`;
    else if (model.name === 'Cliente' && name === 'dataNascimento') row[name] = null;
    else if ((model.name === 'Cliente' && name === 'observacoes') || name === 'observacao' || name === 'observacoes') row[name] = row[name] == null ? null : '[ANONIMIZADO]';
    else if (model.name === 'Evento' && name === 'local') row[name] = row[name] == null ? null : '[LOCAL ANONIMIZADO]';
    else if (model.name === 'TransacaoLog' && name === 'metadata' && row[name] != null) row[name] = redactMetadata(row[name], runId, model.name, rowId);
    else if (field.type === 'String' && /senha|password|token|secret|credential|api.?key|endpoint|p256dh|^auth$/i.test(name) && row[name] != null) row[name] = replaceString(name, 'qa-secret');
    else if (field.type === 'String' && /^(email)$/i.test(name) && row[name] != null) row[name] = `${privateValue(runId, model.name, rowId, name).slice(0, 20)}@example.invalid`;
    else if (field.type === 'String' && /(cpf|cnpj|documento|document|address|endereco)/i.test(name) && row[name] != null) row[name] = '[ANONIMIZADO]';
  }
  return row;
}

const delegateName = (modelName: string) => modelName[0].toLowerCase() + modelName.slice(1);

export function parentLookupWhere(fromFields: string[], toFields: string[], childRow: AnyRecord) {
  if (!fromFields.length || fromFields.length !== toFields.length) return null;
  const pairs = fromFields.map((field, index) => ({ field: toFields[index], value: childRow[field] }));
  if (pairs.some((pair) => pair.value == null)) return null;
  return pairs.length === 1 ? { [pairs[0].field]: pairs[0].value }
    : { AND: pairs.map((pair) => ({ [pair.field]: pair.value })) };
}

/** Extracts only the selected tenants and their FK closure inside the caller's READ ONLY snapshot. */
export async function captureRepresentativeTenantPhoto(tx: AnyRecord, targets: Array<{ id: string; label: string }>, runId: string) {
  const models = Object.entries(tx._runtimeDataModel?.models ?? {}).map(([name, model]) => ({ name, ...(model as AnyRecord) })) as AnyRecord[];
  if (!models.length) throw new Error('Pinned Prisma runtime model metadata is unavailable.');
  const byName = new Map(models.map((model) => [model.name, model]));
  const rowsByModel = new Map<string, Map<string, AnyRecord>>(models.map((model) => [model.name, new Map()]));
  const ownership = new Map<string, Set<string>>(models.map((model) => [model.name, new Set()]));
  const queuedOwnedModels = new Set<string>();
  const pendingOwnedModels: string[] = [];
  const targetIds = new Set(targets.map((target) => target.id));
  const directTenantField = new Map<string, string>();
  const crossTenantEdges: AnyRecord[] = [];
  const queuedDependencies: Array<{ model: AnyRecord; row: AnyRecord }> = [];
  const delegate = (model: AnyRecord) => {
    const instance = tx[delegateName(model.name)];
    if (!instance?.findMany) throw new Error(`Delegate ${delegateName(model.name)} is unavailable.`);
    return instance;
  };
  const add = (model: AnyRecord, row: AnyRecord, kind: 'owned' | 'dependency') => {
    const key = rowKey(model, row);
    const rows = rowsByModel.get(model.name)!;
    const existed = rows.has(key);
    if (!existed) rows.set(key, row);
    if (kind === 'owned') {
      const priorOwned = ownership.get(model.name)!.has(key);
      ownership.get(model.name)!.add(key);
      if (!priorOwned && !queuedOwnedModels.has(model.name)) {
        queuedOwnedModels.add(model.name);
        pendingOwnedModels.push(model.name);
      }
    }
    if (!existed) queuedDependencies.push({ model, row });
    return !existed;
  };

  for (const model of models) {
    const ownerRelation = model.fields.find((field: AnyRecord) => field.kind === 'object' && field.type === 'Cervejaria' && field.relationFromFields?.length);
    const ownerField = ownerRelation?.relationFromFields?.[0];
    if (!ownerField) continue;
    directTenantField.set(model.name, ownerField);
    const found = await delegate(model).findMany({ where: { [ownerField]: { in: [...targetIds] } } });
    for (const row of found) add(model, row, 'owned');
  }
  const companyModel = byName.get('Cervejaria');
  if (!companyModel) throw new Error('Pinned source schema does not define Cervejaria.');
  const companyRows = await delegate(companyModel).findMany({ where: { id: { in: [...targetIds] } } });
  for (const row of companyRows) add(companyModel, row, 'owned');

  let dependencyCursor = 0;
  let ownedCursor = 0;
  while (dependencyCursor < queuedDependencies.length || ownedCursor < pendingOwnedModels.length) {
    if (dependencyCursor < queuedDependencies.length) {
      const current = queuedDependencies[dependencyCursor++];
    for (const relation of current.model.fields.filter((field: AnyRecord) => field.kind === 'object' && field.relationFromFields?.length)) {
      const parentModel = byName.get(relation.type);
      if (!parentModel) continue;
      const fromFields: string[] = relation.relationFromFields;
      const toFields: string[] = relation.relationToFields?.length ? relation.relationToFields : ['id'];
      if (fromFields.length !== toFields.length) continue;
      const values = fromFields.map((field) => current.row[field]);
      if (values.some((value) => value == null)) continue;
      const existingParents = [...rowsByModel.get(parentModel.name)!.values()].filter((row) => toFields.every((field, index) => row[field] === values[index]));
      if (existingParents.length === 1) continue;
      const where = parentLookupWhere(fromFields, toFields, current.row);
      if (!where) continue;
      const parentRows = await delegate(parentModel).findMany({ where });
      if (parentRows.length !== 1) {
        if (parentRows.length === 0) crossTenantEdges.push({ kind: 'MISSING_PARENT', model: current.model.name, rowId: current.row[current.model.primaryKey?.fields?.[0] ?? 'id'], relation: relation.name });
        continue;
      }
      const childTenantField = directTenantField.get(current.model.name);
      const parentTenantField = directTenantField.get(parentModel.name);
      if (childTenantField && parentTenantField && current.row[childTenantField] !== parentRows[0][parentTenantField]) {
        crossTenantEdges.push({ kind: 'CROSS_TENANT_PARENT', model: current.model.name, rowId: current.row[current.model.primaryKey?.fields?.[0] ?? 'id'], parentModel: parentModel.name, parentId: parentRows[0][parentModel.primaryKey?.fields?.[0] ?? 'id'], relation: relation.name });
        continue;
      }
      add(parentModel, parentRows[0], 'dependency');
    }
    }
    if (ownedCursor >= pendingOwnedModels.length) continue;
    const ownedModel = byName.get(pendingOwnedModels[ownedCursor++]);
    if (!ownedModel) continue;
    queuedOwnedModels.delete(ownedModel.name);
    for (const childModel of models) {
      for (const relation of childModel.fields.filter((field: AnyRecord) => field.kind === 'object' && field.type === ownedModel.name && field.relationFromFields?.length)) {
        const fromFields: string[] = relation.relationFromFields;
        const toFields: string[] = relation.relationToFields?.length ? relation.relationToFields : ['id'];
        if (fromFields.length !== toFields.length) continue;
        const parentValues = new Map<string, unknown[]>();
        const ownedRows = [...ownership.get(ownedModel.name)!].map((key) => rowsByModel.get(ownedModel.name)!.get(key)!);
        for (let index = 0; index < fromFields.length; index++) {
          parentValues.set(fromFields[index], ownedRows.map((row) => row[toFields[index]]).filter((value) => value != null));
        }
        const where = fromFields.length === 1 ? { [fromFields[0]]: { in: parentValues.get(fromFields[0]) } }
          : { AND: fromFields.map((field) => ({ [field]: { in: parentValues.get(field) } })) };
        if (fromFields.some((field) => !(parentValues.get(field)?.length))) continue;
        const childRows = await delegate(childModel).findMany({ where });
        const childTenantField = directTenantField.get(childModel.name);
        for (const child of childRows) {
          if (childTenantField && !targetIds.has(child[childTenantField])) {
            crossTenantEdges.push({ kind: 'CROSS_TENANT_CHILD', model: childModel.name, rowId: child[childModel.primaryKey?.fields?.[0] ?? 'id'], tenantId: child[childTenantField], relation: relation.name });
            continue;
          }
          add(childModel, child, 'owned');
        }
      }
    }
  }

  const labelById = new Map(targets.map((target) => [target.id, target.label]));
  const tableRows = [] as AnyRecord[];
  for (const model of models) {
    const rows = rowsByModel.get(model.name)!;
    if (!rows.size) continue;
    const fields = model.fields.filter((field: AnyRecord) => field.kind === 'scalar' || field.kind === 'enum').map((field: AnyRecord) => field.name);
    const companyField = directTenantField.get(model.name);
    const outputRows = [...rows.values()].map((sourceRow) => {
      const label = companyField ? labelById.get(sourceRow[companyField]) ?? 'shared-dependency'
        : model.name === 'Cervejaria' ? labelById.get(sourceRow.id) ?? 'shared-dependency' : 'shared-dependency';
      const sanitized = sanitizeRow(model, sourceRow, label, runId);
      return Object.fromEntries(fields.filter((field) => Object.hasOwn(sanitized, field)).map((field) => [field, jsonSafe(sanitized[field])]));
    });
    const parents = model.fields.filter((field: AnyRecord) => field.kind === 'object' && field.relationFromFields?.length).map((field: AnyRecord) => ({ model: field.type, fields: field.relationFromFields, references: field.relationToFields ?? ['id'] }));
    tableRows.push({ model: model.name, schema: model.schema ?? 'public', table: model.dbName ?? model.name, primaryKey: model.primaryKey?.fields ?? model.fields.filter((field: AnyRecord) => field.isId).map((field: AnyRecord) => field.name), scalarFields: fields, parents, rowCount: outputRows.length, rows: outputRows });
  }
  return { version: 1, anonymization: ['Cervejaria.nome/slug', 'Cliente.nome/email/telefone/dataNascimento/observacoes', 'Usuario.nome/email/senhaHash', 'TransacaoLog.metadata values for person/free-text keys', 'Evento.local', 'observacao(s), endpoint/push/reset credentials'], targets, tableRows, crossTenantEdges };
}

export function revivePhotoValue(value: any): any {
  if (Array.isArray(value)) return value.map(revivePhotoValue);
  if (value && typeof value === 'object') {
    if (value.$photoType === 'date') return new Date(value.value);
    if (value.$photoType === 'bigint') return BigInt(value.value);
    if (value.$photoType === 'bytes') return Buffer.from(value.value, 'base64');
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, revivePhotoValue(child)]));
  }
  return value;
}
