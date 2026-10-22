import SwaggerParser from '@apidevtools/swagger-parser';
import { fileURLToPath } from 'node:url';
const result = await SwaggerParser.validate(fileURLToPath(new URL('../openapi.json',import.meta.url)));
console.log(`Valid OpenAPI ${result.openapi}: ${Object.keys(result.paths).length} paths.`);
