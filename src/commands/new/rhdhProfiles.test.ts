import {
  applyRhdhTemplateRoleOverlay,
  getRhdhProfile,
  resolveRhdhProfile,
  RhdhProfileDefinition,
} from './rhdhProfiles';

describe('getRhdhProfile', () => {
  it('falls back from an unlisted patch to its minor-line baseline', () => {
    expect(getRhdhProfile('2.1.1')).toEqual(getRhdhProfile('2.1.0'));
  });
});

describe('resolveRhdhProfile', () => {
  const baseline: RhdhProfileDefinition = {
    templatePackageVersion: '1.0.0',
    packageManager: 'yarn@4.0.0',
    devDependencies: { inherited: '1.0.0', overridden: '1.0.0' },
    resolutions: { resolution: '1.0.0' },
    templateRoleOverlays: {
      'frontend-plugin': {
        devDependencies: { frontend: '1.0.0' },
        resolutions: { frontendResolution: '1.0.0' },
      },
    },
  };

  it('inherits scalars and merges dependency maps from a patch baseline', () => {
    expect(
      resolveRhdhProfile(
        {
          '2.1.0': baseline,
          '2.1.1': {
            extends: '2.1.0',
            packageManager: 'yarn@4.1.0',
            devDependencies: { overridden: '1.1.0', added: '1.1.0' },
            resolutions: { resolution: '1.1.0', resolutionAdded: '1.1.0' },
            templateRoleOverlays: {
              'frontend-plugin': {
                devDependencies: { frontendAdded: '1.1.0' },
                resolutions: { frontendResolution: '1.1.0' },
              },
            },
          },
        },
        '2.1.1',
      ),
    ).toEqual({
      templatePackageVersion: '1.0.0',
      packageManager: 'yarn@4.1.0',
      devDependencies: {
        inherited: '1.0.0',
        overridden: '1.1.0',
        added: '1.1.0',
      },
      resolutions: { resolution: '1.1.0', resolutionAdded: '1.1.0' },
      templateRoleOverlays: {
        'frontend-plugin': {
          devDependencies: { frontend: '1.0.0', frontendAdded: '1.1.0' },
          resolutions: { frontendResolution: '1.1.0' },
        },
      },
    });
  });

  it('applies only the requested upstream template role overlay', () => {
    const frontend = applyRhdhTemplateRoleOverlay(
      resolveRhdhProfile({ baseline }, 'baseline'),
      'frontend-plugin',
    );
    const backend = applyRhdhTemplateRoleOverlay(
      resolveRhdhProfile({ baseline }, 'baseline'),
      'backend-plugin',
    );

    expect(frontend.devDependencies).toMatchObject({ frontend: '1.0.0' });
    expect(frontend.resolutions).toMatchObject({
      frontendResolution: '1.0.0',
    });
    expect(backend.devDependencies).not.toHaveProperty('frontend');
    expect(backend.resolutions).not.toHaveProperty('frontendResolution');
  });

  it('rejects a missing parent profile', () => {
    expect(() =>
      resolveRhdhProfile({ '2.1.1': { extends: '2.1.0' } }, '2.1.1'),
    ).toThrow('RHDH profile "2.1.0" does not exist.');
  });

  it('rejects cyclic profile inheritance', () => {
    expect(() =>
      resolveRhdhProfile(
        {
          '2.1.0': { extends: '2.1.1' },
          '2.1.1': { extends: '2.1.0' },
        },
        '2.1.0',
      ),
    ).toThrow('RHDH profile inheritance cycle: 2.1.0 -> 2.1.1 -> 2.1.0.');
  });
});
