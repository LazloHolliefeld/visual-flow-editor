import pg from 'pg';

const { Client } = pg;

export async function getAdminClient(host, port, password = '') {
  const client = new Client({
    host,
    port,
    database: 'postgres',
    user: 'postgres',
    password: password || process.env.PGPASSWORD || 'postgres',
  });
  await client.connect();
  return client;
}

export async function getDatabaseClient(host, port, database, password = '') {
  const client = new Client({
    host,
    port,
    database,
    user: 'postgres',
    password: password || process.env.PGPASSWORD || 'postgres',
  });
  await client.connect();
  return client;
}

function buildTableColumnDefinitions(columns = []) {
  const validColumns = enforceIdBestPractices(columns);
  const primaryKeyColumns = validColumns.filter((col) => col.isPrimaryKey);

  const defs = validColumns.map((col) => {
    const isIdentityId = isIdentityIdColumn(col);
    let def = `"${col.name}" ${isIdentityId ? 'BIGINT' : col.type}`;
    if (isIdentityId) {
      def += ' GENERATED ALWAYS AS IDENTITY';
    }
    if (!col.isNullable && !col.isPrimaryKey) def += ' NOT NULL';
    if (col.defaultValue && !isIdentityId) def += ` DEFAULT ${col.defaultValue}`;
    return def;
  });

  if (primaryKeyColumns.length > 0) {
    const pkColumns = primaryKeyColumns.map((col) => `"${col.name}"`).join(', ');
    defs.push(`PRIMARY KEY (${pkColumns})`);
  }

  return defs;
}

function isIdentityIdColumn(col) {
  return Boolean(col && String(col.name || '').toLowerCase() === 'id');
}

function enforceIdBestPractices(columns = []) {
  const valid = (columns || []).filter((col) => col && col.name);
  const normalized = valid.map((col) => {
    if (!isIdentityIdColumn(col)) {
      return col;
    }

    return {
      ...col,
      type: 'BIGINT',
      isPrimaryKey: true,
      isNullable: false,
      defaultValue: '',
    };
  });

  const hasId = normalized.some((col) => isIdentityIdColumn(col));
  const withoutId = normalized.filter((col) => !isIdentityIdColumn(col));

  if (hasId) {
    const enforcedId = {
      name: 'id',
      type: 'BIGINT',
      isNullable: false,
      isPrimaryKey: true,
      defaultValue: '',
    };
    return [enforcedId, ...withoutId];
  }

  return [
    {
      name: 'id',
      type: 'BIGINT',
      isNullable: false,
      isPrimaryKey: true,
      defaultValue: '',
    },
    ...normalized,
  ];
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function normalizeType(type) {
  const t = String(type || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (t === 'serial') return 'integer';
  if (t === 'bigserial') return 'bigint';
  if (t.startsWith('varchar(')) return t.replace('varchar', 'character varying');
  if (t.startsWith('decimal(')) return t.replace('decimal', 'numeric');
  if (t === 'float') return 'double precision';
  return t;
}

function arraysEqual(a = [], b = []) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function syncTableSchema(dbClient, schemaName, table) {
  const validColumns = enforceIdBestPractices(table.columns || []);
  if (validColumns.length === 0) return;

  const schemaIdent = quoteIdent(schemaName || 'public');
  const tableIdent = quoteIdent(table.name);
  const tableRef = `${schemaIdent}.${tableIdent}`;

  const existingColsRes = await dbClient.query(
    `SELECT a.attname AS column_name,
            format_type(a.atttypid, a.atttypmod) AS column_type,
            a.attnotnull AS is_not_null
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1
       AND c.relname = $2
       AND a.attnum > 0
       AND NOT a.attisdropped`,
    [schemaName || 'public', table.name]
  );

  const existingCols = new Map(existingColsRes.rows.map((r) => [r.column_name, r]));

  for (const col of validColumns) {
    const colIdent = quoteIdent(col.name);
    const existing = existingCols.get(col.name);

    if (!existing) {
      let addSql = `ALTER TABLE ${tableRef} ADD COLUMN ${colIdent} ${col.type}`;
      if (isIdentityIdColumn(col)) {
        addSql = `ALTER TABLE ${tableRef} ADD COLUMN ${colIdent} BIGINT GENERATED ALWAYS AS IDENTITY`;
      }
      if (!col.isNullable && !col.isPrimaryKey) addSql += ' NOT NULL';
      if (col.defaultValue && !isIdentityIdColumn(col)) addSql += ` DEFAULT ${col.defaultValue}`;
      await dbClient.query(addSql);
      if (isIdentityIdColumn(col)) {
        await ensureIdentityAlways(dbClient, schemaName || 'public', table.name, col.name, tableRef);
      }
      continue;
    }

    const existingType = normalizeType(existing.column_type);
    const desiredType = normalizeType(col.type);
    if (existingType !== desiredType) {
      await dbClient.query(
        `ALTER TABLE ${tableRef} ALTER COLUMN ${colIdent} TYPE ${col.type} USING ${colIdent}::${col.type}`
      );
    }

    const desiredNotNull = Boolean(col.isPrimaryKey || col.isNullable === false);
    const isNotNull = Boolean(existing.is_not_null);
    if (desiredNotNull && !isNotNull) {
      await dbClient.query(`ALTER TABLE ${tableRef} ALTER COLUMN ${colIdent} SET NOT NULL`);
    }
    if (!desiredNotNull && isNotNull) {
      await dbClient.query(`ALTER TABLE ${tableRef} ALTER COLUMN ${colIdent} DROP NOT NULL`);
    }

    if (!isIdentityIdColumn(col)) {
      if (col.defaultValue) {
        await dbClient.query(`ALTER TABLE ${tableRef} ALTER COLUMN ${colIdent} SET DEFAULT ${col.defaultValue}`);
      } else {
        await dbClient.query(`ALTER TABLE ${tableRef} ALTER COLUMN ${colIdent} DROP DEFAULT`);
      }
    }

    if (isIdentityIdColumn(col)) {
      await ensureIdentityAlways(dbClient, schemaName || 'public', table.name, col.name, tableRef);
    }
  }

  const desiredPkCols = validColumns.filter((c) => c.isPrimaryKey).map((c) => c.name);
  const pkRes = await dbClient.query(
    `SELECT tc.constraint_name,
            array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS columns
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
      AND tc.table_name = kcu.table_name
     WHERE tc.table_schema = $1
       AND tc.table_name = $2
       AND tc.constraint_type = 'PRIMARY KEY'
     GROUP BY tc.constraint_name`,
    [schemaName || 'public', table.name]
  );

  const existingPk = pkRes.rows[0];
  const existingPkCols = existingPk?.columns || [];

  if (!arraysEqual(existingPkCols, desiredPkCols)) {
    if (existingPk?.constraint_name) {
      await dbClient.query(`ALTER TABLE ${tableRef} DROP CONSTRAINT ${quoteIdent(existingPk.constraint_name)}`);
    }

    if (desiredPkCols.length > 0) {
      const pkColsSql = desiredPkCols.map((c) => quoteIdent(c)).join(', ');
      await dbClient.query(`ALTER TABLE ${tableRef} ADD PRIMARY KEY (${pkColsSql})`);
    }
  }
}

async function ensureIdentityAlways(dbClient, schemaName, tableName, columnName, tableRef) {
  const colIdent = quoteIdent(columnName);
  const identityRes = await dbClient.query(
    `SELECT is_identity, identity_generation
     FROM information_schema.columns
     WHERE table_schema = $1
       AND table_name = $2
       AND column_name = $3`,
    [schemaName, tableName, columnName]
  );

  const meta = identityRes.rows[0];
  if (meta?.is_identity === 'YES' && String(meta.identity_generation || '').toUpperCase() === 'ALWAYS') {
    return;
  }

  // Identity cannot be added while an explicit default exists (serial/nextval or custom default).
  await dbClient.query(`ALTER TABLE ${tableRef} ALTER COLUMN ${colIdent} DROP DEFAULT`);

  try {
    await dbClient.query(`ALTER TABLE ${tableRef} ALTER COLUMN ${colIdent} ADD GENERATED ALWAYS AS IDENTITY`);
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    if (!message.includes('is already an identity column')) {
      throw error;
    }
    await dbClient.query(`ALTER TABLE ${tableRef} ALTER COLUMN ${colIdent} SET GENERATED ALWAYS`);
  }
}

export function extractDatabaseSchemas(nodes = []) {
  const schemas = [];
  const dbNodes = nodes.filter((n) => n.type === 'database' && n.data?.database);

  for (const node of dbNodes) {
    const d = node.data;
    let sql = `-- Database: ${d.database}\n`;
    sql += '-- Generated from Visual Flow Editor\n';
    sql += `-- Host: ${d.host}:${d.port}\n\n`;

    sql += '-- Create database (run as superuser)\n';
    sql += `-- CREATE DATABASE "${d.database}";\n\n`;

    sql += `\\connect "${d.database}"\n\n`;

    if (d.schema && d.schema !== 'public') {
      sql += `CREATE SCHEMA IF NOT EXISTS "${d.schema}";\n\n`;
    }

    const schemaPrefix = d.schema && d.schema !== 'public' ? `"${d.schema}".` : '';

    if (d.tables && d.tables.length > 0) {
      for (const table of d.tables) {
        if (!table.name || !table.columns || table.columns.length === 0) continue;

        sql += `-- Table: ${table.name}\n`;
        sql += `CREATE TABLE IF NOT EXISTS ${schemaPrefix}"${table.name}" (\n`;

        const columnDefs = buildTableColumnDefinitions(table.columns).map((def) => `  ${def}`);
        sql += columnDefs.join(',\n');
        sql += '\n);\n\n';
      }
    }

    schemas.push({
      database: d.database,
      schema: d.schema || 'public',
      host: d.host,
      port: d.port,
      sql,
    });
  }

  return schemas;
}

export async function testConnection({ host, port, database, password }) {
  const client = database
    ? await getDatabaseClient(host, port, database, password)
    : await getAdminClient(host, port, password);

  try {
    await client.query('SELECT 1');
    return { success: true, message: 'Connection successful' };
  } finally {
    await client.end();
  }
}

export async function createDatabaseAndTables({ host, port, database, schema, tables, password }) {
  if (!database) {
    return { success: false, message: 'Database name is required' };
  }

  let adminClient;
  let dbClient;

  try {
    adminClient = await getAdminClient(host, port, password);
    const dbCheck = await adminClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [database]
    );

    if (dbCheck.rows.length === 0) {
      await adminClient.query(`CREATE DATABASE "${database}"`);
      console.log(`Created database: ${database}`);
    } else {
      console.log(`Database ${database} already exists`);
    }

    await adminClient.end();
    adminClient = null;

    dbClient = await getDatabaseClient(host, port, database, password);

    if (schema && schema !== 'public') {
      await dbClient.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      console.log(`Created schema: ${schema}`);
    }

    const schemaPrefix = schema && schema !== 'public' ? `"${schema}".` : '';
    const schemaName = schema || 'public';

    if (tables && tables.length > 0) {
      for (const table of tables) {
        if (!table.name || !table.columns || table.columns.length === 0) {
          continue;
        }

        const columnDefs = buildTableColumnDefinitions(table.columns);
        const createColumnsSQL = columnDefs.join(', ');

        if (createColumnsSQL) {
          const createSQL = `CREATE TABLE IF NOT EXISTS ${schemaPrefix}"${table.name}" (${createColumnsSQL})`;
          console.log('Executing:', createSQL);
          await dbClient.query(createSQL);
          await syncTableSchema(dbClient, schemaName, table);
          console.log(`Created table: ${table.name}`);
        }
      }
    }

    await dbClient.end();
    dbClient = null;

    const tableCount = tables?.length || 0;
    return {
      success: true,
      message: `Database "${database}" created successfully with ${tableCount} table(s)`,
    };
  } catch (error) {
    console.error('Database creation error:', error);

    if (adminClient) {
      try { await adminClient.end(); } catch {}
    }
    if (dbClient) {
      try { await dbClient.end(); } catch {}
    }

    return { success: false, message: error.message };
  }
}

export async function listDatabases({ host, port, password }) {
  const client = await getAdminClient(host, port, password);
  try {
    const result = await client.query(
      'SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname'
    );
    return { success: true, databases: result.rows.map((r) => r.datname) };
  } finally {
    await client.end();
  }
}

export async function dropDatabase({ host, port, database, password }) {
  if (!database || database === 'postgres') {
    return { success: false, message: 'Cannot drop postgres or empty database name' };
  }

  const client = await getAdminClient(host, port, password);
  try {
    await client.query(
      `SELECT pg_terminate_backend(pg_stat_activity.pid)
       FROM pg_stat_activity
       WHERE pg_stat_activity.datname = $1
         AND pid <> pg_backend_pid()`,
      [database]
    );

    await client.query(`DROP DATABASE IF EXISTS "${database}"`);
    console.log(`Dropped database: ${database}`);

    return { success: true, message: `Database "${database}" dropped successfully` };
  } finally {
    await client.end();
  }
}

export async function resetAllDatabases({ host = 'localhost', port = 5432, password }, onEachDropped) {
  const dropped = [];
  const errors = [];

  const client = await getAdminClient(host, port, password);
  try {
    const result = await client.query(
      `SELECT datname FROM pg_database
       WHERE datistemplate = false
         AND datname NOT IN ('postgres')
       ORDER BY datname`
    );

    for (const row of result.rows) {
      const dbName = row.datname;
      try {
        await client.query(
          `SELECT pg_terminate_backend(pg_stat_activity.pid)
           FROM pg_stat_activity
           WHERE pg_stat_activity.datname = $1
             AND pid <> pg_backend_pid()`,
          [dbName]
        );

        await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
        dropped.push(dbName);
        if (onEachDropped) onEachDropped(dbName);
      } catch (err) {
        errors.push({ database: dbName, error: err.message });
      }
    }
  } finally {
    await client.end();
  }

  return { dropped, errors };
}

export async function listTables({ host, port, database, schema, password }) {
  const client = await getDatabaseClient(host, port, database, password);
  try {
    const result = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [schema || 'public']
    );
    return { success: true, tables: result.rows.map((r) => r.table_name) };
  } finally {
    await client.end();
  }
}

export async function executeSql({ host, port, database, sql, password }) {
  const client = await getDatabaseClient(host, port, database, password);
  try {
    const result = await client.query(sql);
    return { success: true, rowCount: result.rowCount, rows: result.rows };
  } finally {
    await client.end();
  }
}
