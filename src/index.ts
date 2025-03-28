#!/usr/bin/env node

import type { AxiosError } from "axios";
const axios = require("axios");
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  McpError,
  ErrorCode,
} = require("@modelcontextprotocol/sdk/types.js");

interface CallToolRequest {
  params: {
    name: string;
    arguments?: {
      prompt?: string;
      prediction_id?: string;
    };
  };
}

interface ReplicateErrorResponse {
  detail?: string;
}

// Check environment variable
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
if (!REPLICATE_API_TOKEN) {
  throw new Error("REPLICATE_API_TOKEN environment variable is required");
}

// Create axios instance
const axiosInstance = axios.create({
  baseURL: "https://api.replicate.com/v1",
  headers: {
    Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
    "Content-Type": "application/json",
    Prefer: "wait",
  },
});

// Generate image function
async function generateImage(prompt: string) {
  try {
    const response = await axiosInstance.post(
      "/models/black-forest-labs/flux-schnell/predictions",
      {
        input: {
          prompt: prompt,
        },
      },
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response.data, null, 2),
        },
      ],
    };
  } catch (error) {
    const axiosError = error as AxiosError<ReplicateErrorResponse>;
    if (axiosError.isAxiosError) {
      const errorMessage =
        axiosError.response?.data?.detail || axiosError.message;
      throw new McpError(
        ErrorCode.InternalError,
        `Replicate API error: ${errorMessage}`,
      );
    }
    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, error.message);
    }
    throw new McpError(ErrorCode.InternalError, String(error));
  }
}

// Get generated image function
async function getGeneratedImage(predictionId: string) {
  try {
    const response = await axiosInstance.get(`/predictions/${predictionId}`);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response.data, null, 2),
        },
      ],
    };
  } catch (error) {
    const axiosError = error as AxiosError<ReplicateErrorResponse>;
    if (axiosError.isAxiosError) {
      const errorMessage =
        axiosError.response?.data?.detail || axiosError.message;
      throw new McpError(
        ErrorCode.InternalError,
        `Replicate API error: ${errorMessage}`,
      );
    }
    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, error.message);
    }
    throw new McpError(ErrorCode.InternalError, String(error));
  }
}
// Create MCP server
const server = new Server(
  {
    name: "flux-schnell-server",
    version: "0.1.1",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "generate_image_via_flux_schnell",
        description:
          "Generate an image using the Flux Schnell model. The generation process may take time and follow these status states: 'starting' (initialization), 'processing' (generating), 'succeeded' (complete), 'failed' (error), or 'canceled'. The response includes a prediction ID that can be used to check status later, along with status information and image URLs when successful. For longer generations, you may receive a 'starting' status and need to use get_generated_image_via_flux_schnell to retrieve the final result.",
        inputSchema: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description:
                "Text prompt for image generation. Be descriptive about the scene, style, colors, and any specific elements you want in the image.",
            },
          },
          required: ["prompt"],
        },
      },
      {
        name: "get_generated_image_via_flux_schnell",
        description:
          "Retrieve the status and results of a previously submitted Flux Schnell image generation job using its prediction ID. Status may be 'starting', 'processing', 'succeeded', 'failed', or 'canceled'. For completed jobs, the response will include the image URL.",
        inputSchema: {
          type: "object",
          properties: {
            prediction_id: {
              type: "string",
              description:
                "The prediction ID returned from a previous generate_image_via_flux_schnell call",
            },
          },
          required: ["prediction_id"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(
  CallToolRequestSchema,
  async (request: CallToolRequest) => {
    if (request.params.name === "generate_image_via_flux_schnell") {
      const prompt = String(request.params.arguments?.prompt);
      if (!prompt) {
        throw new McpError(ErrorCode.InvalidParams, "Prompt is required");
      }
      return generateImage(prompt);
    } else if (request.params.name === "get_generated_image_via_flux_schnell") {
      const predictionId = String(request.params.arguments?.prediction_id);
      if (!predictionId) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Prediction ID is required",
        );
      }
      return getGeneratedImage(predictionId);
    } else {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`,
      );
    }
  },
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Flux Schnell MCP server running on stdio");
}

main().catch((error: unknown) => {
  console.error(
    "Server error:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
