import type { RequestContext } from './types';

declare global {
  namespace Express {
    interface Request {
      companyContext?: RequestContext;
    }
  }
}

export {};
