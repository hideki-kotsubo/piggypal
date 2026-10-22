import { describe, expect, it } from 'vitest';
import { speechTagFor } from './voiceLanguage';

// docs/73 D268
describe('speechTagFor', () => {
  it('sends a region-picked variant exactly, whatever the device says', () => {
    expect(speechTagFor('pt-BR', ['pt-PT'])).toBe('pt-BR');
    expect(speechTagFor('es-ES', ['es-MX'])).toBe('es-ES');
    expect(speechTagFor('fr-CA', ['fr-FR'])).toBe('fr-CA');
  });

  it("gives a base language the device's region when it speaks it", () => {
    expect(speechTagFor('es', ['es-AR'])).toBe('es-AR');
    expect(speechTagFor('en', ['pt-BR', 'en-GB'])).toBe('en-GB');
    expect(speechTagFor('fr', ['fr-BE'])).toBe('fr-BE');
  });

  it("never crosses into the other variant's region", () => {
    expect(speechTagFor('es', ['es-ES'])).toBe('es-MX');
    expect(speechTagFor('fr', ['fr-CA'])).toBe('fr-FR');
  });

  it('always sends Mandarin for Chinese, never Cantonese zh-HK (docs/76)', () => {
    expect(speechTagFor('zh-Hant', ['zh-HK'])).toBe('zh-TW');
    expect(speechTagFor('zh-Hans', ['zh-SG'])).toBe('zh-CN');
    expect(speechTagFor('ja', ['ja-JP'])).toBe('ja-JP');
    expect(speechTagFor('ko', ['en-CA'])).toBe('ko-KR');
  });

  it('falls back to a concrete default, never es-419', () => {
    expect(speechTagFor('es', ['en-CA'])).toBe('es-MX');
    expect(speechTagFor('en', ['pt-BR'])).toBe('en-US');
    expect(speechTagFor('fr', [])).toBe('fr-FR');
    expect(speechTagFor('es', ['es'])).toBe('es-MX');
  });
});
