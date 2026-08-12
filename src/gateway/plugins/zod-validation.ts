import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { FastifyInstance } from 'fastify';

/**
 * Registers zod as Fastify's schema validator/serializer (WO-036). Once
 * set on the root instance, every route below it that declares zod
 * schemas under `schema.body`/`querystring`/`params`/`headers` gets
 * request validation for free — invalid requests never reach a handler,
 * they're caught by `errorHandlerPlugin`'s `hasZodFastifySchemaValidationErrors`
 * branch and turned into a structured 400. Route files should call
 * `fastify.withTypeProvider<ZodTypeProvider>()` when defining schema'd
 * routes to get fully-typed `request.body`/`query`/`params` (no `any`).
 */
export async function zodValidationPlugin(app: FastifyInstance): Promise<void> {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
}
