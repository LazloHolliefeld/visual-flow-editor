import express from 'express';
import cors from 'cors';
import pg from 'pg';

const { Client } = pg;
const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Store connections
const connections = new Map();

// Helper to get admin connection (connects to postgres db to create databases)
async function getAdminClient(host, port, password = '') {
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

// Helper to get connection to specific database
async function getDatabaseClient(host, port, database, password = '') {
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

// Test database connection
app.post('/api/db/test-connection', async (req, res) => {
  const { host, port, database } = req.body;
  
  try {
    const client = database 
      ? await getDatabaseClient(host, port, database)
      : await getAdminClient(host, port);
    await client.query('SELECT 1');
    await client.end();
    res.json({ success: true, message: 'Connection successful' });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// Create database and tables
app.post('/api/db/create', async (req, res) => {
  const { host, port, database, schema, tables, password } = req.body;
  
  if (!database) {
    return res.json({ success: false, message: 'Database name is required' });
  }
  
  let adminClient;
  let dbClient;
  
  try {
    // Connect to postgres to create database
    adminClient = await getAdminClient(host, port, password);
    
    // Check if database exists
    const dbCheck = await adminClient.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [database]
    );
    
    if (dbCheck.rows.length === 0) {
      // Create database
      await adminClient.query(`CREATE DATABASE "${database}"`);
      console.log(`Created database: ${database}`);
    } else {
      console.log(`Database ${database} already exists`);
    }
    
    await adminClient.end();
    
    // Connect to new database to create schema and tables
    dbClient = await getDatabaseClient(host, port, database, password);
    
    // Create schema if not public
    if (schema && schema !== 'public') {
      await dbClient.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      console.log(`Created schema: ${schema}`);
    }
    
    const schemaPrefix = schema && schema !== 'public' ? `"${schema}".` : '';
    
    // Create tables
    if (tables && tables.length > 0) {
      for (const table of tables) {
        if (!table.name || !table.columns || table.columns.length === 0) {
          continue;
        }
        
        const columnDefs = table.columns
          .filter(col => col.name)
          .map(col => {
            let def = `"${col.name}" ${col.type}`;
            if (col.isPrimaryKey) def += ' PRIMARY KEY';
            if (!col.isNullable && !col.isPrimaryKey) def += ' NOT NULL';
            if (col.defaultValue) def += ` DEFAULT ${col.defaultValue}`;
            return def;
          })
          .join(', ');
        
        if (columnDefs) {
          const createSQL = `CREATE TABLE IF NOT EXISTS ${schemaPrefix}"${table.name}" (${columnDefs})`;
          console.log('Executing:', createSQL);
          await dbClient.query(createSQL);
          console.log(`Created table: ${table.name}`);
        }
      }
    }
    
    await dbClient.end();
    
    const tableCount = tables?.length || 0;
    res.json({ 
      success: true, 
      message: `Database "${database}" created successfully with ${tableCount} table(s)` 
    });
    
  } catch (error) {
    console.error('Database creation error:', error);
    
    if (adminClient) {
      try { await adminClient.end(); } catch (e) {}
    }
    if (dbClient) {
      try { await dbClient.end(); } catch (e) {}
    }
    
    res.json({ success: false, message: error.message });
  }
});

// List databases
app.post('/api/db/list-databases', async (req, res) => {
  const { host, port, password } = req.body;
  
  try {
    const client = await getAdminClient(host, port, password);
    const result = await client.query(
      "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"
    );
    await client.end();
    
    res.json({ 
      success: true, 
      databases: result.rows.map(r => r.datname) 
    });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// List tables in a database
app.post('/api/db/list-tables', async (req, res) => {
  const { host, port, database, schema, password } = req.body;
  
  try {
    const client = await getDatabaseClient(host, port, database, password);
    const result = await client.query(
      `SELECT table_name FROM information_schema.tables 
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [schema || 'public']
    );
    await client.end();
    
    res.json({ 
      success: true, 
      tables: result.rows.map(r => r.table_name) 
    });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// Execute arbitrary SQL (for generated code testing)
app.post('/api/db/execute', async (req, res) => {
  const { host, port, database, sql, password } = req.body;
  
  try {
    const client = await getDatabaseClient(host, port, database, password);
    const result = await client.query(sql);
    await client.end();
    
    res.json({ 
      success: true, 
      rowCount: result.rowCount,
      rows: result.rows
    });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Visual Flow Editor API server running on http://localhost:${PORT}`);
});
