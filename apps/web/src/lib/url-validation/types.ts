export const MAX_URL_LENGTH = 2048;

export type ValidationError =
  | { code: 'invalid_body'; message: string }
  | { code: 'invalid_url'; message: string }
  | { code: 'invalid_scheme'; message: string }
  | { code: 'too_long'; message: string }
  | { code: 'denylisted'; message: string; hostname: string }
  | { code: 'private_ip'; message: string; hostname: string; address: string }
  | { code: 'dns_failure'; message: string; hostname: string };

export type ValidationOk = {
  ok: true;
  normalizedUrl: string;
  hostname: string;
};

export type ValidationResult = ValidationOk | ({ ok: false } & ValidationError);
