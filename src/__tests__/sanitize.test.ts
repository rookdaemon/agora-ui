import { describe, it, expect } from 'vitest';
import { sanitizeText } from '../utils.js';

describe('sanitizeText', () => {
  it('should pass through normal ASCII text', () => {
    expect(sanitizeText('Hello world')).toBe('Hello world');
  });

  it('should pass through common Unicode (accents, CJK, etc.)', () => {
    expect(sanitizeText('café')).toBe('café');
    expect(sanitizeText('こんにちは')).toBe('こんにちは');
    expect(sanitizeText('Ñoño')).toBe('Ñoño');
  });

  it('should pass through emoji', () => {
    expect(sanitizeText('hello 👋🏽')).toBe('hello 👋🏽');
    expect(sanitizeText('🎉🔥✨')).toBe('🎉🔥✨');
  });

  it('should preserve tabs and newlines', () => {
    expect(sanitizeText('line1\nline2')).toBe('line1\nline2');
    expect(sanitizeText('col1\tcol2')).toBe('col1\tcol2');
  });

  it('should strip NUL and low control chars (except tab/newline/CR)', () => {
    expect(sanitizeText('hello\x00world')).toBe('helloworld');
    expect(sanitizeText('a\x01b\x02c')).toBe('abc');
    expect(sanitizeText('\x08backspace')).toBe('backspace');
  });

  it('should strip C1 control chars (U+007F-U+009F)', () => {
    expect(sanitizeText('hello\x7Fworld')).toBe('helloworld');
    expect(sanitizeText('a\x80b\x9Fc')).toBe('abc');
  });

  it('should replace lone high surrogates with U+FFFD', () => {
    // Lone high surrogate (not followed by low surrogate)
    expect(sanitizeText('a\uD800b')).toBe('a\uFFFDb');
    expect(sanitizeText('\uDBFFend')).toBe('\uFFFDend');
  });

  it('should replace lone low surrogates with U+FFFD', () => {
    // Lone low surrogate (not preceded by high surrogate)
    expect(sanitizeText('a\uDC00b')).toBe('a\uFFFDb');
    expect(sanitizeText('\uDFFFend')).toBe('\uFFFDend');
  });

  it('should preserve valid surrogate pairs', () => {
    // 𝄞 = U+1D11E = \uD834\uDD1E (valid pair)
    const musicalSymbol = '\uD834\uDD1E';
    expect(sanitizeText(musicalSymbol)).toBe(musicalSymbol);
  });

  it('should handle empty string', () => {
    expect(sanitizeText('')).toBe('');
  });

  it('should handle string with only control chars', () => {
    expect(sanitizeText('\x00\x01\x02')).toBe('');
  });
});
