import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  testConnection,
  createDatabaseAndTables,
  listDatabases,
  dropDatabase,
  resetAllDatabases,
  listTables,
  executeSql,
  extractDatabaseSchemas,
} from './services/databaseService.js';
import { generateDataGateway, generateDataGatewayReadme } from './services/datagatewayGenerator.js';
import {
  generateServiceCode,
  generateServiceReadme,
  generateGoCode,
  generateReadme,
} from './services/serviceCodeGenerator.js';
import {
  pushGeneratedFlowToGithub,
  pushAllGeneratedRepos,
} from './services/githubService.js';
import {
  startDataGateway,
  stopDataGateway,
  getDataGatewayStatus,
  stopAllRunningServers,
} from './services/serverProcessService.js';
import {
  saveProjectState,
  loadProjectState,
  clearProjectState,
} from './services/projectService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

// Project persistence file
const PROJECT_FILE = path.join(__dirname, 'project.json');
const GENERATED_CODE_DIR = path.join(__dirname, '..', '..', 'flow-generated-code');

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Test database connection
app.post('/api/db/test-connection', async (req, res) => {
  try {
    const result = await testConnection(req.body || {});
    res.json(result);
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// Create database and tables
app.post('/api/db/create', async (req, res) => {
  try {
    const result = await createDatabaseAndTables(req.body || {});
    res.json(result);
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// List databases
app.post('/api/db/list-databases', async (req, res) => {
  try {
    const result = await listDatabases(req.body || {});
    res.json(result);
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// Drop database
app.post('/api/db/drop', async (req, res) => {
  try {
    const result = await dropDatabase(req.body || {});
    res.json(result);
  } catch (error) {
    console.error('Drop database error:', error);
    res.json({ success: false, message: error.message });
  }
});

// Reset everything - drop all user databases and clear project (for testing)
app.post('/api/reset-all', async (req, res) => {
  try {
    const { dropped, errors } = await resetAllDatabases(req.body || {}, (dbName) => {
      console.log(`Reset: Dropped database ${dbName}`);
    });
    
    // Clear project state
    clearProjectState(PROJECT_FILE);
    console.log('Reset: Cleared project state');
    
    // Stop any running servers
    stopAllRunningServers();
    
    res.json({ 
      success: true, 
      message: `Reset complete. Dropped ${dropped.length} database(s).`,
      dropped,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Reset error:', error);
    res.json({ success: false, message: error.message });
  }
});

// List tables in a database
app.post('/api/db/list-tables', async (req, res) => {
  try {
    const result = await listTables(req.body || {});
    res.json(result);
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// Execute arbitrary SQL (for generated code testing)
app.post('/api/db/execute', async (req, res) => {
  try {
    const result = await executeSql(req.body || {});
    res.json(result);
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// ===== PROJECT PERSISTENCE =====

// Save project state (new structure with serviceFlows)
app.post('/api/project/save', async (req, res) => {
  try {
    const result = saveProjectState(PROJECT_FILE, req.body?.projectData);
    res.json(result);
  } catch (error) {
    console.error('Save error:', error);
    res.json({ success: false, message: error.message });
  }
});

// Load project state
app.get('/api/project/load', async (req, res) => {
  try {
    const result = loadProjectState(PROJECT_FILE);
    res.json(result);
  } catch (error) {
    console.error('Load error:', error);
    res.json({ success: false, message: error.message });
  }
});

// ===== CODE GENERATION =====

// Generate Go code from flow
app.post('/api/generate/go', async (req, res) => {
  const { nodes, edges } = req.body;
  
  try {
    const goCode = generateGoCode(nodes, edges);
    const dbSchemas = extractDatabaseSchemas(nodes);
    
    res.json({ 
      success: true, 
      code: goCode,
      schemas: dbSchemas,
    });
  } catch (error) {
    console.error('Code generation error:', error);
    res.json({ success: false, message: error.message });
  }
});

// Generate and push to GitHub
app.post('/api/generate/push-to-github', async (req, res) => {
  try {
    const result = await pushGeneratedFlowToGithub({
      nodes: req.body?.nodes || [],
      edges: req.body?.edges || [],
      repoUrl: req.body?.repoUrl,
      commitMessage: req.body?.commitMessage,
      generatedCodeDir: GENERATED_CODE_DIR,
      generateGoCode,
      extractDatabaseSchemas,
      generateReadme,
    });
    res.json(result);
  } catch (error) {
    console.error('Push to GitHub error:', error);
    res.json({ success: false, message: error.message });
  }
});

// ===== NEW: Generate and push to per-service repos =====
app.post('/api/generate/push-all', async (req, res) => {
  try {
    console.log('[push-all] request', {
      projectName: req.body?.projectData?.projectName || req.body?.projectName || 'project',
      projectNodeCount: req.body?.projectData?.projectNodes?.length || 0,
    });

    const result = await pushAllGeneratedRepos({
      projectData: req.body?.projectData,
      githubUsername: req.body?.githubUsername,
      workspaceRoot: path.join(__dirname, '..', '..'),
      generateDataGateway,
      generateDataGatewayReadme,
      extractDatabaseSchemas,
      generateServiceCode,
      generateServiceReadme,
    });
    res.json(result);
  } catch (error) {
    console.error('Push all error:', error);
    res.json({ success: false, message: error.message });
  }
});

app.post('/api/server/start-datagateway', async (req, res) => {
  try {
    const gatewayDir = path.join(__dirname, '..', '..', 'datagateway');
    const result = await startDataGateway({
      projectData: req.body?.projectData,
      generateDataGateway,
      gatewayDir,
    });
    res.json(result);
  } catch (error) {
    console.error('Failed to start DataGateway:', error);
    res.json({ success: false, message: error.message });
  }
});

app.post('/api/server/stop-datagateway', async (req, res) => {
  try {
    const result = await stopDataGateway();
    res.json(result);
  } catch (error) {
    console.error('Failed to stop DataGateway:', error);
    res.json({ success: false, message: error.message });
  }
});

app.get('/api/server/status-datagateway', (req, res) => {
  res.json(getDataGatewayStatus());
});

// Cleanup on server shutdown
process.on('SIGINT', () => {
  console.log('Shutting down, stopping all running servers...');
  stopAllRunningServers();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Visual Flow Editor API server running on http://localhost:${PORT}`);
});

