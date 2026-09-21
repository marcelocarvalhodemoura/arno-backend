import { id, isUuidV7, uuidv7 } from './id';

describe('uuidv7', () => {
  it('generates RFC 9562 version 7 identifiers', () => {
    const value = uuidv7();
    expect(isUuidV7(value)).toBe(true);
    expect(id()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('is time-ordered', () => {
    const first = uuidv7();
    const second = uuidv7();
    expect(first < second || first.slice(0, 13) === second.slice(0, 13)).toBe(true);
  });
});
