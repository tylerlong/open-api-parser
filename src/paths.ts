import {OpenAPIV3} from 'openapi-types';
import R from 'ramda';

import {Path, ResponseSchema} from './types';
import {lowerCaseFirstLetter} from './utils';

export const parsePaths = (_doc: OpenAPIV3.Document): Path[] => {
  const doc = R.clone(_doc);
  let result: Path[] = [];
  const paths = Object.keys(doc.paths).sort((item1, item2) =>
    item1.length > item2.length ? 1 : -1
  );
  for (const item of paths) {
    if (process.env.API_PARSER_DEBUG === 'true') {
      console.debug('processing endpoint', item);
    }
    const pathContent = doc.paths[item]! as {
      [key: string]: OpenAPIV3.OperationObject & {[key: string]: string};
    };
    const endpoint = item
      .replace(/\/restapi\/v1\.0\//, '/restapi/{apiVersion}/')
      .replace(/\/scim\/v2/, '/scim/{version}')
      .replace(/\/team-messaging\/v1/, '/team-messaging/{version}')
      .replace(/\/analytics\/calls\/v1/, '/analytics/calls/{version}')
      .replace(/\/rcvideo\/v1/, '/rcvideo/{version}')
      .replace(/\/\.search/, '/dotSearch');
    const path: Path = {
      paths: endpoint.split('/').filter(t => t !== '' && !t.startsWith('{')),
      operations: [],
    };
    if (endpoint.endsWith('}')) {
      path.parameter = endpoint.split('/').slice(-1)[0].slice(1, -1);
      const name = R.last(path.paths);
      switch (name) {
        case 'account':
        case 'extension':
          path.defaultParameter = '~';
          break;
        case 'restapi':
          path.defaultParameter = 'v1.0';
          break;
        default:
          break;
      }
      const matchingResult = R.find(r => R.equals(r.paths, path.paths), result);
      if (matchingResult) {
        path.operations = matchingResult.operations;
        if ('get' in pathContent) {
          const getOperation = R.find(
            o => o.method2 === 'get',
            path.operations
          );
          if (getOperation) {
            getOperation.method2 = 'list';
          }
        }
        if ('delete' in pathContent) {
          const deleteOperation = R.find(
            o => o.method2 === 'delete',
            path.operations
          );
          if (deleteOperation) {
            deleteOperation.method2 = 'deleteAll';
          }
        }
      }
      result = result.filter(r => !R.equals(r.paths, path.paths));
    }
    for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
      if (method in pathContent) {
        const operation = pathContent[method];
        if (operation.deprecated === true) {
          continue;
        }

        if (process.env.API_PARSER_DEBUG === 'true') {
          console.debug('processing HTTP', method);
        }

        // responseSchema
        const responses = operation.responses!;
        const responseContent = (
          (responses[200] ||
            responses[201] ||
            responses[202] ||
            responses[204] ||
            responses[205] ||
            responses[302] ||
            responses[501] ||
            responses.default) as OpenAPIV3.ResponseObject
        ).content;
        let responseSchema: ResponseSchema | undefined = undefined;
        if (responseContent && !R.isEmpty(responseContent)) {
          responseSchema =
            responseContent[Object.keys(responseContent)[0]].schema;
          if (responseSchema?.$ref) {
            responseSchema.$ref = R.last(responseSchema?.$ref.split('/'));
          }
        }

        // queryParameters
        let queryParameters: string | undefined = undefined;
        if (
          operation.parameters?.some(
            p => (p as OpenAPIV3.ParameterObject).in === 'query'
          )
        ) {
          queryParameters = `${operation.operationId}Parameters`;
        }

        // bodyParameters
        let bodyParameters: string | undefined = undefined;
        let formUrlEncoded: boolean | undefined = undefined;
        let multipart: boolean | undefined = undefined;
        if (operation.requestBody) {
          const requestContent = (
            operation.requestBody as OpenAPIV3.RequestBodyObject
          ).content;
          const mediaTypeObject =
            requestContent['application/x-www-form-urlencoded'] ||
            requestContent['multipart/form-data'];
          if (mediaTypeObject) {
            if (requestContent['application/x-www-form-urlencoded']) {
              formUrlEncoded = true;
            } else {
              multipart = true;
            }
            const refObj = mediaTypeObject.schema as OpenAPIV3.ReferenceObject;
            if (refObj.$ref) {
              bodyParameters = R.last(refObj.$ref.split('/'));
            } else {
              bodyParameters = `${operation.operationId}Request`;
            }
          } else {
            const refObj = requestContent[Object.keys(requestContent)[0]]
              .schema as OpenAPIV3.ReferenceObject;
            if (refObj.$ref) {
              bodyParameters = lowerCaseFirstLetter(
                R.last(refObj.$ref!.split('/'))!
              );
            } else {
              // inline json request body schema
              bodyParameters = `${operation.operationId}Request`;
            }
          }
        }

        path.operations.push({
          endpoint,
          method,
          tags: operation.tags,
          method2: method,
          description: operation.description,
          summary: operation.summary,
          operationId: operation.operationId!,
          rateLimitGroup: operation['x-throttling-group'],
          appPermission: operation['x-app-permission'],
          userPermission: operation['x-user-permission'],
          withParameter: endpoint.endsWith('}'),
          responseSchema,
          queryParameters,
          bodyParameters,
          formUrlEncoded,
          multipart,
        });
      }
    }
    if (path.operations.length > 0) {
      result.push(path);
    }
  }
  const bridgePaths: Path[] = [];
  for (const item of result) {
    for (let i = 1; i < item.paths.length; i++) {
      const subPaths = item.paths.slice(0, i);
      if (
        !R.find(r => R.equals(r.paths, subPaths), bridgePaths) &&
        !R.find(r => R.equals(r.paths, subPaths), result)
      ) {
        const lastToken = R.last(subPaths);
        const endpoint = item.operations[0].endpoint;
        const match = endpoint.match(new RegExp(`/${lastToken}/\\{(.+?)\\}`));
        let parameter: string | undefined = undefined;
        let defaultParameter: string | undefined = undefined;
        if (match !== null) {
          parameter = match[1];
          switch (lastToken) {
            case 'scim': {
              defaultParameter = 'v2';
              break;
            }
            case 'rcvideo': {
              defaultParameter = 'v1';
              break;
            }
            case 'team-messaging': {
              defaultParameter = 'v1';
              break;
            }
            case 'calls': {
              defaultParameter = 'v1';
              break;
            }
          }
        }
        bridgePaths.push({
          paths: subPaths,
          operations: [],
          parameter,
          defaultParameter,
        });
      }
    }
  }

  return [...result, ...bridgePaths].sort((path1, path2) =>
    path1.paths.join('/').length > path2.paths.join('/').length ? 1 : -1
  );
};
