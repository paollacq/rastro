// An error the API can hand to the caller as is: a status code and a message in
// Portuguese, written for the person on the other side of the screen.
export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, `${what} não encontrado`);

// One line out of whatever viem or fetch threw, for logs and the failure column.
export function shortError(error: unknown): string {
  if (error && typeof error === 'object' && 'shortMessage' in error && typeof error.shortMessage === 'string') {
    return error.shortMessage;
  }
  return error instanceof Error ? error.message.split('\n')[0] : String(error);
}
