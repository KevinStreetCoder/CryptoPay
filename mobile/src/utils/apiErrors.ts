import { AxiosError } from "axios";

export interface AppError {
  title: string;
  message: string;
  code?: string;
  statusCode?: number;
  retry?: boolean;
}

const ERROR_MESSAGES: Record<number, { title: string; message: string }> = {
  400: { title: "Invalid Request", message: "Please check your input and try again." },
  401: { title: "Session Expired", message: "Please log in again to continue." },
  403: { title: "Access Denied", message: "You don't have permission for this action." },
  404: { title: "Not Found", message: "The requested resource was not found." },
  408: { title: "Request Timeout", message: "The request took too long. Please try again." },
  429: { title: "Too Many Requests", message: "Please wait a moment before trying again." },
  500: { title: "Server Error", message: "Something went wrong on our end. Please try again later." },
  502: { title: "Service Unavailable", message: "Our servers are temporarily unavailable." },
  503: { title: "Service Unavailable", message: "We're performing maintenance. Please try again soon." },
};

export function normalizeError(error: unknown): AppError {
  // Axios error with response
  if (error instanceof AxiosError) {
    const status = error.response?.status;
    const data = error.response?.data;

    // Server returned a structured error
    if (data) {
      const serverMessage =
        data.error ||
        data.detail ||
        data.message ||
        (data.non_field_errors && data.non_field_errors[0]) ||
        null;

      // Field-level validation errors
      if (typeof data === "object" && !serverMessage) {
        const fieldErrors = Object.entries(data)
          .filter(([key]) => key !== "status" && key !== "code")
          .map(([key, val]) => {
            const msg = Array.isArray(val) ? val[0] : val;
            return `${key}: ${msg}`;
          })
          .join("\n");

        if (fieldErrors) {
          return {
            title: "Validation Error",
            message: fieldErrors,
            statusCode: status,
            retry: false,
          };
        }
      }

      if (serverMessage) {
        const defaults = status ? ERROR_MESSAGES[status] : undefined;
        return {
          title: defaults?.title || "Error",
          message: String(serverMessage),
          statusCode: status,
          code: data.code,
          retry: status ? status >= 500 : false,
        };
      }
    }

    // No response data — use status code mapping
    if (status && ERROR_MESSAGES[status]) {
      return {
        ...ERROR_MESSAGES[status],
        statusCode: status,
        retry: status >= 500,
      };
    }

    // Network error
    if (error.code === "ERR_NETWORK" || !error.response) {
      return {
        title: "No Connection",
        message: "Please check your internet connection and try again.",
        retry: true,
      };
    }

    // Timeout
    if (error.code === "ECONNABORTED") {
      return {
        title: "Request Timeout",
        message: "The request took too long. Please try again.",
        retry: true,
      };
    }
  }

  // Generic Error
  if (error instanceof Error) {
    return {
      title: "Error",
      message: error.message,
      retry: false,
    };
  }

  return {
    title: "Unexpected Error",
    message: "Something went wrong. Please try again.",
    retry: true,
  };
}
