/** An error with an HTTP status, shared by the API routes and the MCP server. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
