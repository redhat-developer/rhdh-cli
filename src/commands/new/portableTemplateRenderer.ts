import fs from 'fs-extra';
import handlebars from 'handlebars';
import {
  camelCase,
  kebabCase,
  lowerCase,
  lowerFirst,
  snakeCase,
  startCase,
  upperCase,
  upperFirst,
} from 'lodash';
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import recursive from 'recursive-readdir';

const handlebarsHelpers = {
  camelCase,
  kebabCase,
  lowerCase,
  lowerFirst,
  snakeCase,
  startCase,
  upperCase,
  upperFirst,
};

export async function renderPortableTemplate(
  templateDir: string,
  destinationDir: string,
  context: Record<string, unknown>,
  versionProvider: (name: string, versionHint?: string) => string,
  templatedValues: Record<string, string>,
): Promise<void> {
  const files = await recursive(templateDir).catch(error => {
    throw new Error(`Failed to read template directory: ${error.message}`);
  });

  const template = handlebars.create();
  template.registerHelper(handlebarsHelpers);
  template.registerHelper({
    versionQuery(name: string, versionHint: unknown) {
      return versionProvider(
        name,
        typeof versionHint === 'string' ? versionHint : undefined,
      );
    },
  });
  let values = context;
  const destinationRoot = resolve(destinationDir);
  for (const [key, value] of Object.entries(templatedValues)) {
    values = {
      ...values,
      [key]: template.compile(value, { strict: true })(values),
    };
  }

  for (const file of files) {
    const relativeFile = file.slice(templateDir.length + 1);
    if (relativeFile === 'portable-template.yaml') {
      continue;
    }
    const renderedFile = template.compile(relativeFile, { strict: true })(
      values,
    );
    const destinationFile = resolve(destinationRoot, renderedFile);
    const destinationRelative = relative(destinationRoot, destinationFile);
    if (
      destinationRelative === '..' ||
      destinationRelative.startsWith(`..${sep}`) ||
      isAbsolute(destinationRelative)
    ) {
      throw new Error(
        `Template output path escapes destination: ${renderedFile}`,
      );
    }
    await fs.ensureDir(dirname(destinationFile));

    if (file.endsWith('.hbs')) {
      const destination = destinationFile.replace(/\.hbs$/, '');
      const contents = template.compile((await fs.readFile(file)).toString(), {
        strict: true,
      })({ name: basename(destination), ...values });

      await fs.writeFile(destination, contents).catch(error => {
        throw new Error(
          `Failed to create file: ${destination}: ${error.message}`,
        );
      });
    } else {
      await fs.copyFile(file, destinationFile).catch(error => {
        throw new Error(
          `Failed to copy file to ${destinationFile}: ${error.message}`,
        );
      });
    }
  }
}
