import type { FastifyPluginAsync } from 'fastify';

import type { AppContainer } from '../container.js';

export type GatewayContainer = AppContainer;

/** Every route-group plugin (auth, agents, registries, admin, events, health) has this shape — no per-plugin options needed today. */
export type IGatewayPlugin = FastifyPluginAsync;

declare module 'fastify' {
  interface FastifyInstance {
    container: GatewayContainer;
  }
  interface FastifyRequest {
    requestId: string;
  }
}

export interface ErrorDetail {
  field: string;
  message: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface SuccessResponse<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
  requestId: string;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details: ErrorDetail[];
  };
  requestId: string;
}
