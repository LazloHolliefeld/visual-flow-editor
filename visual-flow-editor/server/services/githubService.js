import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

export function sanitizeRepoName(name) {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unnamed-service';
}

export async function ensureGitHubRepo(username, repoName) {
  return new Promise((resolve) => {
    exec(`gh repo view ${username}/${repoName}`, { shell: 'cmd.exe' }, (error) => {
      if (error) {
        exec(`gh repo create ${repoName} --public --confirm`, { shell: 'cmd.exe' }, (err, stdout, stderr) => {
          if (err && !stderr.includes('already exists')) {
            console.error(`Failed to create repo ${repoName}:`, stderr);
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  });
}

export async function pushToGitHub(dir, repoUrl, message) {
  return new Promise((resolve, reject) => {
    const commands = [];

    if (!fs.existsSync(path.join(dir, '.git'))) {
      commands.push(`cd "${dir}" && git init`);
      commands.push(`cd "${dir}" && git remote add origin ${repoUrl}`);
    }

    commands.push(`cd "${dir}" && git add -A`);
    commands.push(`cd "${dir}" && git commit -m "${message}" --allow-empty`);
    commands.push(`cd "${dir}" && git push -u origin master --force`);

    const fullCommand = commands.join(' && ');

    exec(fullCommand, { shell: 'cmd.exe' }, (error, stdout, stderr) => {
      if (error) {
        if (stderr.includes('nothing to commit') || stdout.includes('nothing to commit')) {
          resolve('No changes to commit');
        } else {
          reject(new Error(stderr || error.message));
        }
      } else {
        resolve(stdout + stderr);
      }
    });
  });
}

export async function pushGeneratedFlowToGithub({
  nodes,
  edges,
  repoUrl,
  commitMessage,
  generatedCodeDir,
  generateGoCode,
  extractDatabaseSchemas,
  generateReadme,
}) {
  if (!repoUrl) {
    return { success: false, message: 'repoUrl is required' };
  }

  if (!fs.existsSync(generatedCodeDir)) {
    fs.mkdirSync(generatedCodeDir, { recursive: true });
  }

  const goCode = generateGoCode(nodes, edges);
  const dbSchemas = extractDatabaseSchemas(nodes);

  fs.writeFileSync(path.join(generatedCodeDir, 'main.go'), goCode);

  const schemaDir = path.join(generatedCodeDir, 'database');
  if (dbSchemas.length > 0) {
    if (!fs.existsSync(schemaDir)) {
      fs.mkdirSync(schemaDir, { recursive: true });
    }

    for (const schema of dbSchemas) {
      const filename = `${schema.database}_schema.sql`;
      fs.writeFileSync(path.join(schemaDir, filename), schema.sql);
    }

    const setupSql = dbSchemas.map((s) => s.sql).join('\n\n');
    fs.writeFileSync(path.join(schemaDir, 'setup.sql'), setupSql);
  }

  const goMod = `module flow-generated-code

go 1.21

require (
	github.com/lib/pq v1.10.9
)
`;
  fs.writeFileSync(path.join(generatedCodeDir, 'go.mod'), goMod);

  const readme = generateReadme(nodes, dbSchemas);
  fs.writeFileSync(path.join(generatedCodeDir, 'README.md'), readme);

  const metadata = {
    generatedAt: new Date().toISOString(),
    nodeCount: nodes.length,
    edgeCount: edges.length,
    databases: dbSchemas.map((s) => s.database),
  };
  fs.writeFileSync(path.join(generatedCodeDir, 'flow-metadata.json'), JSON.stringify(metadata, null, 2));

  const gitResult = await pushToGitHub(generatedCodeDir, repoUrl, commitMessage || 'Update generated code');

  return {
    success: true,
    message: 'Code generated and pushed to GitHub',
    files: ['main.go', 'go.mod', 'README.md', 'flow-metadata.json', ...dbSchemas.map((s) => `database/${s.database}_schema.sql`)],
    gitOutput: gitResult,
  };
}

export async function pushAllGeneratedRepos({
  projectData,
  githubUsername,
  workspaceRoot,
  generateDataGateway,
  generateDataGatewayReadme,
  extractDatabaseSchemas,
  generateServiceCode,
  generateServiceReadme,
}) {
  if (!projectData) {
    return { success: false, message: 'No project data provided' };
  }

  const { projectNodes, serviceFlows } = projectData;
  const repos = [];

  const dbNodes = projectNodes.filter((n) => n.type === 'database' && n.data?.database);
  const serviceNodes = projectNodes.filter((n) => n.type === 'service' && n.data?.name);

  if (dbNodes.length > 0) {
    const gatewayDir = path.join(workspaceRoot, 'datagateway');
    if (!fs.existsSync(gatewayDir)) fs.mkdirSync(gatewayDir, { recursive: true });

    const gatewayCode = generateDataGateway(dbNodes);
    const dbSchemas = extractDatabaseSchemas(projectNodes);

    fs.writeFileSync(path.join(gatewayDir, 'main.go'), gatewayCode.main);
    fs.writeFileSync(path.join(gatewayDir, 'handlers.go'), gatewayCode.handlers);
    fs.writeFileSync(path.join(gatewayDir, 'grpc_server.go'), gatewayCode.grpc);
    fs.writeFileSync(path.join(gatewayDir, 'graphql.go'), gatewayCode.graphql);
    fs.writeFileSync(path.join(gatewayDir, 'go.mod'), gatewayCode.goMod);
    fs.writeFileSync(path.join(gatewayDir, 'README.md'), generateDataGatewayReadme(dbNodes));

    const schemaDir = path.join(gatewayDir, 'database');
    if (!fs.existsSync(schemaDir)) fs.mkdirSync(schemaDir, { recursive: true });
    for (const schema of dbSchemas) {
      fs.writeFileSync(path.join(schemaDir, `${schema.database}_schema.sql`), schema.sql);
    }

    const repoUrl = `https://github.com/${githubUsername}/datagateway.git`;
    await ensureGitHubRepo(githubUsername, 'datagateway');
    await pushToGitHub(gatewayDir, repoUrl, 'Update DataGateway');
    repos.push({ name: 'datagateway', url: repoUrl });
  }

  for (const serviceNode of serviceNodes) {
    const serviceName = sanitizeRepoName(serviceNode.data.name);
    const serviceDir = path.join(workspaceRoot, serviceName);
    if (!fs.existsSync(serviceDir)) fs.mkdirSync(serviceDir, { recursive: true });

    const flow = serviceFlows[serviceNode.id] || { nodes: [], edges: [] };
    const serviceCode = generateServiceCode(serviceNode.data, flow.nodes, flow.edges, dbNodes.length > 0);

    fs.writeFileSync(path.join(serviceDir, 'main.go'), serviceCode.main);
    fs.writeFileSync(path.join(serviceDir, 'handlers.go'), serviceCode.handlers);
    fs.writeFileSync(path.join(serviceDir, 'go.mod'), serviceCode.goMod);
    fs.writeFileSync(path.join(serviceDir, 'README.md'), generateServiceReadme(serviceNode.data, flow));

    const repoUrl = `https://github.com/${githubUsername}/${serviceName}.git`;
    await ensureGitHubRepo(githubUsername, serviceName);
    await pushToGitHub(serviceDir, repoUrl, `Update ${serviceName}`);
    repos.push({ name: serviceName, url: repoUrl });
  }

  return {
    success: true,
    message: `Generated and pushed ${repos.length} repo(s)`,
    repos,
  };
}
