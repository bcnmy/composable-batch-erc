import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
} from "axios";
import { Service } from "typedi";
import { ApiError, ApiResponse } from "./interfaces";

@Service()
export class ApiCallService {
  private axiosInstanceCache: Map<string, AxiosInstance> = new Map();

  getAxios(
    baseURL: string,
    timeout = 30000,
    headers: Record<string, string> = {},
  ) {
    // Normalize headers for consistent cache keys
    const normalizedHeaders = Object.keys(headers)
      .sort()
      .reduce(
        (acc, key) => {
          acc[key.toLowerCase()] = headers[key];
          return acc;
        },
        {} as Record<string, string>,
      );

    // Content-Type is always set to application/json, so include it in the cache key
    const cacheKey = JSON.stringify({
      baseURL,
      timeout,
      headers: {
        "content-type": "application/json",
        ...normalizedHeaders,
      },
    });

    let axiosInstance = this.axiosInstanceCache.get(cacheKey);

    if (!axiosInstance) {
      axiosInstance = axios.create({
        baseURL,
        timeout,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
      });

      this.axiosInstanceCache.set(cacheKey, axiosInstance);
    }

    return axiosInstance;
  }

  private handleError(error: AxiosError): ApiError {
    const apiError: ApiError = {
      message: "Something went wrong",
      timestamp: new Date().toISOString(),
      isApiError: true,
      code: "SOMETHING_WENT_WRONG_ERROR",
    };

    if (error.response) {
      apiError.message =
        (error.response.data as { message: string | undefined })?.message ||
        `Request failed with status ${error.response.status}`;
      apiError.status = error.response.status;
      apiError.data = error.response.data;
      apiError.url = error.config?.url;
    } else if (error.request) {
      // The request was made but no response was received
      apiError.message = "No response received from server";
      apiError.code = "NO_RESPONSE";
    }

    return apiError;
  }

  private processResponse<T>(response: AxiosResponse): ApiResponse<T> {
    return {
      data: response.data,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers as Record<string, string>,
    };
  }

  async get<T>(
    client: AxiosInstance,
    url: string,
    params?: Record<string, unknown>,
    config?: AxiosRequestConfig,
  ): Promise<ApiResponse<T>> {
    try {
      const response = await client.get<T>(url, {
        params,
        ...config,
      });
      return this.processResponse<T>(response);
    } catch (error) {
      const apiError = this.handleError(error as AxiosError);
      throw apiError;
    }
  }

  async post<T, D = unknown>(
    client: AxiosInstance,
    url: string,
    data?: D,
    config?: AxiosRequestConfig,
  ): Promise<ApiResponse<T>> {
    try {
      const response = await client.post<T>(url, data, config);

      return this.processResponse<T>(response);
    } catch (error) {
      const apiError = this.handleError(error as AxiosError);
      throw apiError;
    }
  }

  async put<T, D = unknown>(
    client: AxiosInstance,
    url: string,
    data?: D,
    config?: AxiosRequestConfig,
  ): Promise<ApiResponse<T>> {
    try {
      const response = await client.put<T>(url, data, config);

      return this.processResponse<T>(response);
    } catch (error) {
      const apiError = this.handleError(error as AxiosError);
      throw apiError;
    }
  }

  async delete<T>(
    client: AxiosInstance,
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<ApiResponse<T>> {
    try {
      const response = await client.delete<T>(url, config);

      return this.processResponse<T>(response);
    } catch (error) {
      const apiError = this.handleError(error as AxiosError);
      throw apiError;
    }
  }

  setHeader(client: AxiosInstance, key: string, value: string): AxiosInstance {
    client.defaults.headers.common[key] = value;
    return client;
  }
}
