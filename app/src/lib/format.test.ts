import { afterEach, describe, expect, it } from 'vitest';
import i18n from './i18n';
import { formatAmount, setDollarCurrenciesInUse } from './format';

afterEach(async () => {
  setDollarCurrenciesInUse([]);
  await i18n.changeLanguage('en');
});

// docs/73 D273
describe('formatAmount dollar symbols', () => {
  it('keeps a plain "$" while only one dollar currency is in use', () => {
    setDollarCurrenciesInUse(['CAD', 'BRL', 'CAD']);
    expect(formatAmount(1500, 'CAD')).toBe('$15.00');
  });

  it('spells dollars out once two are in use, other currencies untouched', () => {
    setDollarCurrenciesInUse(['CAD', 'USD', 'BRL']);
    expect(formatAmount(1500, 'CAD')).toBe('CA$15.00');
    expect(formatAmount(-1500, 'USD')).toBe('-US$15.00');
    expect(formatAmount(1500, 'BRL')).toBe('R$15.00');
  });

  it("keeps each language's own order and spacing", async () => {
    setDollarCurrenciesInUse(['CAD', 'USD']);
    await i18n.changeLanguage('pt-BR');
    expect(formatAmount(1500, 'USD').replace(/\s/g, ' ')).toBe('US$ 15,00');
    await i18n.changeLanguage('fr');
    expect(formatAmount(1500, 'CAD').replace(/\s/g, ' ')).toBe('15,00 CA$');
  });
});
