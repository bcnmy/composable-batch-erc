export const API_VERSION = "v1";

export const PATHS = {
  index: `/${API_VERSION}`,
  info: `/${API_VERSION}/info`,
  explorer: `/${API_VERSION}/explorer/`,
  quote: `/${API_VERSION}/quote`,
  quotePermit: `/${API_VERSION}/quote-permit`,
  exec: `/${API_VERSION}/exec`,
} as const;
