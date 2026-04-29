export interface ApiResponse<T> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

export interface ApiError {
  isApiError: true;
  message: string;
  status?: number;
  code?: string;
  data?: unknown;
  timestamp: string;
  url?: string;
}
