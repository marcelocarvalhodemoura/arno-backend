export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function isUniqueUserConflict(message: string) {
  return message.includes('users_username') || message.includes('users_email');
}
