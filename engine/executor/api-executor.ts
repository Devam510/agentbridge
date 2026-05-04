/**
 * api-executor.ts
 * Executes capabilities via native REST APIs when available.
 * WHY: APIs are 10-100x faster and far more reliable than browser automation.
 */

import axios, { AxiosError, Method } from 'axios';
import { Capability } from '../inferrer/capability-map.js';

export interface ApiExecuteOptions {
  capability: Capability;
  params: Record<string, unknown>;
  targetUrl: string;
  apiCredentials?: Record<string, string>; // Headers or tokens for API access
}

export interface ApiExecuteResult {
  success: boolean;
  data: Record<string, unknown>;
  errorMessage?: string;
  statusCode?: number;
}

export async function executeApi(options: ApiExecuteOptions): Promise<ApiExecuteResult> {
  const { capability, params, targetUrl, apiCredentials } = options;

  // Infer HTTP method based on risk level if not explicitly defined
  let method: Method = 'POST';
  if (capability.riskLevel === 'safe') method = 'GET';
  if (capability.riskLevel === 'destructive') method = 'DELETE';
  // Note: some systems use POST for everything, but this is a heuristic

  // Construct URL
  const endpoint = capability.sourceLocation.startsWith('http')
    ? capability.sourceLocation
    : `${targetUrl.replace(/\/$/, '')}/${capability.sourceLocation.replace(/^\//, '')}`;

  // Build request config
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'AgentBridge-HybridExecutor/1.0',
    ...(apiCredentials || {}),
  };

  const reqConfig = {
    method,
    url: endpoint,
    headers,
    timeout: 10000,
    data: method !== 'GET' ? params : undefined,
    params: method === 'GET' ? params : undefined,
  };

  try {
    const response = await axios(reqConfig);
    
    // Normalize response data to always be an object
    let data: Record<string, unknown> = {};
    if (typeof response.data === 'object' && response.data !== null) {
      data = response.data as Record<string, unknown>;
    } else {
      data = { result: response.data };
    }

    return {
      success: response.status >= 200 && response.status < 300,
      data,
      statusCode: response.status,
    };
  } catch (error) {
    const axiosError = error as AxiosError;
    let errorMessage = axiosError.message;
    
    if (axiosError.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      errorMessage = `API Error (${axiosError.response.status}): ${JSON.stringify(axiosError.response.data)}`;
    } else if (axiosError.request) {
      // The request was made but no response was received
      errorMessage = 'API Error: No response received from target server';
    }

    return {
      success: false,
      data: {},
      errorMessage,
      statusCode: axiosError.response?.status,
    };
  }
}
