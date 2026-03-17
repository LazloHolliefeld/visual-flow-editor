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
  const validColumns = columns.filter((col) => col && col.name);
  const primaryKeyColumns = validColumns.filter((col) => col.isPrimaryKey);

  const defs = validColumns.map((col) => {
    let def = `"${col.name}" ${col.type}`;
    if (!col.isNullable && !col.isPrimaryKey) def += ' NOT NULL';
    if (col.defaultValue) def += ` DEFAULT ${col.defaultValue}`;
    return def;
  });

  if (primaryKeyColumns.length > 0) {
    const pkColumns = primaryKeyColumns.map((col) => `"${col.name}"`).join(', ');
    defs.push(`PRIMARY KEY (${pkColumns})`);
  }

  return defs;
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
