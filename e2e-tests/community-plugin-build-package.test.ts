import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import * as tar from 'tar';
import axios from 'axios';

const exec = promisify(require('child_process').exec);

const CONTAINER_TOOL = process.env.CONTAINER_TOOL || 'podman';

const LOG_PREFIX = '[e2e]';

function log(msg: string): void {
  console.log(`${LOG_PREFIX} ${msg}`);
}

function logSection(title: string): void {
  console.log(`${LOG_PREFIX} --- ${title} ---`);
}

async function downloadFile(url: string, file: string): Promise<void> {
  log(`Downloading ${url} -> ${file}`);
  const response = await axios({
    method: 'GET',
    url: url,
    responseType: 'stream',
  });

  const fileStream = fs.createWriteStream(file);
  response.data.pipe(fileStream);

  return new Promise((resolve, reject) => {
    fileStream.on('finish', resolve);
    fileStream.on('error', reject);
    response.data.on('error', reject);
  });
}

async function runCommand(
  command: string,
  options: { cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  const cwd = options.cwd || process.cwd();

  try {
    const { stdout, stderr } = await exec(command, {
      shell: true,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
      ...options,
    });
    return { stdout, stderr };
  } catch (err: unknown) {
    const e = err as {
      code?: string | number;
      signal?: string;
      stdout?: string;
      stderr?: string;
    };
    const out = (e.stdout ?? '').trim() || '(empty)';
    const errOut = (e.stderr ?? '').trim() || '(empty)';
    const enrichedMessage = [
      `Command failed: ${command}`,
      `Cwd: ${cwd}`,
      `Exit code: ${e.code ?? 'N/A'} | Signal: ${e.signal ?? 'N/A'}`,
      '--- stdout ---',
      out,
      '--- stderr ---',
      errOut,
    ].join('\n');

    console.error(`${LOG_PREFIX} COMMAND FAILED: ${command}`);
    console.error(`${LOG_PREFIX} cwd: ${cwd}`);
    console.error(`${LOG_PREFIX} --- stdout ---\n${out}`);
    console.error(`${LOG_PREFIX} --- stderr ---\n${errOut}`);

    throw new Error(enrichedMessage);
  }
}

async function parseDynamicPluginAnnotation(
  imageAnnotations: Record<string, string>,
): Promise<object[]> {
  const dynamicPackagesAnnotation =
    imageAnnotations['io.backstage.dynamic-packages'];
  return JSON.parse(
    Buffer.from(dynamicPackagesAnnotation, 'base64').toString('utf-8'),
  );
}

async function getImageMetadata(image: string): Promise<{
  annotations: Record<string, string>;
  labels: Record<string, string>;
}> {
  const { stdout } = await runCommand(`${CONTAINER_TOOL} inspect ${image}`);
  const imageInfo = JSON.parse(stdout)[0];
  return {
    annotations: imageInfo.Annotations || {},
    labels: imageInfo.Labels || {},
  };
}

// you can use COMMUNITY_PLUGINS_REPO_ARCHIVE env variable to specify a path existing local archive of the community plugins repository
// this is useful to avoid downloading the archive every time
// e.g. COMMUNITY_PLUGINS_REPO_ARCHIVE=/path/to/archive.tar.gz
// if not set, it will download the archive from the specified REPO_URL
describe('export and package backstage-community plugin', () => {
  const TEST_TIMEOUT = 5 * 60 * 1000;
  const RHDH_CLI = path.resolve(__dirname, '../bin/rhdh-cli');
  const REPO_URL =
    'https://github.com/backstage/community-plugins/archive/refs/heads/main.tar.gz';

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhdh-cli-e2e-'));
  const getClonedRepoPath = () => path.join(tmpDir, 'community-plugins-main');

  jest.setTimeout(TEST_TIMEOUT);

  beforeAll(async () => {
    logSection('Setup');
    log(`rhdh-cli: ${RHDH_CLI}`);
    log(`workspace: ${tmpDir}`);
    log(`container tool: ${CONTAINER_TOOL}`);

    let communityPluginsArchivePath = path.join(
      tmpDir,
      'community-plugins.tar.gz',
    );

    if (process.env.COMMUNITY_PLUGINS_REPO_ARCHIVE) {
      communityPluginsArchivePath = process.env.COMMUNITY_PLUGINS_REPO_ARCHIVE;
      log(`Community plugins: path from env: ${communityPluginsArchivePath}`);
    }

    if (fs.existsSync(communityPluginsArchivePath)) {
      log(
        `Community plugins: using existing archive (skipping download): ${communityPluginsArchivePath}`,
      );
    } else {
      log(`Community plugins: archive not found, downloading from ${REPO_URL}`);
      await downloadFile(REPO_URL, communityPluginsArchivePath);
      log(`Community plugins: downloaded to ${communityPluginsArchivePath}`);
    }

    log(`Community plugins: extracting to ${getClonedRepoPath()}`);
    fs.mkdirSync(getClonedRepoPath(), { recursive: true });
    await tar.x({
      file: communityPluginsArchivePath,
      cwd: getClonedRepoPath(),
      strip: 1,
      sync: true,
    });
  });

  afterAll(async () => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.removeSync(tmpDir);
    }
  });

  describe.each([
    [
      'workspaces/tech-radar',
      'plugins/tech-radar',
      `rhdh-test-tech-radar-frontend:${Date.now()}`,
    ],
    [
      'workspaces/tech-radar',
      'plugins/tech-radar-backend',
      `rhdh-test-tech-radar-backend:${Date.now()}`,
    ],
  ])('plugin in %s/%s directory', (workspacePath, pluginRelPath, imageTag) => {
    const getWorkspacePath = () =>
      path.join(getClonedRepoPath(), workspacePath);
    const getFullPluginPath = () =>
      path.join(getClonedRepoPath(), workspacePath, pluginRelPath);

    beforeAll(async () => {
      logSection(`Plugin: ${workspacePath}/${pluginRelPath}`);
      log(`Installing dependencies in workspace ${getWorkspacePath()}`);
      // Use YARN_ENABLE_SCRIPTS=false to skip native module builds that may fail
      await runCommand(`YARN_ENABLE_SCRIPTS=false yarn install`, {
        cwd: getWorkspacePath(),
      });
      log(`Generating TypeScript declarations in ${getWorkspacePath()}`);
      await runCommand(`yarn tsc`, {
        cwd: getWorkspacePath(),
      });
      log(`Building plugin in ${getFullPluginPath()}`);
      await runCommand(`yarn build`, {
        cwd: getFullPluginPath(),
      });
    });

    afterAll(async () => {
      log(`Cleaning up image: ${imageTag}`);
      await runCommand(`${CONTAINER_TOOL} rmi -f ${imageTag}`);
    });

    test('should export the plugin', async () => {
      await runCommand(`${RHDH_CLI} plugin export`, {
        cwd: getFullPluginPath(),
      });

      expect(
        fs.existsSync(
          path.join(getFullPluginPath(), 'dist-dynamic/package.json'),
        ),
      ).toEqual(true);

      const packageJsonPath = path.join(getFullPluginPath(), 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const role = packageJson.backstage?.role;
      if (role === 'frontend-plugin') {
        // eslint-disable-next-line jest/no-conditional-expect
        expect(
          fs.existsSync(
            path.join(
              getFullPluginPath(),
              'dist-dynamic/dist-scalprum/plugin-manifest.json',
            ),
          ),
        ).toEqual(true);
      }
    });

    test('should package the plugin', async () => {
      await runCommand(
        `${RHDH_CLI} plugin package --tag ${imageTag} --annotation "maintainer=rhdh-team" --label "version=1.0.0" --label "environment=test"`,
        {
          cwd: getFullPluginPath(),
        },
      );

      const imageMetadata = await getImageMetadata(imageTag);
      log(`Image annotations: ${JSON.stringify(imageMetadata.annotations)}`);
      log(`Image labels: ${JSON.stringify(imageMetadata.labels)}`);

      // There needs to be at least one annotation (the default dynamic plugin annotation)
      expect(imageMetadata.annotations).not.toBeNull();
      expect(Object.keys(imageMetadata.annotations).length).toBeGreaterThan(0);
      const dynamicPluginAnnotation = await parseDynamicPluginAnnotation(
        imageMetadata.annotations,
      );
      const key = Object.keys(dynamicPluginAnnotation[0])[0];
      const pluginInfo = dynamicPluginAnnotation[0][key];

      // Check custom annotation
      expect(imageMetadata.annotations.maintainer).toBe('rhdh-team');

      // Check custom labels
      expect(imageMetadata.labels.version).toBe('1.0.0');
      expect(imageMetadata.labels.environment).toBe('test');

      const pluginJson = JSON.parse(
        fs.readFileSync(
          path.join(getFullPluginPath(), 'dist-dynamic', 'package.json'),
          'utf-8',
        ),
      );
      expect(pluginInfo.name).toEqual(pluginJson.name);
      expect(pluginInfo.version).toEqual(pluginJson.version);
      expect(pluginInfo.backstage).toEqual(pluginJson.backstage);

      const { stdout } = await runCommand(
        `${CONTAINER_TOOL} create --workdir / ${imageTag} 'false'`,
      );
      const containerId = stdout.trim();
      const imageContentDir = path.join(getFullPluginPath(), imageTag);
      fs.mkdirSync(imageContentDir);
      await runCommand(
        `${CONTAINER_TOOL} cp ${containerId}:/ ${imageContentDir}`,
      );
      await runCommand(`${CONTAINER_TOOL} rm ${containerId}`);

      await runCommand(`ls -lah ${path.join(imageContentDir, key)}`);
      await runCommand(
        `ls -lah ${path.join(getFullPluginPath(), 'dist-dynamic')}`,
      );

      const filesInImage = fs.readdirSync(path.join(imageContentDir, key));
      const filesInDerivedPackage = fs.readdirSync(
        path.join(getFullPluginPath(), 'dist-dynamic'),
      );
      expect(filesInImage.length).toEqual(filesInDerivedPackage.length);

      const indexJson = JSON.parse(
        fs.readFileSync(path.join(imageContentDir, 'index.json'), 'utf-8'),
      );
      expect(indexJson).toEqual(dynamicPluginAnnotation);
    });
  });
});
