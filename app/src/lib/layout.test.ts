import { describe, expect, it } from 'vitest';
import { classify } from './layout';

describe('classify', () => {
  it('keeps phones in portrait compact', () => {
    expect(classify(390, 844)).toBe('compact');
    expect(classify(599, 1000)).toBe('compact');
  });

  it('keeps a phone in landscape compact (D317)', () => {
    expect(classify(844, 390)).toBe('compact');
    expect(classify(932, 430)).toBe('compact');
  });

  it('gives tablet-sized windows the medium layout', () => {
    expect(classify(600, 800)).toBe('medium');
    expect(classify(820, 1180)).toBe('medium');
    expect(classify(1023, 768)).toBe('medium');
  });

  it('gives laptop and wider windows the expanded layout', () => {
    expect(classify(1024, 768)).toBe('expanded');
    expect(classify(1280, 800)).toBe('expanded');
    expect(classify(1440, 900)).toBe('expanded');
  });
});
