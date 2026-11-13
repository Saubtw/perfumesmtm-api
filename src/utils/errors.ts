export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const unavailable = (service: string) => new HttpError(503, 'SERVICE_UNAVAILABLE', `${service} no está configurado o no está disponible.`);
