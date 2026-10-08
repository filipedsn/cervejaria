import assert from 'node:assert/strict';

export function revivePhotoValue(value) {
  if (Array.isArray(value)) return value.map(revivePhotoValue);
  if (value && typeof value === 'object') {
    if (value.$photoType === 'date') return new Date(value.value);
    if (value.$photoType === 'bigint') return BigInt(value.value);
    if (value.$photoType === 'bytes') return Buffer.from(value.value, 'base64');
    return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, revivePhotoValue(child)]));
  }
  return value;
}

function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (value && typeof value.toFixed === 'function') return value.toString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function primaryKey(table, row) {
  return table.primaryKey.map((field) => `${field}=${JSON.stringify(canonical(row[field])).replaceAll('|', '\\|')}`).join('|');
}

/** Restore the exact, approved source photo with a Prisma Client generated from its original schema. */
export async function restoreSourcePhoto(db, photo) {
  const models = Object.entries(db._runtimeDataModel.models);
  const modelByName = new Map(models);
  const tables = photo.tableRows.map((table) => {
    const model = modelByName.get(table.model);
    assert.ok(model, `source schema is missing photo model ${table.model}`);
    const scalarFields = new Set(model.fields.filter((field) => field.kind === 'scalar' || field.kind === 'enum').map((field) => field.name));
    return { ...table, rows: table.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([field]) => scalarFields.has(field)))) };
  });
  const rowCount = tables.reduce((sum, table) => sum + table.rows.length, 0);
  await db.$transaction(async (tx) => {
    const entries = [];
    for (const table of tables) for (const row of table.rows) {
      entries.push({ table, row, data: Object.fromEntries(Object.entries(row).map(([field, value]) => [field, revivePhotoValue(value)])), dependencies: new Set(), deferred: [] });
    }
    const byTargetKey = new Map();
    for (const entry of entries) byTargetKey.set(`${entry.table.model}:${primaryKey(entry.table, entry.row)}`, entry);
    for (const entry of entries) for (const relation of entry.table.parents) {
      const values = relation.fields.map((field) => entry.row[field]);
      if (values.some((value) => value == null)) continue;
      const parentKey = relation.references.map((_, index) => `${relation.references[index]}=${JSON.stringify(canonical(revivePhotoValue(values[index]))).replaceAll('|', '\\|')}`).join('|');
      const parent = byTargetKey.get(`${relation.model}:${parentKey}`);
      if (!parent) throw new Error(`PHOTO_IMPORT_MISSING_PARENT: ${entry.table.model}.${relation.fields.join('+')} -> ${relation.model}`);
      entry.dependencies.add({ parent, relation });
    }
    const inserted = new Set();
    const nullableFields = new Map(models.map(([name, model]) => [name, new Map(model.fields.filter((field) => field.kind === 'scalar' || field.kind === 'enum').map((field) => [field.name, field.isRequired === false]))]));
    const remaining = new Map(entries.map((entry) => [entry, entry.dependencies.size]));
    const dependents = new Map(entries.map((entry) => [entry, []]));
    for (const entry of entries) for (const edge of entry.dependencies) dependents.get(edge.parent).push({ child: entry, edge, active: true });
    const cycleEdges = [...dependents.values()].flat().filter(({ child, edge }) => edge.relation.fields.every((field) => nullableFields.get(child.table.model)?.get(field)));
    const queue = entries.filter((entry) => remaining.get(entry) === 0);
    let cursor = 0;
    let cycleCursor = 0;
    while (inserted.size < entries.length) {
      if (cursor < queue.length) {
        const group = queue.slice(cursor);
        cursor = queue.length;
        for (const [modelName, batch] of Map.groupBy(group, (entry) => entry.table.model)) {
          const delegate = modelName[0].toLowerCase() + modelName.slice(1);
          await tx[delegate].createMany({ data: batch.map((entry) => entry.data) });
          for (const entry of batch) {
            inserted.add(entry);
            for (const edge of dependents.get(entry)) if (edge.active) {
              edge.active = false;
              const count = remaining.get(edge.child) - 1;
              remaining.set(edge.child, count);
              if (count === 0) queue.push(edge.child);
            }
          }
        }
        continue;
      }
      let candidate;
      while (cycleCursor < cycleEdges.length) {
        const edge = cycleEdges[cycleCursor++];
        if (edge.active && !inserted.has(edge.child) && !inserted.has(edge.edge.parent)) { candidate = edge; break; }
      }
      if (!candidate) throw new Error('PHOTO_IMPORT_REQUIRED_FK_CYCLE');
      for (const field of candidate.edge.relation.fields) candidate.child.data[field] = null;
      candidate.child.deferred.push(...candidate.edge.relation.fields.map((field) => [field, revivePhotoValue(candidate.child.row[field])]));
      const edge = [...candidate.child.dependencies].find((item) => item.parent === candidate.edge.parent && item.relation === candidate.edge.relation);
      candidate.child.dependencies.delete(edge);
      candidate.active = false;
      const count = remaining.get(candidate.child) - 1;
      remaining.set(candidate.child, count);
      if (count === 0) queue.push(candidate.child);
    }
    for (const entry of entries.filter((item) => item.deferred.length)) {
      const where = Object.fromEntries(entry.table.primaryKey.map((field) => [field, entry.data[field]]));
      await tx[entry.table.model[0].toLowerCase() + entry.table.model.slice(1)].update({ where, data: Object.fromEntries(entry.deferred) });
    }
  }, { timeout: 300000, maxWait: 30000 });
  await compareSourcePhoto(db, photo);
  return { tables: tables.length, rows: rowCount };
}

export async function compareSourcePhoto(db, photo) {
  const models = new Set(Object.keys(db._runtimeDataModel.models));
  for (const table of photo.tableRows) {
    assert.ok(models.has(table.model), `source schema is missing photo model ${table.model}`);
    const delegate = table.model[0].toLowerCase() + table.model.slice(1);
    const rows = await db[delegate].findMany();
    assert.equal(rows.length, table.rows.length, `${table.model}: source row count`);
    const byId = new Map(rows.map((row) => [primaryKey(table, row), row]));
    for (const source of table.rows) {
      const actual = byId.get(primaryKey(table, revivePhotoValue(source)));
      assert.ok(actual, `${table.model}: source ID restored`);
      for (const [field, value] of Object.entries(source)) assert.deepEqual(canonical(actual[field]), canonical(revivePhotoValue(value)), `${table.model}.${field}: source scalar preserved`);
    }
  }
  return { status: 'PASS', tables: photo.tableRows.length, rows: photo.tableRows.reduce((sum, table) => sum + table.rows.length, 0) };
}
