import fs from 'fs';
import path from 'path';

function sanitizeTableColumns(columns = []) {
  return (Array.isArray(columns) ? columns : [])
    .filter((col) => col && col.name)
    .map((col) => ({
      name: col.name,
      type: col.type,
      isPrimaryKey: Boolean(col.isPrimaryKey),
      isNullable: col.isNullable !== false,
      defaultValue: col.defaultValue || '',
    }));
}

function sanitizeTables(tables = []) {
  return (Array.isArray(tables) ? tables : [])
    .filter((table) => table && table.name)
    .map((table) => ({
      name: table.name,
      columns: sanitizeTableColumns(table.columns),
    }));
}

export function buildDatabaseLayout(dbNodes = []) {
  const databases = (Array.isArray(dbNodes) ? dbNodes : [])
    .filter((node) => node?.type === 'database' && node?.data?.database)
    .map((node) => {
      const d = node.data || {};
      return {
        label: d.label || 'Database',
        connectionName: d.connectionName || 'default',
        host: d.host || 'localhost',
        port: Number(d.port) || 5432,
        password: d.password || '',
        database: d.database,
        schema: d.schema || 'public',
        tables: sanitizeTables(d.tables),
      };
    });

  return {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    source: 'visual-flow-editor-datagateway',
    databases,
  };
}

export function writeDatabaseLayoutFile(outputDir, dbNodes = []) {
  if (!outputDir) return null;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const layout = buildDatabaseLayout(dbNodes);
  const filePath = path.join(outputDir, 'db-layout.json');
  fs.writeFileSync(filePath, JSON.stringify(layout, null, 2));
  return filePath;
}
