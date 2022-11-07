/* eslint-disable node/no-unpublished-import */
import {parse} from '../src/index';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import {OpenAPIV3} from 'openapi-types';

const doc = yaml.load(
  fs.readFileSync(process.env.SPEC_FILE_PATH!, 'utf8')
) as OpenAPIV3.Document;

describe('index', () => {
  test('default', async () => {
    const parsed = parse(doc);
    const jsonStr = JSON.stringify(parsed, null, 2);
    fs.writeFileSync(path.join(__dirname, 'parsed.json'), jsonStr);
    expect(parsed.models).toBeDefined();
    expect(parsed.models.length).toBeGreaterThan(0);
    expect(parsed.paths).toBeDefined();
    expect(parsed.paths.length).toBeGreaterThan(0);

    const extensionPath = parsed.paths.find(
      path => path.paths.join('-') === 'restapi-account-extension'
    )!;
    expect(extensionPath.parameter).toBe('extensionId');

    const pagingOnlyGroupPath = parsed.paths.find(
      path => path.paths.join('-') === 'restapi-account-paging-only-groups'
    )!;
    expect(pagingOnlyGroupPath.parameter).toBe('pagingOnlyGroupId');

    const brandPath = parsed.paths.find(
      path => path.paths.join('-') === 'restapi-dictionary-brand'
    )!;
    expect(brandPath.parameter).toBe('brandId');

    const scimPath = parsed.paths.find(
      path => path.paths.join('-') === 'scim'
    )!;
    expect(scimPath.parameter).toBe('version');
    expect(scimPath.defaultParameter).toBe('v2');
  });
});
