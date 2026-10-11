// Pix keys as the Central Bank defines them, and as PayZu names their types: cpf, cnpj,
// phone, email and evp (the random key). A key is parsed once, at the cadastro, and what
// goes on a screen is always the masked form. CPF and CNPJ are checked by their own check
// digits, so a typo doesn't reach the Pix network; the same CPF check is what the cadastro
// uses for the document itself.

export type PixKeyType = 'cpf' | 'cnpj' | 'phone' | 'email' | 'evp';

export interface PixKey {
  type: PixKeyType;
  // Normalized for the provider: digits only for cpf/cnpj, E.164 for phone, lowercase email.
  value: string;
  masked: string;
}

export class InvalidKey extends Error {}

const digits = (value: string) => value.replace(/\D/g, '');
const allSame = (value: string) => /^(\d)\1*$/.test(value);

// Both documents end in check digits computed from the ones before them, each with its own
// weights: 10..2 over the first nine for a CPF, 5..2 then 9..2 over the first twelve for a CNPJ.
function checkDigit(base: string, weights: number[]): string {
  const sum = weights.reduce((total, weight, i) => total + Number(base[i]) * weight, 0);
  const rest = sum % 11;
  return String(rest < 2 ? 0 : 11 - rest);
}

const down = (from: number, length: number) => Array.from({ length }, (_, i) => from - i);
const CNPJ_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_2 = [6, ...CNPJ_1];

export function isCpf(value: string): boolean {
  const cpf = digits(value);
  if (cpf.length !== 11 || allSame(cpf)) return false;
  return cpf[9] === checkDigit(cpf, down(10, 9)) && cpf[10] === checkDigit(cpf, down(11, 10));
}

export function isCnpj(value: string): boolean {
  const cnpj = digits(value);
  if (cnpj.length !== 14 || allSame(cnpj)) return false;
  return cnpj[12] === checkDigit(cnpj, CNPJ_1) && cnpj[13] === checkDigit(cnpj, CNPJ_2);
}

// 123.456.789-09 -> •••.456.789-••   Enough to recognize your own, not enough to reuse.
export function maskCpf(value: string): string {
  const cpf = digits(value);
  return `•••.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-••`;
}

export function maskCnpj(value: string): string {
  const cnpj = digits(value);
  return `••.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-••`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EVP = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A Brazilian number in E.164: +55, an area code that exists, and then either a mobile
// (9 plus eight digits) or a landline (2 to 5, plus seven). Checking the area code is what
// tells eleven digits that are a CPF from eleven digits that are a phone.
const AREA_CODES = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

function isBrazilianPhone(e164: string): boolean {
  if (!/^55\d{10,11}$/.test(e164)) return false;
  if (!AREA_CODES.has(Number(e164.slice(2, 4)))) return false;
  const line = e164.slice(4);
  return line.length === 9 ? line.startsWith('9') : /^[2-5]/.test(line);
}

export function parsePixKey(input: string): PixKey {
  const value = input.trim();
  if (!value) throw new InvalidKey('digite uma chave Pix');

  if (EMAIL.test(value)) {
    const email = value.toLowerCase();
    const [user, domain] = email.split('@');
    return { type: 'email', value: email, masked: `${user[0]}•••@${domain}` };
  }

  if (EVP.test(value)) {
    const evp = value.toLowerCase();
    return { type: 'evp', value: evp, masked: `${evp.slice(0, 8)}…${evp.slice(-4)}` };
  }

  const only = digits(value);
  if (isCpf(only)) return { type: 'cpf', value: only, masked: maskCpf(only) };
  if (isCnpj(only)) return { type: 'cnpj', value: only, masked: maskCnpj(only) };

  // A phone may come as +55 81 99999-8888, 81 99999-8888 or 081999998888.
  const phone = only.startsWith('55') && only.length > 11 ? only : `55${only.replace(/^0+/, '')}`;
  if (isBrazilianPhone(phone)) {
    const area = phone.slice(2, 4);
    return { type: 'phone', value: `+${phone}`, masked: `+55 ${area} •••••-${phone.slice(-4)}` };
  }

  if (only.length === 11) throw new InvalidKey('o CPF da chave não passa no dígito verificador');
  if (only.length === 14) throw new InvalidKey('o CNPJ da chave não passa no dígito verificador');
  if (value.includes('@')) throw new InvalidKey('confira o e-mail da chave: falta o @ ou o domínio');
  throw new InvalidKey('chave Pix não reconhecida: use e-mail, telefone, CPF, CNPJ ou chave aleatória');
}
