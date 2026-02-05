import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import * as tar from 'tar';
import axios from 'axios';

const exec = promisify(require('child_process').exec);

const CONTAINER_TOOL = process.env.CONTAINER_TOOL || 'podman';

async function downloadFile(url: string, file: string): Promise<void> {
  console.log(`Downloading file from ${url} to ${file}`);
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
  console.log(
    `Executing command: ${command}, in directory: ${options.cwd || process.cwd()}`,
  );

  try {
    const { stdout, stderr } = await exec(command, {
      shell: true,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
      ...options,
    });
    console.log(`Command output: ${stdout}`);
    if (stderr) {
      console.log(`Command stderr: ${stderr}`);
    }
    return { stdout, stderr };
  } catch (error: any) {
    console.error(`\n========== COMMAND FAILED ==========`);
    console.error(`Command: ${command}`);
    console.error(`Working directory: ${options.cwd || process.cwd()}`);
    console.error(`Exit code: ${error.code}`);
    console.error(`Signal: ${error.signal}`);
    console.error(`\n--- STDOUT ---\n${error.stdout || '(empty)'}`);
    console.error(`\n--- STDERR ---\n${error.stderr || '(empty)'}`);
    console.error(`\n--- ERROR MESSAGE ---\n${error.message}`);
    console.error(`====================================\n`);
    throw error;
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
    console.log(`Using rhdh-cli at: ${RHDH_CLI}`);
    console.log(`Test workspace: ${tmpDir}`);
    console.log(`Container tool: ${CONTAINER_TOOL}`);

    let communityPluginsArchivePath = path.join(
      tmpDir,
      'community-plugins.tar.gz',
    );

    if (process.env.COMMUNITY_PLUGINS_REPO_ARCHIVE) {
      communityPluginsArchivePath = process.env.COMMUNITY_PLUGINS_REPO_ARCHIVE;
      console.log(
        `Using  community plugins repo archive: ${communityPluginsArchivePath}`,
      );
    }

    if (!fs.existsSync(communityPluginsArchivePath)) {
      console.log(`Downloading community plugins archive from: ${REPO_URL}`);
      await downloadFile(REPO_URL, communityPluginsArchivePath);
      console.log(
        `Downloaded community plugins archive to: ${communityPluginsArchivePath}`,
      );
    } else {
      console.log(
        `Using existing community plugins archive: ${communityPluginsArchivePath}`,
      );
    }

    console.log(
      `Extracting community plugins archive to: ${getClonedRepoPath()}`,
    );
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
    const getWorkspacePath = () => path.join(getClonedRepoPath(), workspacePath);
    const getFullPluginPath = () =>
      path.join(getClonedRepoPath(), workspacePath, pluginRelPath);

    beforeAll(async () => {
      console.log(`Installing dependencies in workspace ${getWorkspacePath()}`);
      // Use YARN_ENABLE_SCRIPTS=false to skip native module builds that may fail
      // Then run tsc and build separately
      await runCommand(`YARN_ENABLE_SCRIPTS=false yarn install`, {
        cwd: getWorkspacePath(),
      });
      console.log(`Generating TypeScript declarations in ${getWorkspacePath()}`);
      await runCommand(`yarn tsc`, {
        cwd: getWorkspacePath(),
      });
      console.log(`Building plugin in ${getFullPluginPath()}`);
      await runCommand(`yarn build`, {
        cwd: getFullPluginPath(),
      });
    });

    afterAll(async () => {
      console.log(`Cleaning up image: ${imageTag}`);
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
      console.log(
        `Image annotations: ${JSON.stringify(imageMetadata.annotations)}`,
      );
      console.log(`Image labels: ${JSON.stringify(imageMetadata.labels)}`);

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
