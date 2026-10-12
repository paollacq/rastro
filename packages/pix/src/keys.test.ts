import { describe, expect, it } from 'vitest';
import { InvalidKey, isCnpj, isCpf, maskCpf, parsePixKey } from './keys.ts';

describe('CPF and CNPJ check digits', () => {
  it('accepts well-formed documents, however they are typed', () => {
    expect(isCpf('529.982.247-25')).toBe(true);
    expect(isCpf('52998224725')).toBe(true);
    expect(isCnpj('11.222.333/0001-81')).toBe(true);
  });

  it('refuses a wrong digit, the wrong length and the repeated-digit CPFs', () => {
    expect(isCpf('529.982.247-24')).toBe(false);
    expect(isCpf('5299822472')).toBe(false);
    expect(isCpf('111.111.111-11')).toBe(false);
    expect(isCnpj('11.222.333/0001-80')).toBe(false);
  });

  it('masks a CPF down to the middle digits', () => {
    expect(maskCpf('529.982.247-25')).toBe('•••.982.247-••');
  });
});

describe('Pix keys', () => {
  it('reads each type and masks it for the screen', () => {
    expect(parsePixKey(' Ana.Ribeiro@Example.com ')).toEqual({
      type: 'email',
      value: 'ana.ribeiro@example.com',
      masked: 'a•••@example.com',
    });
    expect(parsePixKey('529.982.247-25')).toMatchObject({ type: 'cpf', value: '52998224725', masked: '•••.982.247-••' });
    expect(parsePixKey('11.222.333/0001-81')).toMatchObject({ type: 'cnpj', value: '11222333000181' });
    expect(parsePixKey('123e4567-e89b-42d3-a456-426614174000')).toMatchObject({
      type: 'evp',
      masked: '123e4567…4000',
    });
  });

  it('puts a phone in E.164, with or without the country code', () => {
    const masked = '+55 81 •••••-8888';
    expect(parsePixKey('+55 81 99999-8888')).toEqual({ type: 'phone', value: '+5581999998888', masked });
    expect(parsePixKey('81999998888')).toEqual({ type: 'phone', value: '+5581999998888', masked });
    expect(parsePixKey('(81) 3333-8888')).toMatchObject({ type: 'phone', value: '+558133338888' });
  });

  it('says what is wrong instead of guessing', () => {
    expect(() => parsePixKey('529.982.247-24')).toThrow(InvalidKey);
    expect(() => parsePixKey('529.982.247-24')).toThrow('check digit');
    expect(() => parsePixKey('ana@')).toThrow('missing @ or domain');
    expect(() => parsePixKey('   ')).toThrow('digite uma chave Pix');
    expect(() => parsePixKey('qualquer coisa')).toThrow('not recognized');
  });
});
